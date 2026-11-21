from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.error_codes import ErrorCode
from app.core.exceptions import AppException
from app.core.pagination import PageResult
from app.db.models import Merchant, MerchantPaymentEvent, MerchantReceivable, MerchantSettlement
from app.db.repositories.local_commerce import LocalActorsRepository
from app.db.repositories.merchant_finance import MerchantFinanceRepository
from app.domains.admin.permissions import PermissionCode
from app.services.admin_audit import AdminAuditCoordinator
from app.services.local_actors import LocalActorsService, local_conflict
from app.services.local_commerce_schemas import (
    ReceivableRead,
    SettlementCreate,
    SettlementEventRead,
    SettlementPayment,
    SettlementRead,
    SettlementReversal,
)


class MerchantFinanceService:
    def __init__(
        self, session: AsyncSession, *, audit: AdminAuditCoordinator | None = None, actor_id: UUID | None = None
    ) -> None:
        self.session, self.audit, self.actor_id = session, audit, actor_id
        self.repository = MerchantFinanceRepository(session)

    async def receivables(
        self, page: int, page_size: int, merchant_id: UUID | None, user_id: UUID | None = None
    ) -> PageResult[ReceivableRead]:
        if user_id:
            merchant_id = (await LocalActorsService(self.session).require_role(Merchant, user_id)).id
        rows, total = await self.repository.page(MerchantReceivable, page, page_size, merchant_id)
        return PageResult[ReceivableRead].create(
            items=[ReceivableRead.model_validate(row) for row in rows], total=total, page=page, page_size=page_size
        )

    async def settlements(
        self, page: int, page_size: int, merchant_id: UUID | None, user_id: UUID | None = None
    ) -> PageResult[SettlementRead]:
        if user_id:
            merchant_id = (await LocalActorsService(self.session).require_role(Merchant, user_id)).id
        rows, total = await self.repository.page(MerchantSettlement, page, page_size, merchant_id)
        return PageResult[SettlementRead].create(
            items=[SettlementRead.model_validate(row) for row in rows], total=total, page=page, page_size=page_size
        )

    async def create(self, data: SettlementCreate) -> SettlementRead:
        if self.audit is None:
            raise AppException(status_code=403, code=ErrorCode.PERMISSION_DENIED, message="需要结算权限")

        async def operation() -> SettlementRead:
            await LocalActorsRepository(self.session).lock_bindings()
            existing = await self.repository.by_request(data.request_id)
            if existing:
                if existing.merchant_id != data.merchant_id or set(
                    await self.repository.settlement_items(existing.id)
                ) != set(data.receivable_ids):
                    raise local_conflict("请求号已用于不同对账条目")
                return SettlementRead.model_validate(existing)
            rows = await self.repository.receivables(data.receivable_ids)
            if len(rows) != len(data.receivable_ids) or any(
                row.merchant_id != data.merchant_id or row.settlement_id is not None for row in rows
            ):
                raise local_conflict("应收归属不符或已有结算批次，请刷新")
            amount = sum((row.gross_amount for row in rows), Decimal("0.00"))
            if amount >= Decimal("10000000000000"):
                raise local_conflict("对账合计超过金额存储范围，请减少条目")
            batch = MerchantSettlement(
                merchant_id=data.merchant_id, request_id=data.request_id, amount=amount, status="open", revision=1
            )
            await self.repository.save(batch)
            for row in rows:
                row.settlement_id = batch.id
                await self.repository.save(row)
            return SettlementRead.model_validate(batch)

        return await self.audit.execute(
            action=PermissionCode.MERCHANT_SETTLEMENTS_UPDATE.value,
            target_type="merchant_settlement",
            target_id=None,
            changed_fields={
                "merchant_id": str(data.merchant_id),
                "receivables": [str(value) for value in data.receivable_ids],
            },
            operation=operation,
        )

    async def pay(self, settlement_id: UUID, data: SettlementPayment) -> SettlementRead:
        if self.audit is None:
            raise AppException(status_code=403, code=ErrorCode.PERMISSION_DENIED, message="需要结算权限")

        async def operation() -> SettlementRead:
            await LocalActorsRepository(self.session).lock_bindings()
            row = await self.repository.settlement(settlement_id)
            if row is None:
                raise local_conflict("结算批次不存在")
            event = await self.repository.payment_event(data.request_id)
            if event is not None:
                if (
                    event.settlement_id != row.id
                    or event.kind != "payment"
                    or event.amount != data.amount
                    or event.payment_reference != data.payment_reference
                    or event.paid_at != data.paid_at
                    or event.revision != data.revision + 1
                ):
                    raise local_conflict("请求号已用于其他付款内容")
                return SettlementRead.model_validate(row)
            if data.paid_at.tzinfo is None or data.paid_at > datetime.now(UTC):
                raise local_conflict("实际打款时间必须带时区且不能晚于现在")
            if row.status == "paid":
                raise local_conflict("该批次已登记付款，请查阅历史")
            if row.revision != data.revision or row.amount != data.amount:
                raise local_conflict("版本或打款金额不符，必须整批全额结清")
            if await self.repository.payment_reference_exists(data.payment_reference, row.id):
                raise local_conflict("该线下付款凭据已用于其他批次")
            row.status, row.paid_at, row.paid_by_id = "paid", data.paid_at.astimezone(UTC), self.actor_id
            row.payment_reference = data.payment_reference
            row.revision += 1
            await self.repository.save(row)
            if self.actor_id is None:
                raise local_conflict("缺少后台操作者")
            await self.repository.save(
                MerchantPaymentEvent(
                    settlement_id=row.id,
                    request_id=data.request_id,
                    revision=row.revision,
                    kind="payment",
                    amount=row.amount,
                    payment_reference=data.payment_reference,
                    paid_at=data.paid_at,
                    actor_id=self.actor_id,
                    reason="",
                )
            )
            return SettlementRead.model_validate(row)

        return await self.audit.execute(
            action=PermissionCode.MERCHANT_SETTLEMENTS_UPDATE.value,
            target_type="merchant_settlement",
            target_id=settlement_id,
            changed_fields={"amount": str(data.amount), "payment_reference": data.payment_reference},
            operation=operation,
        )

    async def history(self, settlement_id: UUID) -> list[SettlementEventRead]:
        return [SettlementEventRead.model_validate(row) for row in await self.repository.events(settlement_id)]

    async def reverse(self, settlement_id: UUID, data: SettlementReversal) -> SettlementRead:
        if self.audit is None or self.actor_id is None:
            raise AppException(status_code=403, code=ErrorCode.PERMISSION_DENIED, message="需要结算权限")
        actor_id = self.actor_id

        async def operation() -> SettlementRead:
            await LocalActorsRepository(self.session).lock_bindings()
            row = await self.repository.settlement(settlement_id)
            if row is None:
                raise local_conflict("结算批次不存在")
            event = await self.repository.payment_event(data.request_id)
            if event is not None:
                if (
                    event.settlement_id != row.id
                    or event.kind != "reversal"
                    or event.reason != data.reason
                    or event.revision != data.revision + 1
                ):
                    raise local_conflict("请求号已用于其他纠错内容")
                return SettlementRead.model_validate(row)
            if (
                row.status != "paid"
                or row.revision != data.revision
                or row.payment_reference is None
                or row.paid_at is None
            ):
                raise local_conflict("付款事实已变化，请刷新后核对")
            await self.repository.save(
                MerchantPaymentEvent(
                    settlement_id=row.id,
                    request_id=data.request_id,
                    revision=row.revision + 1,
                    kind="reversal",
                    amount=row.amount,
                    payment_reference=row.payment_reference,
                    paid_at=row.paid_at,
                    actor_id=actor_id,
                    reason=data.reason,
                )
            )
            row.status, row.payment_reference, row.paid_at, row.paid_by_id = "open", None, None, None
            row.revision += 1
            await self.repository.save(row)
            return SettlementRead.model_validate(row)

        return await self.audit.execute(
            action=PermissionCode.MERCHANT_SETTLEMENTS_UPDATE.value,
            target_type="merchant_settlement",
            target_id=settlement_id,
            changed_fields={"reason": data.reason, "request_id": str(data.request_id)},
            operation=operation,
        )
