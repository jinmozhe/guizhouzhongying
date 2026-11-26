"""管理端积分只读聚合查询、手机号目标核验与人工调整编排。"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import ColumnElement, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.error_codes import ErrorCode
from app.core.exceptions import AppException
from app.core.pagination import PageResult
from app.db.models import Admin, PointsAccount, PointsLedger, PropertyGrant, PropertyOperator, User
from app.domains.membership import PointsAccountRead, PointsLedgerRead, PointsManualAdjustment
from app.domains.points import PointsService


class PointsPhoneLookupIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    phone_e164: str = Field(
        pattern=r"^\+[1-9][0-9]{6,14}$",
        description="用户手机号，支持直接填写 11 位中国大陆手机号或 E.164 格式",
    )

    @field_validator("phone_e164", mode="before")
    @classmethod
    def normalize_phone(cls, value: object) -> object:
        if isinstance(value, str):
            text = value.strip()
            if len(text) == 11 and text.startswith("1") and text.isascii() and text.isdigit():
                return "+86" + text
            return text
        return value


class PointsTargetRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: UUID = Field(description="目标用户唯一标识")
    username: str = Field(description="用户登录用户名")
    display_name: str | None = Field(default=None, description="用户展示名称")
    phone_e164: str = Field(description="已验证手机号，E.164 格式")
    phone_verified_at: datetime = Field(description="手机号平台验证时间")
    available_points: int = Field(description="当前可用积分")
    frozen_points: int = Field(description="当前冻结积分")
    debt_points: int = Field(description="当前欠积分")


class AdminPointsAccountRead(PointsAccountRead):
    username: str | None = Field(default=None, description="用户登录用户名")
    display_name: str | None = Field(default=None, description="用户展示名称")
    phone_e164: str | None = Field(default=None, description="用户已验证手机号，E.164 格式")
    phone_bound: bool = Field(default=False, description="是否已绑定已验证手机号")
    phone_verified_at: datetime | None = Field(default=None, description="手机号平台验证时间")


class AdminPointsLedgerRead(PointsLedgerRead):
    operator_admin_id: UUID | None = Field(default=None, description="后台人工操作管理员标识")
    operator_admin_username: str | None = Field(default=None, description="后台人工操作管理员账号")
    operator_admin_display_name: str | None = Field(default=None, description="后台人工操作管理员名称")
    property_operator_id: UUID | None = Field(default=None, description="物业授权记录标识")
    property_operator_name: str | None = Field(default=None, description="物业名称")
    property_actor_user_id: UUID | None = Field(default=None, description="实际发放积分的物业管理员对应用户标识")
    property_actor_display_name: str | None = Field(default=None, description="物业管理员用户展示名称")
    property_actor_phone_e164: str | None = Field(default=None, description="物业管理员用户手机号，E.164 格式")
    reversed_points: int = Field(default=0, description="该笔授予流水累计已冲销积分")
    reversible_points: int = Field(default=0, description="该笔授予流水剩余可冲销积分")


class AdminUserPointsLedgersRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    account: PointsAccountRead | None = Field(
        default=None, description="用户当前积分账户余额；历史用户尚未初始化积分账户时为空"
    )
    ledgers: PageResult[AdminPointsLedgerRead] = Field(description="用户不可变积分流水分页列表")


class AdminPointsService:
    """管理端积分只读聚合视图与受控调整入口。"""

    def __init__(self, *, session: AsyncSession, points_service: PointsService) -> None:
        self._session = session
        self._points = points_service

    async def accounts(
        self, page: int, page_size: int, *, phone: str | None = None
    ) -> PageResult[AdminPointsAccountRead]:
        predicates: list[ColumnElement[bool]] = []
        if phone is not None:
            cleaned = phone.strip()
            if cleaned:
                predicates.append(User.phone_e164.ilike(f"%{cleaned}%"))
        base_from = PointsAccount.__table__.outerjoin(User.__table__, User.id == PointsAccount.user_id)
        total = int(await self._session.scalar(select(func.count()).select_from(base_from).where(*predicates)) or 0)
        joined_rows = (
            await self._session.execute(
                select(PointsAccount, User)
                .outerjoin(User, User.id == PointsAccount.user_id)
                .where(*predicates)
                .order_by(PointsAccount.id.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ).all()
        items = [
            AdminPointsAccountRead(
                id=account.id,
                user_id=account.user_id,
                available_points=account.available_points,
                frozen_points=account.frozen_points,
                debt_points=account.debt_points,
                revision=account.revision,
                created_at=account.created_at,
                updated_at=account.updated_at,
                username=user.username if user is not None else None,
                display_name=user.display_name if user is not None else None,
                phone_e164=user.phone_e164 if user is not None else None,
                phone_bound=user.phone_bound if user is not None else False,
                phone_verified_at=user.phone_verified_at if user is not None else None,
            )
            for account, user in joined_rows
        ]
        return PageResult[AdminPointsAccountRead].create(items=items, total=total, page=page, page_size=page_size)

    async def ledgers(self, account_id: UUID, page: int, page_size: int) -> PageResult[AdminPointsLedgerRead]:
        if await self._session.get(PointsAccount, account_id) is None:
            raise AppException(status_code=404, code=ErrorCode.NOT_FOUND, message="积分账户不存在")
        return await self._ledgers_for_account(account_id, page, page_size)

    async def user_ledgers(self, user_id: UUID, page: int, page_size: int) -> AdminUserPointsLedgersRead:
        if await self._session.get(User, user_id) is None:
            raise AppException(status_code=404, code=ErrorCode.USER_NOT_FOUND, message="用户不存在")
        account = (
            await self._session.scalars(select(PointsAccount).where(PointsAccount.user_id == user_id))
        ).one_or_none()
        if account is None:
            return AdminUserPointsLedgersRead(
                account=None,
                ledgers=PageResult[AdminPointsLedgerRead].create(items=[], total=0, page=page, page_size=page_size),
            )
        return AdminUserPointsLedgersRead(
            account=PointsAccountRead.model_validate(account),
            ledgers=await self._ledgers_for_account(account.id, page, page_size),
        )

    async def _ledgers_for_account(
        self, account_id: UUID, page: int, page_size: int
    ) -> PageResult[AdminPointsLedgerRead]:
        predicate = PointsLedger.account_id == account_id
        total = int(await self._session.scalar(select(func.count()).select_from(PointsLedger).where(predicate)) or 0)
        rows = list(
            await self._session.scalars(
                select(PointsLedger)
                .where(predicate)
                .order_by(PointsLedger.id.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        )
        manual_admin_ids = {row.source_id for row in rows if row.source_type == "manual"}
        admins_by_id: dict[UUID, Admin] = {}
        if manual_admin_ids:
            admins = await self._session.scalars(select(Admin).where(Admin.id.in_(manual_admin_ids)))
            admins_by_id = {admin.id: admin for admin in admins}

        property_grant_ids = {row.source_id for row in rows if row.source_type == "property"}
        property_by_grant_id: dict[UUID, tuple[PropertyGrant, PropertyOperator | None, User | None]] = {}
        if property_grant_ids:
            grant_rows = (
                await self._session.execute(
                    select(PropertyGrant, PropertyOperator, User)
                    .outerjoin(PropertyOperator, PropertyOperator.id == PropertyGrant.operator_id)
                    .outerjoin(User, User.id == PropertyGrant.actor_id)
                    .where(PropertyGrant.id.in_(property_grant_ids))
                )
            ).all()
            property_by_grant_id = {grant.id: (grant, operator, actor) for grant, operator, actor in grant_rows}

        grant_ledger_ids = [row.id for row in rows if row.entry_type == "grant"]
        reversed_by_ledger_id: dict[UUID, int] = {}
        if grant_ledger_ids:
            reversal_rows = (
                await self._session.execute(
                    select(
                        PointsLedger.reverses_ledger_id,
                        func.coalesce(func.sum(PointsLedger.available_delta - PointsLedger.debt_delta), 0),
                    )
                    .where(PointsLedger.reverses_ledger_id.in_(grant_ledger_ids))
                    .group_by(PointsLedger.reverses_ledger_id)
                )
            ).all()
            reversed_by_ledger_id = {
                original_id: max(0, -int(delta_sum or 0))
                for original_id, delta_sum in reversal_rows
                if original_id is not None
            }

        items: list[AdminPointsLedgerRead] = []
        for row in rows:
            admin = admins_by_id.get(row.source_id) if row.source_type == "manual" else None
            prop_info = property_by_grant_id.get(row.source_id) if row.source_type == "property" else None
            grant_row, operator_row, actor_user = prop_info if prop_info is not None else (None, None, None)
            if row.entry_type == "grant":
                original_points = max(0, row.available_delta - row.debt_delta)
                reversed_points = reversed_by_ledger_id.get(row.id, 0)
                reversible_points = max(0, original_points - reversed_points)
            else:
                reversed_points = 0
                reversible_points = 0
            items.append(
                AdminPointsLedgerRead(
                    id=row.id,
                    account_id=row.account_id,
                    entry_type=row.entry_type,
                    available_delta=row.available_delta,
                    frozen_delta=row.frozen_delta,
                    debt_delta=row.debt_delta,
                    source_type=row.source_type,
                    source_id=row.source_id,
                    reverses_ledger_id=row.reverses_ledger_id,
                    idempotency_key=row.idempotency_key,
                    note=row.note,
                    created_at=row.created_at,
                    updated_at=row.updated_at,
                    operator_admin_id=admin.id if admin is not None else None,
                    operator_admin_username=admin.username if admin is not None else None,
                    operator_admin_display_name=admin.display_name if admin is not None else None,
                    property_operator_id=grant_row.operator_id if grant_row is not None else None,
                    property_operator_name=operator_row.name if operator_row is not None else None,
                    property_actor_user_id=grant_row.actor_id if grant_row is not None else None,
                    property_actor_display_name=actor_user.display_name if actor_user is not None else None,
                    property_actor_phone_e164=actor_user.phone_e164 if actor_user is not None else None,
                    reversed_points=reversed_points,
                    reversible_points=reversible_points,
                )
            )
        return PageResult[AdminPointsLedgerRead].create(items=items, total=total, page=page, page_size=page_size)

    async def lookup_target(self, phone_e164: str) -> PointsTargetRead:
        user = (await self._session.scalars(select(User).where(User.phone_e164 == phone_e164))).one_or_none()
        if (
            user is None
            or user.deleted_at is not None
            or not user.phone_bound
            or user.phone_e164 is None
            or user.phone_verified_at is None
        ):
            raise AppException(
                status_code=404, code=ErrorCode.USER_NOT_FOUND, message="未找到有效且已绑定该手机号的用户"
            )
        if not user.is_active:
            raise AppException(
                status_code=409, code=ErrorCode.STATE_CONFLICT, message="该手机号对应用户已停用，无法操作积分"
            )
        account = (
            await self._session.scalars(select(PointsAccount).where(PointsAccount.user_id == user.id))
        ).one_or_none()
        return PointsTargetRead(
            user_id=user.id,
            username=user.username,
            display_name=user.display_name,
            phone_e164=user.phone_e164,
            phone_verified_at=user.phone_verified_at,
            available_points=account.available_points if account is not None else 0,
            frozen_points=account.frozen_points if account is not None else 0,
            debt_points=account.debt_points if account is not None else 0,
        )

    async def adjust(self, payload: PointsManualAdjustment) -> PointsAccountRead:
        return await self._points.adjust(payload)


__all__ = [
    "AdminPointsAccountRead",
    "AdminPointsLedgerRead",
    "AdminPointsService",
    "AdminUserPointsLedgersRead",
    "PointsPhoneLookupIn",
    "PointsTargetRead",
]
