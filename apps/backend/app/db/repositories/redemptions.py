from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Order, OrderItem, RedemptionVoucher


class RedemptionRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def for_order(self, order_id: UUID, *, lock: bool = False) -> RedemptionVoucher | None:
        query = (
            select(RedemptionVoucher)
            .where(RedemptionVoucher.order_id == order_id)
            .execution_options(populate_existing=True)
        )
        if lock:
            query = query.with_for_update()
        return (await self.session.scalars(query)).one_or_none()

    async def for_digest(self, code_digest: str) -> RedemptionVoucher | None:
        return (
            await self.session.scalars(select(RedemptionVoucher).where(RedemptionVoucher.code_digest == code_digest))
        ).one_or_none()

    async def for_request(self, request_id: UUID) -> RedemptionVoucher | None:
        return (
            await self.session.scalars(select(RedemptionVoucher).where(RedemptionVoucher.request_id == request_id))
        ).one_or_none()

    async def page(self, merchant_id: UUID, page: int, page_size: int) -> tuple[list[RedemptionVoucher], int]:
        query = select(RedemptionVoucher).where(
            RedemptionVoucher.merchant_id == merchant_id, RedemptionVoucher.status == "redeemed"
        )
        total = int(await self.session.scalar(select(func.count()).select_from(query.subquery())) or 0)
        return list(
            await self.session.scalars(
                query.order_by(RedemptionVoucher.id.desc()).offset((page - 1) * page_size).limit(page_size)
            )
        ), total

    async def save(self, voucher: RedemptionVoucher) -> None:
        self.session.add(voucher)
        await self.session.flush()

    async def order_snapshots(self, order_ids: list[UUID]) -> tuple[dict[UUID, Order], dict[UUID, list[OrderItem]]]:
        orders = {row.id: row for row in await self.session.scalars(select(Order).where(Order.id.in_(order_ids)))}
        items: dict[UUID, list[OrderItem]] = {}
        for item in await self.session.scalars(
            select(OrderItem).where(OrderItem.order_id.in_(order_ids)).order_by(OrderItem.id)
        ):
            items.setdefault(item.order_id, []).append(item)
        return orders, items
