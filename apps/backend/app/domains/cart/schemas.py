from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class CartItemInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sku_id: UUID
    quantity: int = Field(ge=1, le=999)


class CartItemUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(gt=0, description="读取购物车条目时获得的版本")
    quantity: int | None = Field(default=None, ge=1, le=999)
    selected: bool | None = None


class CartItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    sku_id: UUID
    quantity: int
    selected: bool
    revision: int


class ConsumerCartItemRead(CartItemRead):
    merchant_id: UUID | None
    merchant_name: str | None = None
    merchant_logo_url: str | None = None
    product_id: UUID | None
    product_type: Literal["physical", "virtual"] | None
    product_name: str
    image_url: str | None
    specifications: dict[str, str]
    unit_price: Decimal | None
    max_points_deduction: int = 0
    available_quantity: int
    invalid_reason: str | None
