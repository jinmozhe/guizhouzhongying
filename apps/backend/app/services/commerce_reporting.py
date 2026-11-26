"""Admin 只读查询模型：直接读取已提交商城事实，不参与领域写入。

列表按创建时间与主键稳定排序，刷新时重读 PostgreSQL；分页计数为读已提交隔离。
精确资源权限由 Router 声明；导出另需资源 export 权限并仅返回白名单 Schema。
"""

from datetime import datetime
from decimal import Decimal
from typing import Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import ColumnElement, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.error_codes import ErrorCode
from app.core.exceptions import AppException
from app.core.pagination import PageResult
from app.db.models.base import Base
from app.db.models.commerce_lifecycle import PaymentAttempt, ReconciliationRecord, RefundAttempt, RefundRequest
from app.db.models.distribution import (
    CommissionRecord,
    DurableTask,
    MemberProfile,
    WalletAccount,
    WalletLedger,
    WithdrawalRequest,
)
from app.db.models.identity import User
from app.db.models.order import Order
from app.domains.distribution import CommissionRead, MemberProfileRead, WalletAccountRead, WithdrawalRead
from app.domains.lifecycle import PaymentAttemptRead, ReconciliationRecordRead, RefundAttemptRead, RefundRequestRead
from app.domains.orders.schemas import AdminOrderSummary
from app.services.security_events import AuditCoordinator


class DurableTaskRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID = Field(description="任务标识")
    task_type: str = Field(description="任务类型")
    business_key: str = Field(description="业务键")
    status: str = Field(description="任务状态: pending/running/succeeded/attention")
    available_at: datetime = Field(description="可用/计划执行时间")
    attempt_count: int = Field(description="尝试执行次数")
    failure_count: int = Field(description="失败次数")
    max_failures: int = Field(description="最大重试失败上限")
    revision: int = Field(description="版本号")
    completed_at: datetime | None = Field(default=None, description="完成时间")
    last_error_code: str | None = Field(default=None, description="最近错误代码")
    last_error_summary: str | None = Field(default=None, description="脱敏错误摘要")
    created_at: datetime = Field(description="创建时间")
    updated_at: datetime = Field(description="更新时间")


class AdminWalletRead(WalletAccountRead):
    id: UUID = Field(description="钱包账户标识")
    user_id: UUID = Field(description="账户所属会员标识")


class AdminMemberProfileRead(MemberProfileRead):
    username: str | None = Field(default=None, description="会员登录用户名")
    display_name: str | None = Field(default=None, description="会员展示名称")
    phone_e164: str | None = Field(default=None, description="会员已验证手机号，E.164 格式")
    phone_bound: bool = Field(default=False, description="会员是否已绑定已验证手机号")
    phone_verified_at: datetime | None = Field(default=None, description="会员手机号平台验证时间")


class WalletLedgerRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID = Field(description="流水标识")
    wallet_id: UUID = Field(description="钱包标识")
    entry_type: str = Field(description="资金变动类型")
    amount: Decimal = Field(description="可用余额变化")
    frozen_delta: Decimal = Field(description="冻结余额变化")
    debt_delta: Decimal = Field(description="欠款变化")
    reference_type: str = Field(description="关联业务类型")
    reference_id: UUID = Field(description="关联业务标识")
    wallet_revision: int = Field(description="变动后钱包版本")
    balance_after: dict[str, object] = Field(description="变动后余额快照")
    created_at: datetime = Field(description="入账时间")


class AdminUserWalletLedgersRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    commission_wallet: AdminWalletRead | None = Field(default=None, description="用户佣金钱包账户，未建账时为空")
    consumption_wallet: AdminWalletRead | None = Field(default=None, description="用户消费钱包账户，未建账时为空")
    active_wallet_type: Literal["commission", "consumption"] = Field(description="当前查询的钱包轨道")
    ledgers: PageResult[WalletLedgerRead] = Field(description="当前轨道不可变钱包流水分页列表")


class CommerceFilters(BaseModel):
    model_config = ConfigDict(extra="forbid")

    page: int = Field(default=1, ge=1, description="页码")
    page_size: int = Field(default=20, ge=1, le=100, description="每页数量")
    record_id: UUID | None = Field(default=None, description="记录标识，会员列表使用用户标识")
    user_id: UUID | None = Field(default=None, description="用户标识，佣金列表使用受益人标识")
    order_id: UUID | None = Field(default=None, description="订单标识")
    inviter_id: UUID | None = Field(default=None, description="直接推荐人标识")
    phone: str | None = Field(
        default=None, min_length=1, max_length=32, description="会员手机号筛选，支持 11 位号码、尾号或 E.164 格式"
    )
    status: str | None = Field(default=None, min_length=1, max_length=32, description="状态代码")
    channel: Literal["wechat", "alipay"] | None = Field(default=None, description="支付渠道")
    product_type: Literal["physical", "virtual"] | None = Field(default=None, description="商品类型")
    wallet_type: Literal["commission", "consumption"] | None = Field(default=None, description="钱包轨道")
    task_type: str | None = Field(default=None, min_length=1, max_length=64, description="任务类型")
    business_key: str | None = Field(default=None, min_length=1, max_length=160, description="业务键")


