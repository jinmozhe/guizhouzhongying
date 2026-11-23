"""到店商家、物业授权、核销和结算事实。"""

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class Merchant(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "merchants"
    __table_args__ = (
        CheckConstraint("revision > 0", name="ck_merchants_revision"),
        CheckConstraint("sort_order >= 0", name="ck_merchants_sort"),
        CheckConstraint(
            "(latitude IS NULL AND longitude IS NULL) OR "
            "(latitude IS NOT NULL AND longitude IS NOT NULL AND "
            "latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)",
            name="ck_merchants_map_coordinates",
        ),
        {"comment": "线下消费商家，一商家一授权手机号一核销员"},
    )
    name: Mapped[str] = mapped_column(String(100), comment="商家名称")
    phone_e164: Mapped[str] = mapped_column(String(16), unique=True, comment="非公开授权手机号")
    user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), unique=True, comment="可信手机号匹配的核销用户"
    )
    logo_asset_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("assets.id", ondelete="RESTRICT"), index=True, comment="商家 LOGO 资产"
    )
    description: Mapped[str] = mapped_column(Text, default="", comment="受限 HTML 商家介绍")
    address: Mapped[str] = mapped_column(String(300), default="", comment="线下消费地址")
    latitude: Mapped[Decimal | None] = mapped_column(Numeric(9, 6), comment="公开门店纬度，GCJ-02")
    longitude: Mapped[Decimal | None] = mapped_column(Numeric(9, 6), comment="公开门店经度，GCJ-02")
    business_hours: Mapped[str] = mapped_column(String(200), default="", comment="营业时间")
    public_phone: Mapped[str] = mapped_column(String(40), default="", comment="明确公开的联系电话")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, comment="是否启用")
    sort_order: Mapped[int | None] = mapped_column(
        Integer, default=None, comment="排序权重，值越小越靠前，NULL 表示未人工设置自动排最后"
    )
    revision: Mapped[int] = mapped_column(Integer, default=1, comment="资料版本")


class PropertyOperator(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "property_operators"
    __table_args__ = (
        CheckConstraint("revision > 0", name="ck_property_operators_revision"),
        {"comment": "物业发积分授权，不设业务额度"},
    )
    name: Mapped[str] = mapped_column(String(100), comment="物业操作名称")
    phone_e164: Mapped[str] = mapped_column(String(16), unique=True, comment="授权手机号")
    user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), unique=True, comment="可信绑定用户"
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, comment="授权是否启用")
    revision: Mapped[int] = mapped_column(Integer, default=1, comment="授权版本")


class LocalBindingEvent(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "local_binding_events"
    __table_args__ = (
        CheckConstraint("role IN ('merchant', 'property')", name="ck_local_binding_role"),
        {"comment": "商家和物业授权关联变更历史"},
    )
    role: Mapped[str] = mapped_column(String(16), comment="业务角色")
    resource_id: Mapped[UUID] = mapped_column(comment="商家或物业授权标识")
    previous_user_id: Mapped[UUID | None] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), comment="原用户")
    user_id: Mapped[UUID | None] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), comment="新用户")
    actor_id: Mapped[UUID | None] = mapped_column(comment="后台操作者，自动匹配为空")
    reason: Mapped[str] = mapped_column(String(200), comment="变更原因")


class PropertyGrant(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "property_grants"
    __table_args__ = (
        UniqueConstraint("operator_id", "request_id", name="uq_property_grant_request"),
        CheckConstraint("points > 0", name="ck_property_grant_points"),
        Index("ix_property_grant_operator_id", "operator_id", "id"),
        {"comment": "物业积分发放事实，不贡献会员升级资格"},
    )
    operator_id: Mapped[UUID] = mapped_column(
        ForeignKey("property_operators.id", ondelete="RESTRICT"), comment="物业授权"
    )
    actor_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), comment="实际发放用户")
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), comment="目标会员")
    request_id: Mapped[UUID] = mapped_column(comment="操作幂等请求")
    request_hash: Mapped[str] = mapped_column(String(64), comment="发放目标与数量摘要")
    points: Mapped[int] = mapped_column(BigInteger, comment="授予积分")
    note: Mapped[str] = mapped_column(String(200), default="", comment="发放说明")
    ledger_id: Mapped[UUID] = mapped_column(
        ForeignKey("points_ledgers.id", ondelete="RESTRICT"), unique=True, comment="积分入账流水"
    )


class OrderPointsReservation(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "order_points_reservations"
    __table_args__ = (
        CheckConstraint("points > 0", name="ck_order_points_positive"),
        CheckConstraint("status IN ('frozen', 'spent', 'released', 'refunded')", name="ck_order_points_status"),
        {"comment": "订单独占积分预占与消费状态"},
    )
    order_id: Mapped[UUID] = mapped_column(ForeignKey("orders.id", ondelete="RESTRICT"), unique=True, comment="订单")
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), comment="会员")
    points: Mapped[int] = mapped_column(BigInteger, comment="订单冻结积分")
    status: Mapped[str] = mapped_column(String(16), default="frozen", comment="冻结、消费、释放或已退款")


