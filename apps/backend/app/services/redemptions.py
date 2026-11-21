import asyncio
from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.error_codes import ErrorCode
from app.core.exceptions import AppException
from app.core.pagination import PageResult
from app.core.redemption_code import decrypt_code, digest, qr_data_url
from app.db.models import FulfillmentEvent, Merchant, MerchantReceivable, RedemptionVoucher
from app.db.repositories.local_commerce import LocalActorsRepository
from app.db.repositories.merchant_finance import MerchantFinanceRepository
from app.db.repositories.redemptions import RedemptionRepository
from app.db.transaction import transaction_scope
from app.domains.distribution import DistributionService
from app.domains.durable_tasks import DurableTaskService
from app.domains.lifecycle.repository import LifecycleRepository
from app.domains.lifecycle.schemas import RefundRequestCreate
from app.domains.orders.repository import OrderRepository
from app.services.local_actors import LocalActorsService, local_conflict
from app.services.local_commerce_schemas import RedemptionConfirmInput, RedemptionPreviewRead, VoucherRead
from app.services.payment_lifecycle import LifecycleService


class RedemptionService:
    def __init__(self, session: AsyncSession, *, actors: LocalActorsService | None = None) -> None:
        self.session = session
        self.repository = RedemptionRepository(session)
        self.orders = OrderRepository(session)
        self.lifecycle = LifecycleRepository(session)
        self.actors = actors or LocalActorsService(session)

    @staticmethod
    def read(voucher: RedemptionVoucher, *, buyer: bool = False) -> VoucherRead:
        available = voucher.status == "available" and voucher.expires_at > datetime.now(UTC)
        return VoucherRead(
            order_id=voucher.order_id,
            merchant_id=voucher.merchant_id,
            status="expired" if voucher.status == "available" and not available else voucher.status,
            code=decrypt_code(voucher.code_ciphertext) if buyer and available else None,
            expires_at=voucher.expires_at,
            redeemed_at=voucher.redeemed_at,
        )

    async def buyer_voucher(self, user_id: UUID, order_id: UUID) -> VoucherRead:
        order = await self.orders.order(user_id, order_id)
        voucher = await self.repository.for_order(order_id)
        if order is None or order.status != "paid" or voucher is None:
            raise AppException(status_code=404, code=ErrorCode.NOT_FOUND, message="尚无可查看的本人核销凭证")
        result = self.read(voucher, buyer=True)
        if result.code:
            result.qr_data_url = await asyncio.to_thread(qr_data_url, result.code)
        return result

    async def preview(self, user_id: UUID, code: str) -> RedemptionPreviewRead:
        merchant = await self.actors.require_role(Merchant, user_id)
        voucher = await self.repository.for_digest(digest(code))
        if voucher is None or voucher.merchant_id != merchant.id:
            raise AppException(status_code=404, code=ErrorCode.NOT_FOUND, message="未找到本商家的核销凭证")
        order = await self.orders.order_by_id(voucher.order_id)
        if order is None:
            raise local_conflict("核销订单不存在")
        if voucher.status != "available" or voucher.expires_at <= datetime.now(UTC):
            raise local_conflict("核销码已使用、过期或退款")
        return RedemptionPreviewRead(
            order_id=order.id,
            merchant_id=merchant.id,
            merchant_name=merchant.name,
            items=[f"{item.product_name} × {item.quantity}" for item in await self.orders.items(order.id)],
            order_gross_amount=order.order_gross_amount,
            expires_at=voucher.expires_at,
            status=voucher.status,
        )

    async def confirm(self, user_id: UUID, data: RedemptionConfirmInput) -> VoucherRead:
        async with transaction_scope(self.session):
            await LocalActorsRepository(self.session).lock_bindings()
            merchant = await self.actors.require_role(Merchant, user_id, lock=True)
            original = await self.repository.for_request(data.request_id)
            if original is not None and original.order_id != data.order_id:
                raise local_conflict("该请求号已用于其他核销订单")
            order = await self.orders.order_by_id(data.order_id, lock=True)
            voucher = await self.repository.for_order(data.order_id, lock=True)
            if (
                order is None
                or voucher is None
                or voucher.merchant_id != merchant.id
                or order.merchant_id != merchant.id
                or voucher.code_digest != digest(data.code)
            ):
                raise AppException(status_code=404, code=ErrorCode.NOT_FOUND, message="未找到本商家的核销凭证")
            if (
                voucher.status == "redeemed"
                and voucher.request_id == data.request_id
                and voucher.redeemed_by_id == user_id
            ):
                return self.read(voucher)
            now = datetime.now(UTC)
            if order.status != "paid" or voucher.status != "available" or voucher.expires_at <= now:
                raise local_conflict("订单已核销、到期或退款，不能核销")
            refunds = await self.lifecycle.refunds_for_order(order.id, lock=True)
            if any(row.status != "rejected" for row in refunds):
                raise local_conflict("订单正在退款")
            fulfillment = await self.lifecycle.fulfillment(order.id, lock=True)
            if fulfillment is None or fulfillment.status != "awaiting_delivery":
                raise local_conflict("订单履约状态不支持核销")
            voucher.status, voucher.redeemed_at, voucher.redeemed_by_id, voucher.request_id = (
                "redeemed",
                now,
                user_id,
                data.request_id,
            )
            await self.repository.save(voucher)
            fulfillment.status, fulfillment.delivered_at = "delivered", now
            fulfillment.delivery_reference = f"redemption:{voucher.id}"
            fulfillment.revision += 1
            await self.lifecycle.save(fulfillment)
            await self.lifecycle.save(
                FulfillmentEvent(
                    fulfillment_id=fulfillment.id,
                    revision=fulfillment.revision,
                    from_status="awaiting_delivery",
                    to_status="delivered",
                    actor_type="user",
                    actor_id=user_id,
                    reason="所属商家完成整单核销",
                )
            )
            await MerchantFinanceRepository(self.session).save(
                MerchantReceivable(
                    merchant_id=merchant.id,
                    order_id=order.id,
                    voucher_id=voucher.id,
                    gross_amount=order.order_gross_amount,
                    cash_amount=order.total_amount,
                    points_amount=Decimal(order.points_deduction),
                )
            )
            await DistributionService(self.session).schedule_settlement_for_delivery_in_open_transaction(order.id, now)
            payment = (
                await self.lifecycle.payment(order.accepted_payment_attempt_id)
                if order.accepted_payment_attempt_id
                else None
            )
            if payment is not None and payment.channel == "wechat":
                await DurableTaskService(self.session).enqueue_in_open_transaction(
                    task_type="wechat_shipping",
                    business_key=f"wechat-shipping:{fulfillment.id}",
                    payload={"schema_version": 1, "fulfillment_id": str(fulfillment.id)},
                )
            return self.read(voucher)

    async def records(self, user_id: UUID, page: int, page_size: int) -> PageResult[VoucherRead]:
        merchant = await self.actors.require_role(Merchant, user_id)
        rows, total = await self.repository.page(merchant.id, page, page_size)
        orders, order_items = await self.repository.order_snapshots([row.order_id for row in rows])
        items = []
        for row in rows:
            record = self.read(row)
            record.items = [f"{item.product_name} × {item.quantity}" for item in order_items.get(row.order_id, [])]
            order = orders.get(row.order_id)
            if order is None:
                raise local_conflict("核销记录的订单不存在")
            record.order_gross_amount = order.order_gross_amount
            items.append(record)
        return PageResult[VoucherRead].create(items=items, total=total, page=page, page_size=page_size)

    async def expire(self, order_id: UUID) -> None:
        voucher = await self.repository.for_order(order_id)
        order = await self.orders.order_by_id(order_id)
        if voucher is None or order is None:
            raise local_conflict("到期任务的订单或凭证不存在")
        if voucher.status != "available":
            return
        if voucher.expires_at > datetime.now(UTC):
            raise local_conflict("到期任务提前执行")
        await LifecycleService(self.session).create_refund(
            order.user_id,
            order_id,
            RefundRequestCreate(request_id=voucher.id, reason="成交七天未核销自动整单退款"),
            expired_voucher=True,
        )
