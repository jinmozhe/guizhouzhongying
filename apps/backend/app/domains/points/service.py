from collections.abc import Awaitable, Callable
from typing import Protocol, TypeVar
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.error_codes import ErrorCode
from app.core.exceptions import AppException
from app.core.identifiers import new_uuid7
from app.core.pagination import PageResult
from app.db.models import OrderPointsReservation, PointsAccount, PointsLedger
from app.domains.membership import MembershipService, PointsAccountRead, PointsLedgerRead, PointsManualAdjustment

from .repository import PointsRepository

T = TypeVar("T")


class AuditExecutor(Protocol):
    async def execute(
        self,
        *,
        action: str,
        target_type: str,
        target_id: UUID | None,
        changed_fields: dict[str, object],
        operation: Callable[[], Awaitable[T]],
    ) -> T: ...


class PointsService:
    def __init__(
        self, *, session: AsyncSession, actor_id: UUID | None = None, audit: AuditExecutor | None = None
    ) -> None:
        self._session = session
        self._repository = PointsRepository(session)
        self._actor_id = actor_id
        self._audit_coordinator = audit

    async def accounts(self, page: int, page_size: int) -> PageResult[PointsAccountRead]:
        rows, total = await self._repository.account_page(page, page_size)
        return PageResult[PointsAccountRead].create(
            items=[PointsAccountRead.model_validate(row) for row in rows], total=total, page=page, page_size=page_size
        )

    async def initialize_account_in_open_transaction(self, user_id: UUID) -> None:
        """调用方负责事务及用户校验；仅建零账户，不生成积分或资格流水。"""
        await self._repository.lock_account_creation(user_id)
        if await self._repository.account(user_id) is None:
            self._session.add(
                PointsAccount(
                    id=new_uuid7(), user_id=user_id, available_points=0, frozen_points=0, debt_points=0, revision=1
                )
            )
            await self._repository.flush()

    async def ledgers(self, account_id: UUID, page: int, page_size: int) -> PageResult[PointsLedgerRead]:
        rows, total = await self._repository.ledger_page(account_id, page, page_size)
        return PageResult[PointsLedgerRead].create(
            items=[PointsLedgerRead.model_validate(row) for row in rows], total=total, page=page, page_size=page_size
        )

    async def adjust(self, data: PointsManualAdjustment) -> PointsAccountRead:
        if self._actor_id is None or self._audit_coordinator is None:
            raise AppException(status_code=403, code=ErrorCode.PERMISSION_DENIED, message="需要管理员权限")

        async def operation() -> PointsAccountRead:
            await self._repository.lock_adjustment(data.idempotency_key, data.user_id)
            existing = await self._repository.ledger_by_key(data.idempotency_key)
            if existing is not None:
                account = await self._require_account(existing.account_id)
                expected_delta = data.points if data.operation == "grant" else -data.points
                if (
                    account.user_id != data.user_id
                    or existing.entry_type != data.operation
                    or existing.available_delta - existing.debt_delta != expected_delta
                    or existing.frozen_delta != 0
                    or existing.source_type != "manual"
                    or existing.source_id != self._actor_id
                    or existing.reverses_ledger_id != data.reverses_ledger_id
                    or existing.note != data.note
                ):
                    raise AppException(
                        status_code=409, code=ErrorCode.STATE_CONFLICT, message="积分调整幂等键已用于不同请求"
                    )
                return PointsAccountRead.model_validate(account)
            user_state = await self._repository.user_status(data.user_id)
            if user_state is None or user_state[1] is not None:
                raise AppException(status_code=404, code=ErrorCode.USER_NOT_FOUND, message="目标用户不存在")
            if not user_state[0]:
                raise AppException(
                    status_code=409, code=ErrorCode.STATE_CONFLICT, message="目标用户已停用，无法操作积分"
                )
            account_for_user = await self._repository.account(data.user_id, lock=True)
            if account_for_user is None:
                account = PointsAccount(id=new_uuid7(), user_id=data.user_id, revision=1)
                self._session.add(account)
                await self._repository.flush()
            else:
                account = account_for_user
            available_delta, debt_delta = await self._apply_adjustment(account, data)
            account.available_points += available_delta
            account.debt_points += debt_delta
            account.revision += 1
            ledger = PointsLedger(
                id=new_uuid7(),
                account_id=account.id,
                entry_type=data.operation,
                available_delta=available_delta,
                frozen_delta=0,
                debt_delta=debt_delta,
                source_type="manual",
                source_id=self._actor_id,
                reverses_ledger_id=data.reverses_ledger_id,
                idempotency_key=data.idempotency_key,
                note=data.note,
            )
            self._session.add(ledger)
            await self._repository.flush()
            membership = MembershipService(session=self._session)
            if data.operation == "grant":
                await membership.record_qualification_event(
                    user_id=data.user_id,
                    metric="points",
                    source_type="points_grant",
                    source_id=ledger.id,
                    idempotency_key=f"points-qualification:{ledger.id}",
                    count_delta=data.points,
                    trigger_type="points",
                )
            else:
                original_ledger_id = data.reverses_ledger_id
                if original_ledger_id is None:
                    raise RuntimeError("validated points reversal has no original ledger")
                original_event = await membership.qualification_event_for_source(
                    user_id=data.user_id,
                    metric="points",
                    source_type="points_grant",
                    source_id=original_ledger_id,
                )
                original_ledger = await self._repository.ledger(original_ledger_id)
                if original_ledger is not None and original_ledger.source_type == "property":
                    return PointsAccountRead.model_validate(account)
                if original_event is None:
                    raise AppException(
                        status_code=409, code=ErrorCode.STATE_CONFLICT, message="原积分流水没有资格贡献事实"
                    )
                await membership.record_qualification_event(
                    user_id=data.user_id,
                    metric="points",
                    source_type="points_reverse",
                    source_id=ledger.id,
                    idempotency_key=f"points-qualification:{ledger.id}",
                    count_delta=-data.points,
                    reverses_event_id=original_event.id,
                    trigger_type="points",
                )
            return PointsAccountRead.model_validate(account)

        return await self._audit_coordinator.execute(
            action="points.adjust",
            target_type="points_account",
            target_id=None,
            changed_fields={"operation": data.operation, "user_id": str(data.user_id), "points": data.points},
            operation=operation,
        )

    async def _require_account(self, account_id: UUID) -> PointsAccount:
        account = await self._repository.account_by_id(account_id, lock=True)
        if account is None:
            raise AppException(status_code=409, code=ErrorCode.STATE_CONFLICT, message="积分流水账户不存在")
        return account

    async def _apply_adjustment(self, account: PointsAccount, data: PointsManualAdjustment) -> tuple[int, int]:
        if data.operation == "grant":
            debt_payment = min(account.debt_points, data.points)
            return data.points - debt_payment, -debt_payment
        original_id = data.reverses_ledger_id
        if original_id is None:
            raise AppException(status_code=422, code=ErrorCode.VALIDATION_ERROR, message="积分冲销缺少原流水")
        original = await self._repository.ledger(original_id, lock=True)
        if original is None or original.account_id != account.id or original.entry_type != "grant":
            raise AppException(status_code=409, code=ErrorCode.STATE_CONFLICT, message="积分冲销原流水不匹配")
        already_reversed = -await self._repository.reversal_total(original.id)
        if data.points > original.available_delta - original.debt_delta - already_reversed:
            raise AppException(status_code=409, code=ErrorCode.STATE_CONFLICT, message="积分冲销超过原授予量")
        if data.points > account.available_points:
            return -account.available_points, data.points - account.available_points
        return -data.points, 0

    async def grant_property_in_open_transaction(
        self, *, user_id: UUID, grant_id: UUID, points: int, note: str
    ) -> UUID:
        """物业业务单拥有幂等及授权；积分域只写账本，不产生升级资格。"""
        await self._repository.lock_account_creation(user_id)
        account = await self._repository.account(user_id, lock=True)
        if account is None:
            raise AppException(status_code=409, code=ErrorCode.STATE_CONFLICT, message="用户积分账户尚未初始化")
        debt_payment = min(points, account.debt_points)
        if account.available_points + points - debt_payment > 9223372036854775807:
            raise AppException(status_code=409, code=ErrorCode.STATE_CONFLICT, message="积分余额超过存储范围")
        account.available_points += points - debt_payment
        account.debt_points -= debt_payment
        account.revision += 1
        ledger = PointsLedger(
            id=new_uuid7(),
            account_id=account.id,
            entry_type="grant",
            available_delta=points - debt_payment,
            frozen_delta=0,
            debt_delta=-debt_payment,
            source_type="property",
            source_id=grant_id,
            idempotency_key=f"property:{grant_id}",
            note=note,
        )
        self._session.add(ledger)
        await self._repository.flush()
        return ledger.id

    async def available(self, user_id: UUID) -> int:
        account = await self._repository.account(user_id)
        return account.available_points if account is not None and account.debt_points == 0 else 0

    async def reserve_in_open_transaction(self, user_id: UUID, order_id: UUID, points: int) -> None:
        if points == 0:
            return
        if points < 0:
            raise ValueError("points must be positive")
        existing = await self._repository.reservation(order_id, lock=True)
        if existing:
            if existing.user_id != user_id or existing.points != points or existing.status != "frozen":
                raise AppException(status_code=409, code=ErrorCode.STATE_CONFLICT, message="订单积分预占冲突")
            return
        await self._repository.lock_account_creation(user_id)
        account = await self._repository.account(user_id, lock=True)
        if (
            account is None
            or account.debt_points
            or account.available_points < points
            or account.frozen_points + points > 9223372036854775807
        ):
            raise AppException(status_code=409, code=ErrorCode.STATE_CONFLICT, message="积分余额已变化，请重新报价")
        account.available_points -= points
        account.frozen_points += points
        account.revision += 1
        self._session.add(OrderPointsReservation(order_id=order_id, user_id=user_id, points=points, status="frozen"))
        self._session.add(
            PointsLedger(
                account_id=account.id,
                entry_type="freeze",
                available_delta=-points,
                frozen_delta=points,
                debt_delta=0,
                source_type="order",
                source_id=order_id,
                idempotency_key=f"order-points:{order_id}:freeze",
                note="到店订单冻结积分",
            )
        )
        await self._repository.flush()

    async def transition_order_in_open_transaction(self, order_id: UUID, target: str) -> None:
        reservation = await self._repository.reservation(order_id, lock=True)
        if reservation is None or reservation.status == target:
            return
        previous = "spent" if target == "refunded" else "frozen"
        if target not in {"spent", "released", "refunded"} or reservation.status != previous:
            raise AppException(status_code=409, code=ErrorCode.STATE_CONFLICT, message="订单积分状态不支持该转换")
        await self._repository.lock_account_creation(reservation.user_id)
        account = await self._repository.account(reservation.user_id, lock=True)
        if account is None:
            raise AppException(status_code=409, code=ErrorCode.STATE_CONFLICT, message="订单积分账户不存在")
        points = reservation.points
        frozen_delta = -points if previous == "frozen" else 0
        if account.frozen_points + frozen_delta < 0:
            raise AppException(status_code=409, code=ErrorCode.STATE_CONFLICT, message="订单冻结积分账实不符")
        debt_payment = min(points, account.debt_points) if target != "spent" else 0
        available_delta = points - debt_payment if target != "spent" else 0
        if account.available_points + available_delta > 9223372036854775807:
            raise AppException(status_code=409, code=ErrorCode.STATE_CONFLICT, message="返还后积分超过存储范围")
        account.available_points += available_delta
        account.frozen_points += frozen_delta
        account.debt_points -= debt_payment
        account.revision += 1
        reservation.status = target
        self._session.add(
            PointsLedger(
                account_id=account.id,
                entry_type="spend" if target == "spent" else "release",
                available_delta=available_delta,
                frozen_delta=frozen_delta,
                debt_delta=-debt_payment,
                source_type="refund" if target == "refunded" else "order",
                source_id=order_id,
                idempotency_key=f"order-points:{order_id}:{target}",
                note="到店订单积分状态：" + target,
            )
        )
        await self._repository.flush()


__all__ = ["PointsService"]
