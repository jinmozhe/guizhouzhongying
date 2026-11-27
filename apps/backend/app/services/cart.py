import builtins
from typing import Literal, cast
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.error_codes import ErrorCode
from app.core.exceptions import AppException
from app.core.identifiers import new_uuid7
from app.db.models.cart import CartItem
from app.db.repositories.local_commerce import LocalActorsRepository
from app.db.transaction import transaction_scope
from app.domains.cart.repository import CartRepository
from app.domains.cart.schemas import CartItemInput, CartItemRead, CartItemUpdate, ConsumerCartItemRead
from app.domains.inventory import InventoryService
from app.domains.inventory.repository import InventoryRepository
from app.domains.products import ProductService
from app.domains.products.repository import ProductRepository
from app.domains.users import UserAccessService


class CartService:
    def __init__(
        self,
        session: AsyncSession,
        repository: CartRepository | None = None,
        *,
        access: UserAccessService | None = None,
    ) -> None:
        self.session = session
        self.repository = repository or CartRepository(session)
        self.access = access or UserAccessService(session)
        self.products = ProductService(ProductRepository(session))
        self.inventory = InventoryService(InventoryRepository(session))

    async def _available(self, sku_id: UUID) -> int:
        await self.products.checkout_skus([sku_id])
        return (await self.inventory.read(sku_id)).available

    async def list(self, user_id: UUID) -> builtins.list[ConsumerCartItemRead]:
        await self.access.require_active_user(user_id)
        rows = await self.repository.list_for_user(user_id)
        products = {
            sku.id: (sku, product)
            for sku, product in await self.products.repository.checkout_skus([row.sku_id for row in rows])
        }
        saleable = await self.products.available_sku_ids([row.sku_id for row in rows])
        inventories = {
            account.sku_id: account.available
            for account in await self.inventory.repository.available_accounts([row.sku_id for row in rows])
        }
        product_images = await self.products.repository.image_urls_for_products(
            list({product.id for _, product in products.values()})
        )
        merchant_ids = list(
            {product.merchant_id for _, product in products.values() if product.merchant_id is not None}
        )
        merchants = (
            {
                merchant.id: (merchant.name, logo_url)
                for merchant, logo_url in await LocalActorsRepository(self.session).public_merchants(merchant_ids)
            }
            if merchant_ids
            else {}
        )
        result: builtins.list[ConsumerCartItemRead] = []
        for row in rows:
            found = products.get(row.sku_id)
            reason: str | None = None
            available = 0
            price = None
            max_points_deduction = 0
            images: builtins.list[str] = []
            if found is None:
                reason = "商品规格已移除"
            else:
                sku, product = found
                if row.sku_id not in saleable:
                    reason = "商品或规格当前不可售"
                if reason is None:
                    if row.sku_id not in inventories:
                        raise AppException(
                            status_code=409, code=ErrorCode.INVENTORY_NOT_FOUND, message="库存账户缺失，请联系管理员"
                        )
                    available = inventories[row.sku_id]
                    price = sku.price
                    if product.fulfillment_mode == "local":
                        max_points_deduction = min(sku.max_points_deduction, int(price))
                    if available < row.quantity:
                        reason = "库存不足，请调整数量"
                images = product_images.get(product.id, [])
            merchant_id = found[1].merchant_id if found else None
            merchant_info = merchants.get(merchant_id) if merchant_id is not None else None
            result.append(
                ConsumerCartItemRead(
                    **CartItemRead.model_validate(row).model_dump(),
                    merchant_id=merchant_id,
                    merchant_name=merchant_info[0] if merchant_info else None,
                    merchant_logo_url=merchant_info[1] if merchant_info else None,
                    product_id=found[1].id if found else None,
                    product_type=cast(Literal["physical", "virtual"], found[1].product_type) if found else None,
                    product_name=found[1].name if found else "已失效商品",
                    image_url=images[0] if images else None,
                    specifications=found[0].specifications if found else {},
                    unit_price=price,
                    max_points_deduction=max_points_deduction,
                    available_quantity=available,
                    invalid_reason=reason,
                )
            )
        return result

    async def _merchant_for_sku(self, sku_id: UUID) -> UUID | None:
        matched = await self.products.repository.checkout_skus([sku_id])
        return matched[0][1].merchant_id if matched else None

    async def _deselect_other_merchants(self, user_id: UUID, keep_merchant_id: UUID | None) -> None:
        if keep_merchant_id is None:
            return
        rows = [row for row in await self.repository.list_for_user(user_id) if row.selected]
        if not rows:
            return
        sku_merchants = {
            sku.id: product.merchant_id
            for sku, product in await self.products.repository.checkout_skus([row.sku_id for row in rows])
        }
        for row in rows:
            if sku_merchants.get(row.sku_id) != keep_merchant_id:
                row.selected = False
                row.revision += 1
                await self.repository.save(row)

    async def add(self, user_id: UUID, data: CartItemInput) -> CartItemRead:
        async with transaction_scope(self.session):
            await self.access.require_active_user(user_id)
            await self.repository.lock_user(user_id)
            available = await self._available(data.sku_id)
            if available is None or available < data.quantity:
                raise AppException(status_code=409, code=ErrorCode.CHECKOUT_INVALID, message="商品不可售或库存不足")
            target_merchant = await self._merchant_for_sku(data.sku_id)
            existing = await self.repository.get_by_sku(user_id, data.sku_id, lock=True)
            if existing is not None:
                if existing.quantity + data.quantity > 999:
                    raise AppException(
                        status_code=409, code=ErrorCode.CART_QUANTITY_REJECTED, message="购物车数量超过上限"
                    )
                if existing.quantity + data.quantity > available:
                    raise AppException(status_code=409, code=ErrorCode.CHECKOUT_INVALID, message="商品库存不足")
                existing.quantity += data.quantity
                existing.selected = True
                existing.revision += 1
                await self.repository.save(existing)
                await self._deselect_other_merchants(user_id, target_merchant)
                return CartItemRead.model_validate(existing)
            if await self.repository.count_for_user(user_id) >= 100:
                raise AppException(status_code=409, code=ErrorCode.CART_LIMIT, message="购物车条目达到上限")
            await self._deselect_other_merchants(user_id, target_merchant)
            row = CartItem(
                id=new_uuid7(), user_id=user_id, sku_id=data.sku_id, quantity=data.quantity, selected=True, revision=1
            )
            await self.repository.save(row)
            return CartItemRead.model_validate(row)

    async def update(self, user_id: UUID, item_id: UUID, data: CartItemUpdate) -> CartItemRead:
        async with transaction_scope(self.session):
            await self.access.require_active_user(user_id)
            await self.repository.lock_user(user_id)
            row = await self.repository.get(user_id, item_id, lock=True)
            if row is None:
                raise AppException(status_code=404, code=ErrorCode.CART_ITEM_NOT_FOUND, message="购物车条目不存在")
            if row.revision != data.revision:
                raise AppException(
                    status_code=409, code=ErrorCode.CART_REVISION_CONFLICT, message="购物车已变更，请重新读取"
                )
            if data.quantity is not None:
                available = await self._available(row.sku_id)
                if available is None or data.quantity > available:
                    raise AppException(status_code=409, code=ErrorCode.CHECKOUT_INVALID, message="商品不可售或库存不足")
                row.quantity = data.quantity
            if data.selected is not None:
                row.selected = data.selected
            row.revision += 1
            await self.repository.save(row)
            if data.selected is True:
                await self._deselect_other_merchants(user_id, await self._merchant_for_sku(row.sku_id))
            return CartItemRead.model_validate(row)

    async def remove(self, user_id: UUID, item_id: UUID) -> None:
        async with transaction_scope(self.session):
            await self.access.require_active_user(user_id)
            await self.repository.lock_user(user_id)
            row = await self.repository.get(user_id, item_id, lock=True)
            if row is None:
                raise AppException(status_code=404, code=ErrorCode.CART_ITEM_NOT_FOUND, message="购物车条目不存在")
            await self.repository.delete(row)
