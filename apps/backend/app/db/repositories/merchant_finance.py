from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import MerchantPaymentEvent, MerchantReceivable, MerchantSettlement


class MerchantFinanceRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def page[T: MerchantReceivable | MerchantSettlement](
        self,
        model: type[T],
        page: int,
        page_size: int,
        merchant_id: UUID | None,
        *,
        merchant_ids: list[UUID] | None = None,
    ) -> tuple[list[T], int]:
        query = select(model)
        if merchant_id is not None:
            query = query.where(model.merchant_id == merchant_id)
        if merchant_ids is not None:
            if not merchant_ids:
                return [], 0
            query = query.where(model.merchant_id.in_(merchant_ids))
        total = int(await self.session.scalar(select(func.count()).select_from(query.subquery())) or 0)
        return list(
            await self.session.scalars(query.order_by(model.id.desc()).offset((page - 1) * page_size).limit(page_size))
        ), total

    async def receivables(self, ids: list[UUID]) -> list[MerchantReceivable]:
        return list(
            await self.session.scalars(
                select(MerchantReceivable)
                .where(MerchantReceivable.id.in_(ids))
                .order_by(MerchantReceivable.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        )

    async def settlement(self, settlement_id: UUID) -> MerchantSettlement | None:
        return (
            await self.session.scalars(
                select(MerchantSettlement)
                .where(MerchantSettlement.id == settlement_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).one_or_none()

    async def by_request(self, request_id: UUID) -> MerchantSettlement | None:
        return (
            await self.session.scalars(select(MerchantSettlement).where(MerchantSettlement.request_id == request_id))
        ).one_or_none()

    async def settlement_items(self, settlement_id: UUID) -> list[UUID]:
        return list(
            await self.session.scalars(
                select(MerchantReceivable.id).where(MerchantReceivable.settlement_id == settlement_id)
            )
        )

    async def payment_reference_exists(self, reference: str, excluding: UUID) -> bool:
        return (
            await self.session.scalar(
                select(MerchantSettlement.id).where(
                    MerchantSettlement.payment_reference == reference, MerchantSettlement.id != excluding
                )
            )
            is not None
        )

    async def payment_event(self, request_id: UUID) -> MerchantPaymentEvent | None:
        return (
            await self.session.scalars(
                select(MerchantPaymentEvent).where(MerchantPaymentEvent.request_id == request_id)
            )
        ).one_or_none()

    async def events(self, settlement_id: UUID) -> list[MerchantPaymentEvent]:
        return list(
            await self.session.scalars(
                select(MerchantPaymentEvent)
                .where(MerchantPaymentEvent.settlement_id == settlement_id)
                .order_by(MerchantPaymentEvent.revision)
            )
        )

    async def save(self, value: MerchantReceivable | MerchantSettlement | MerchantPaymentEvent) -> None:
        self.session.add(value)
        await self.session.flush()