class SelectedCommerceIds(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ids: list[UUID] = Field(min_length=1, max_length=100, description="一至一百条选中记录，会员使用用户标识")

    @model_validator(mode="after")
    def unique_ids(self) -> Self:
        if len(set(self.ids)) != len(self.ids):
            raise ValueError("选中记录不能重复")
        return self


class CommerceExportRead(BaseModel):
    columns: list[str] = Field(description="白名单字段名称")
    rows: list[list[str]] = Field(description="按字段顺序序列化的记录，金额保留精度")


# 显式模型与输出白名单，禁止用户指定任意表、字段或 SQL。
_RESOURCES: dict[str, tuple[type[Base], type[BaseModel]]] = {
    "orders": (Order, AdminOrderSummary),
    "refunds": (RefundRequest, RefundRequestRead),
    "withdrawals": (WithdrawalRequest, WithdrawalRead),
    "payments": (PaymentAttempt, PaymentAttemptRead),
    "reconciliation-records": (ReconciliationRecord, ReconciliationRecordRead),
    "members": (MemberProfile, AdminMemberProfileRead),
    "commissions": (CommissionRecord, CommissionRead),
    "wallets": (WalletAccount, AdminWalletRead),
    "refund-executions": (RefundAttempt, RefundAttemptRead),
    "durable-tasks": (DurableTask, DurableTaskRead),
}
_FILTERS = {
    "orders": {"user_id": "user_id", "status": "status", "product_type": "product_type"},
    "refunds": {"user_id": "user_id", "order_id": "order_id", "status": "status"},
    "withdrawals": {"user_id": "user_id", "status": "status"},
    "payments": {"user_id": "user_id", "order_id": "order_id", "status": "status", "channel": "channel"},
    "reconciliation-records": {"status": "status", "channel": "channel"},
    "members": {"user_id": "user_id", "inviter_id": "inviter_id"},
    "commissions": {"user_id": "beneficiary_user_id", "order_id": "order_id", "status": "status"},
    "wallets": {"user_id": "user_id", "wallet_type": "wallet_type"},
    "refund-executions": {"order_id": "order_id", "status": "status", "channel": "channel"},
    "durable-tasks": {"status": "status", "task_type": "task_type", "business_key": "business_key"},
}


class CommerceReportingService:
    def __init__(self, session: AsyncSession, audit: AuditCoordinator) -> None:
        self.session = session
        self.audit = audit

    @staticmethod
    def _member_read(profile: MemberProfile, user: User | None) -> AdminMemberProfileRead:
        return AdminMemberProfileRead(
            user_id=profile.user_id,
            invitation_code=profile.invitation_code,
            level_id=profile.level_id,
            level_changed_at=profile.level_changed_at,
            revision=profile.revision,
            inviter_id=profile.inviter_id,
            bound_at=profile.bound_at,
            created_at=profile.created_at,
            username=user.username if user is not None else None,
            display_name=user.display_name if user is not None else None,
            phone_e164=user.phone_e164 if user is not None else None,
            phone_bound=user.phone_bound if user is not None else False,
            phone_verified_at=user.phone_verified_at if user is not None else None,
        )

    async def page[T: BaseModel](self, resource: str, schema: type[T], filters: CommerceFilters) -> PageResult[T]:
        if resource not in _RESOURCES:
            raise AppException(status_code=422, code=ErrorCode.VALIDATION_ERROR, message="不支持的查询资源类型")
        model, expected_schema = _RESOURCES[resource]
        if schema is not expected_schema:
            raise ValueError("查询输出契约不匹配")
        if resource == "members":
            member_predicates: list[ColumnElement[bool]] = []
            for name, value in filters.model_dump(exclude_none=True).items():
                if name in {"page", "page_size"}:
                    continue
                if name == "phone":
                    cleaned_phone = str(value).strip()
                    if cleaned_phone:
                        member_predicates.append(User.phone_e164.ilike(f"%{cleaned_phone}%"))
                    continue
                column = "user_id" if name == "record_id" else _FILTERS["members"].get(name)
                if column is None:
                    raise AppException(
                        status_code=422, code=ErrorCode.VALIDATION_ERROR, message="此列表不支持该筛选条件"
                    )
                member_predicates.append(getattr(MemberProfile, column) == value)
            base_from = MemberProfile.__table__.outerjoin(User.__table__, User.id == MemberProfile.user_id)
            total = int(
                await self.session.scalar(select(func.count()).select_from(base_from).where(*member_predicates)) or 0
            )
            joined_rows = (
                await self.session.execute(
                    select(MemberProfile, User)
                    .outerjoin(User, User.id == MemberProfile.user_id)
                    .where(*member_predicates)
                    .order_by(MemberProfile.id.desc())
                    .offset((filters.page - 1) * filters.page_size)
                    .limit(filters.page_size)
                )
            ).all()
            return PageResult[T].create(
                items=[schema.model_validate(self._member_read(profile, user)) for profile, user in joined_rows],
                total=total,
                page=filters.page,
                page_size=filters.page_size,
            )
        predicates: list[ColumnElement[bool]] = []
        for name, value in filters.model_dump(exclude_none=True).items():
            if name in {"page", "page_size"}:
                continue
            column = (
                ("user_id" if resource == "members" else "id") if name == "record_id" else _FILTERS[resource].get(name)
            )
            if column is None:
                raise AppException(status_code=422, code=ErrorCode.VALIDATION_ERROR, message="此列表不支持该筛选条件")
            predicates.append(getattr(model, column) == value)
        total = int(await self.session.scalar(select(func.count()).select_from(model).where(*predicates)) or 0)
        rows = await self.session.scalars(
            select(model)
            .where(*predicates)
            .order_by(getattr(model, "id").desc())
            .offset((filters.page - 1) * filters.page_size)
            .limit(filters.page_size)
        )
        return PageResult[T].create(
            items=[schema.model_validate(row) for row in rows],
            total=total,
            page=filters.page,
            page_size=filters.page_size,
        )

    async def export(self, resource: str, selection: SelectedCommerceIds) -> CommerceExportRead:
        async def operation() -> CommerceExportRead:
            model, schema = _RESOURCES[resource]
            columns = list(schema.model_fields)
            if resource == "members":
                joined_rows = (
                    await self.session.execute(
                        select(MemberProfile, User)
                        .outerjoin(User, User.id == MemberProfile.user_id)
                        .where(MemberProfile.user_id.in_(selection.ids))
                        .order_by(MemberProfile.user_id)
                    )
                ).all()
                if len(joined_rows) != len(selection.ids):
                    raise AppException(
                        status_code=409,
                        code=ErrorCode.STATE_CONFLICT,
                        message="部分选中记录已不存在，请刷新后重新选择",
                    )
                values = [self._member_read(profile, user).model_dump(mode="json") for profile, user in joined_rows]
                return CommerceExportRead(
                    columns=columns, rows=[["" if row[c] is None else str(row[c]) for c in columns] for row in values]
                )
            key = getattr(model, "id")
            rows = list(await self.session.scalars(select(model).where(key.in_(selection.ids)).order_by(key)))
            if len(rows) != len(selection.ids):
                raise AppException(
                    status_code=409, code=ErrorCode.STATE_CONFLICT, message="部分选中记录已不存在，请刷新后重新选择"
                )
            values = [schema.model_validate(row).model_dump(mode="json") for row in rows]
            return CommerceExportRead(
                columns=columns, rows=[["" if row[c] is None else str(row[c]) for c in columns] for row in values]
            )

        return await self.audit.execute(
            action=f"commerce.{resource}.export",
            target_type=resource,
            target_id=None,
            changed_fields={"record_ids": [str(item) for item in selection.ids], "record_count": len(selection.ids)},
            operation=operation,
        )

    async def ledgers(self, wallet_id: UUID, page: int, page_size: int) -> PageResult[WalletLedgerRead]:
        if await self.session.get(WalletAccount, wallet_id) is None:
            raise AppException(status_code=404, code=ErrorCode.NOT_FOUND, message="钱包不存在")
        return await self._ledgers_for_wallet(wallet_id, page, page_size)

    async def user_wallet_ledgers(
        self,
        user_id: UUID,
        wallet_type: Literal["commission", "consumption"],
        page: int,
        page_size: int,
    ) -> AdminUserWalletLedgersRead:
        if await self.session.get(User, user_id) is None:
            raise AppException(status_code=404, code=ErrorCode.USER_NOT_FOUND, message="用户不存在")
        wallets = list(await self.session.scalars(select(WalletAccount).where(WalletAccount.user_id == user_id)))
        by_type = {wallet.wallet_type: wallet for wallet in wallets}
        commission = by_type.get("commission")
        consumption = by_type.get("consumption")
        target = by_type.get(wallet_type)
        ledgers = (
            await self._ledgers_for_wallet(target.id, page, page_size)
            if target is not None
            else PageResult[WalletLedgerRead].create(items=[], total=0, page=page, page_size=page_size)
        )
        return AdminUserWalletLedgersRead(
            commission_wallet=AdminWalletRead.model_validate(commission) if commission is not None else None,
            consumption_wallet=AdminWalletRead.model_validate(consumption) if consumption is not None else None,
            active_wallet_type=wallet_type,
            ledgers=ledgers,
        )

    async def _ledgers_for_wallet(self, wallet_id: UUID, page: int, page_size: int) -> PageResult[WalletLedgerRead]:
        predicate = WalletLedger.wallet_id == wallet_id
        total = int(await self.session.scalar(select(func.count()).select_from(WalletLedger).where(predicate)) or 0)
        rows = await self.session.scalars(
            select(WalletLedger)
            .where(predicate)
            .order_by(WalletLedger.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        return PageResult[WalletLedgerRead].create(
            items=[WalletLedgerRead.model_validate(row) for row in rows], total=total, page=page, page_size=page_size
        )
