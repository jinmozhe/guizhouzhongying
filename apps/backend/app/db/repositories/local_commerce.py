from uuid import UUID

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Asset, LocalBindingEvent, Merchant, PropertyGrant, PropertyOperator, User


class LocalActorsRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def lock_bindings(self) -> None:
        # Binding mutations and phone binding share this guard before user/actor row locks.
        await self.session.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
            {"key": "guizhouzhongying:local-actors:bindings"},
        )

    async def actor[T: Merchant | PropertyOperator](
        self, model: type[T], actor_id: UUID, *, lock: bool = False
    ) -> T | None:
        query = select(model).where(model.id == actor_id).execution_options(populate_existing=True)
        if lock:
            query = query.with_for_update()
        return (await self.session.scalars(query)).one_or_none()

    async def by_phone[T: Merchant | PropertyOperator](self, model: type[T], phone: str) -> T | None:
        return (
            await self.session.scalars(
                select(model).where(model.phone_e164 == phone).execution_options(populate_existing=True)
            )
        ).one_or_none()

    async def by_user[T: Merchant | PropertyOperator](
        self, model: type[T], user_id: UUID, *, lock: bool = False
    ) -> T | None:
        query = select(model).where(model.user_id == user_id).execution_options(populate_existing=True)
        if lock:
            query = query.with_for_update()
        return (await self.session.scalars(query)).one_or_none()

    async def user(self, user_id: UUID, *, lock: bool = False) -> User | None:
        query = select(User).where(User.id == user_id).execution_options(populate_existing=True)
        if lock:
            query = query.with_for_update(key_share=True)
        return (await self.session.scalars(query)).one_or_none()

    async def user_by_phone(self, phone: str) -> User | None:
        return (
            await self.session.scalars(
                select(User).where(User.phone_e164 == phone).execution_options(populate_existing=True)
            )
        ).one_or_none()

    async def public_merchants(self, ids: list[UUID]) -> list[tuple[Merchant, str | None]]:
        rows = await self.session.execute(
            select(Merchant, Asset.url).outerjoin(Asset, Asset.id == Merchant.logo_asset_id).where(Merchant.id.in_(ids))
        )
        by_id = {merchant.id: (merchant, url) for merchant, url in rows.tuples()}
        return [by_id[value] for value in ids if value in by_id]

    async def asset(self, asset_id: UUID, *, lock: bool = False) -> Asset | None:
        query = select(Asset).where(Asset.id == asset_id)
        if lock:
            query = query.with_for_update()
        return (await self.session.scalars(query)).one_or_none()

    async def page[T: Merchant | PropertyOperator](
        self, model: type[T], page: int, page_size: int, search: str | None = None, *, public: bool = False
    ) -> tuple[list[T], int]:
        query = select(model)
        if public:
            query = query.where(model.is_active.is_(True))
        if search:
            query = query.where(model.name.contains(search, autoescape=True) | (model.phone_e164 == search))
        total = int(await self.session.scalar(select(func.count()).select_from(query.subquery())) or 0)
        return list(
            await self.session.scalars(query.order_by(model.id.desc()).offset((page - 1) * page_size).limit(page_size))
        ), total

    async def grant(self, operator_id: UUID, request_id: UUID) -> PropertyGrant | None:
        return (
            await self.session.scalars(
                select(PropertyGrant).where(
                    PropertyGrant.operator_id == operator_id, PropertyGrant.request_id == request_id
                )
            )
        ).one_or_none()

    async def grant_page(
        self, operator_id: UUID, page: int, page_size: int, actor_id: UUID
    ) -> tuple[list[PropertyGrant], int]:
        query = select(PropertyGrant).where(
            PropertyGrant.operator_id == operator_id, PropertyGrant.actor_id == actor_id
        )
        total = int(await self.session.scalar(select(func.count()).select_from(query.subquery())) or 0)
        return list(
            await self.session.scalars(
                query.order_by(PropertyGrant.id.desc()).offset((page - 1) * page_size).limit(page_size)
            )
        ), total

    async def save(self, value: Merchant | PropertyOperator | PropertyGrant | LocalBindingEvent) -> None:
        self.session.add(value)
        await self.session.flush()