class RedemptionVoucher(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "redemption_vouchers"
    __table_args__ = (
        CheckConstraint("status IN ('available', 'redeemed', 'refunding', 'refunded')", name="ck_redemption_status"),
        CheckConstraint(
            "(status = 'redeemed') = (redeemed_at IS NOT NULL AND redeemed_by_id IS NOT NULL)",
            name="ck_redemption_fact",
        ),
        Index("ix_redemption_merchant_id", "merchant_id", "id"),
        Index("ix_redemption_expiry", "expires_at", "id", postgresql_where="status = 'available'"),
        {"comment": "同商家整单一次性核销凭证"},
    )
    order_id: Mapped[UUID] = mapped_column(
        ForeignKey("orders.id", ondelete="RESTRICT"), unique=True, comment="已成交订单"
    )
    merchant_id: Mapped[UUID] = mapped_column(ForeignKey("merchants.id", ondelete="RESTRICT"), comment="成交商家")
    code_digest: Mapped[str] = mapped_column(String(64), unique=True, comment="高熵核销码摘要")
    code_ciphertext: Mapped[str] = mapped_column(Text, comment="经配置密钥保护的可恢复核销码")
    status: Mapped[str] = mapped_column(String(16), default="available", comment="凭证状态")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), comment="服务端成交确认起七天截止")
    redeemed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), comment="核销时间")
    redeemed_by_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), comment="实际核销用户"
    )
    request_id: Mapped[UUID | None] = mapped_column(unique=True, comment="核销提交幂等请求")


class MerchantSettlement(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "merchant_settlements"
    __table_args__ = (
        CheckConstraint("status IN ('open', 'paid')", name="ck_merchant_settlement_status"),
        CheckConstraint("amount >= 0", name="ck_merchant_settlement_amount"),
        CheckConstraint(
            "(status = 'paid') = (paid_at IS NOT NULL AND payment_reference IS NOT NULL)",
            name="ck_merchant_settlement_paid",
        ),
        {"comment": "商家整批对账与线下打款登记"},
    )
    merchant_id: Mapped[UUID] = mapped_column(
        ForeignKey("merchants.id", ondelete="RESTRICT"), index=True, comment="商家"
    )
    request_id: Mapped[UUID] = mapped_column(unique=True, comment="组批幂等请求")
    amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), comment="完整应收合计")
    status: Mapped[str] = mapped_column(String(16), default="open", comment="待打款或已打款")
    payment_reference: Mapped[str | None] = mapped_column(String(100), unique=True, comment="线下付款凭据号")
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), comment="线下实际打款时间")
    paid_by_id: Mapped[UUID | None] = mapped_column(ForeignKey("admins.id", ondelete="RESTRICT"), comment="登记管理员")
    revision: Mapped[int] = mapped_column(Integer, default=1, comment="结算状态版本")


class MerchantReceivable(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "merchant_receivables"
    __table_args__ = (
        CheckConstraint(
            "gross_amount >= 0 AND cash_amount >= 0 AND points_amount >= 0 AND gross_amount = cash_amount + points_amount",
            name="ck_merchant_receivable_amounts",
        ),
        Index("ix_merchant_receivable_merchant_id", "merchant_id", "id"),
        {"comment": "核销后商家全额应收，平台承担积分补贴及佣金"},
    )
    merchant_id: Mapped[UUID] = mapped_column(ForeignKey("merchants.id", ondelete="RESTRICT"), comment="商家")
    order_id: Mapped[UUID] = mapped_column(
        ForeignKey("orders.id", ondelete="RESTRICT"), unique=True, comment="来源订单"
    )
    voucher_id: Mapped[UUID] = mapped_column(
        ForeignKey("redemption_vouchers.id", ondelete="RESTRICT"), unique=True, comment="唯一核销事实"
    )
    gross_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), comment="含积分完整成交额")
    cash_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), comment="消费者微信实付")
    points_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), comment="平台积分补贴")
    settlement_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("merchant_settlements.id", ondelete="RESTRICT"), index=True, comment="所属对账批次"
    )


class MerchantPaymentEvent(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "merchant_payment_events"
    __table_args__ = (
        UniqueConstraint("settlement_id", "revision", name="uq_merchant_payment_revision"),
        CheckConstraint("kind IN ('payment', 'reversal')", name="ck_merchant_payment_kind"),
        CheckConstraint("amount >= 0 AND revision > 0", name="ck_merchant_payment_values"),
        {"comment": "不可删除的线下付款登记及纠错冲正历史"},
    )
    settlement_id: Mapped[UUID] = mapped_column(
        ForeignKey("merchant_settlements.id", ondelete="RESTRICT"), index=True, comment="结算批次"
    )
    request_id: Mapped[UUID] = mapped_column(unique=True, comment="付款或纠错幂等号")
    revision: Mapped[int] = mapped_column(Integer, comment="操作后的批次版本")
    kind: Mapped[str] = mapped_column(String(16), comment="付款或冲正登记")
    amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), comment="本次登记全额")
    payment_reference: Mapped[str] = mapped_column(String(100), comment="原线下付款凭据")
    paid_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), comment="原实际付款时间")
    actor_id: Mapped[UUID] = mapped_column(ForeignKey("admins.id", ondelete="RESTRICT"), comment="登记管理员")
    reason: Mapped[str] = mapped_column(String(300), default="", comment="纠错原因，冲正不执行资金转账")
