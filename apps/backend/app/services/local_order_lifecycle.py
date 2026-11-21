from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.redemption_code import generate_code
from app.db.models import Order, RedemptionVoucher
from app.db.repositories.redemptions import RedemptionRepository
from app.domains.durable_tasks import DurableTaskService
from app.domains.points import PointsService
from app.services.local_actors import local_conflict


class LocalOrderLifecycle:
    """由交易用例持有订单锁和事务，统一积分与凭证状态。"""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repository = RedemptionRepository(session)

    async def confirm_in_open_transaction(self, order: Order) -> None:
        if order.fulfillment_mode != "local":
            return
        if order.merchant_id is None:
            raise local_conflict("到店订单缺少商家")
        existing = await self.repository.for_order(order.id, lock=True)
        if existing is not None:
            return
        code_digest, ciphertext = generate_code()
        # Server acceptance, rather than a delayed channel notification's timestamp.
        expires_at = datetime.now(UTC) + timedelta(days=7)
        await self.repository.save(
            RedemptionVoucher(
                order_id=order.id,
                merchant_id=order.merchant_id,
                code_digest=code_digest,
                code_ciphertext=ciphertext,
                status="available",
                expires_at=expires_at,
            )
        )
        await DurableTaskService(self.session).enqueue_in_open_transaction(
            task_type="expire_redemption",
            business_key=str(order.id),
            payload={"schema_version": 1, "order_id": str(order.id)},
            available_at=expires_at,
        )

    async def begin_refund_in_open_transaction(self, order_id: UUID) -> None:
        voucher = await self.repository.for_order(order_id, lock=True)
        if voucher is None or voucher.status != "available":
            raise local_conflict("该到店订单已核销或正在退款")
        voucher.status = "refunding"
        await self.repository.save(voucher)

    async def complete_refund_in_open_transaction(self, order_id: UUID) -> None:
        voucher = await self.repository.for_order(order_id, lock=True)
        if voucher is None:
            return
        if voucher.status == "refunded":
            return
        if voucher.status != "refunding":
            raise local_conflict("核销凭证状态与退款不一致")
        await PointsService(session=self.session).transition_order_in_open_transaction(order_id, "refunded")
        voucher.status = "refunded"
        await self.repository.save(voucher)
