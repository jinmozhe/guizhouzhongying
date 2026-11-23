from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.restricted_html import restricted_html


class LocalInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class OperatorInput(LocalInput):
    name: str = Field(min_length=1, max_length=100)
    phone_e164: str = Field(pattern=r"^\+[1-9][0-9]{6,14}$", description="国际格式授权手机号，中国手机号填写 +86")
    is_active: bool = Field(default=True, strict=True)

    @field_validator("phone_e164", mode="before")
    @classmethod
    def normalize_phone(cls, value: object) -> object:
        if isinstance(value, str):
            value = value.strip()
            if len(value) == 11 and value.startswith("1") and value.isascii() and value.isdigit():
                return "+86" + value
        return value


class OperatorUpdate(OperatorInput):
    revision: int = Field(gt=0)


class OperatorRead(OperatorInput):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    user_id: UUID | None
    revision: int


class MerchantInput(OperatorInput):
    logo_asset_id: UUID | None = None
    description: Annotated[str, AfterValidator(restricted_html)] = Field(default="", max_length=20000)
    address: str = Field(default="", max_length=300)
    latitude: Decimal | None = Field(default=None, ge=-90, le=90, decimal_places=6, description="公开门店纬度，GCJ-02")
    longitude: Decimal | None = Field(
        default=None, ge=-180, le=180, decimal_places=6, description="公开门店经度，GCJ-02"
    )
    business_hours: str = Field(default="", max_length=200)
    public_phone: str = Field(default="", max_length=40)
    sort_order: int | None = Field(default=None, ge=0, le=2147483647)

    @model_validator(mode="after")
    def validate_map_coordinates(self) -> Self:
        supplied = self.model_fields_set & {"latitude", "longitude"}
        if len(supplied) == 1 or (self.latitude is None) != (self.longitude is None):
            raise ValueError("门店纬度和经度需同时填写或清空")
        return self


class MerchantUpdate(MerchantInput):
    revision: int = Field(gt=0)


class MerchantRead(MerchantInput):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    user_id: UUID | None
    revision: int
    logo_url: str | None = None


class PublicMerchantRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    logo_url: str | None = None
    description: str
    description_format: Literal["restricted_html_v1"] = "restricted_html_v1"
    address: str
    latitude: float | None = Field(default=None, description="公开门店纬度，GCJ-02")
    longitude: float | None = Field(default=None, description="公开门店经度，GCJ-02")
    business_hours: str
    public_phone: str
    is_active: bool


class LocalRolesRead(BaseModel):
    member: bool = True
    merchant_id: UUID | None
    property_operator_id: UUID | None


class PhoneLookup(LocalInput):
    phone_e164: str = Field(pattern=r"^\+[1-9][0-9]{6,14}$")

    @field_validator("phone_e164", mode="before")
    @classmethod
    def normalize_phone(cls, value: object) -> object:
        return OperatorInput.normalize_phone(value)


class PropertyTargetRead(BaseModel):
    id: UUID
    display_name: str | None
    phone_masked: str
    phone_verified_at: datetime


class PropertyGrantCreate(PhoneLookup):
    request_id: UUID
    user_id: UUID
    phone_verified_at: datetime
    points: str = Field(pattern=r"^[1-9][0-9]{0,18}$", description="正整数积分字符串，避免客户端大整数丢失")
    note: str = Field(default="", max_length=200)

    @field_validator("points")
    @classmethod
    def points_range(cls, value: str) -> str:
        if int(value) > 9223372036854775807:
            raise ValueError("积分超过数据库整数存储范围")
        return value


class PropertyGrantRead(BaseModel):
    id: UUID
    request_id: UUID
    user_id: UUID
    points: str
    note: str
    ledger_id: UUID
    created_at: datetime


class VoucherRead(BaseModel):
    order_id: UUID
    merchant_id: UUID
    status: str
    code: str | None = Field(default=None, repr=False, description="仅买家本人且待核销时返回")
    qr_data_url: str | None = Field(default=None, repr=False, description="仅买家本人待核销凭证的二维码PNG")
    expires_at: datetime
    redeemed_at: datetime | None
    items: list[str] = Field(default_factory=list, description="核销记录的订单商品快照")
    order_gross_amount: Decimal | None = None


class RedemptionPreviewInput(LocalInput):
    code: str = Field(min_length=32, max_length=64, pattern=r"^[A-Za-z0-9_-]+$", repr=False)


class RedemptionConfirmInput(RedemptionPreviewInput):
    request_id: UUID
    order_id: UUID


class RedemptionPreviewRead(BaseModel):
    order_id: UUID
    merchant_id: UUID
    merchant_name: str
    items: list[str]
    order_gross_amount: Decimal
    expires_at: datetime
    status: str


class ReceivableRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    merchant_id: UUID
    order_id: UUID
    gross_amount: Decimal
    cash_amount: Decimal
    points_amount: Decimal
    settlement_id: UUID | None
    created_at: datetime


class SettlementCreate(LocalInput):
    request_id: UUID
    merchant_id: UUID
    receivable_ids: list[UUID] = Field(min_length=1, max_length=100)

    @field_validator("receivable_ids")
    @classmethod
    def unique_items(cls, values: list[UUID]) -> list[UUID]:
        if len(set(values)) != len(values):
            raise ValueError("应收条目不能重复")
        return values


class SettlementPayment(LocalInput):
    request_id: UUID
    revision: int = Field(gt=0)
    amount: Decimal = Field(ge=0, max_digits=15, decimal_places=2)
    payment_reference: str = Field(min_length=1, max_length=100)
    paid_at: datetime


class SettlementReversal(LocalInput):
    request_id: UUID
    revision: int = Field(gt=0)
    reason: str = Field(min_length=1, max_length=300)


class SettlementEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    request_id: UUID
    revision: int
    kind: str
    amount: Decimal
    payment_reference: str
    paid_at: datetime
    reason: str
    created_at: datetime


class SettlementRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    merchant_id: UUID
    amount: Decimal
    status: str
    request_id: UUID
    payment_reference: str | None
    paid_at: datetime | None
    revision: int
    created_at: datetime
