from uuid import UUID

from sqlalchemy import Select, and_, func, or_, select, text, true
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Asset, LocalBindingEvent, Merchant, PropertyGrant, PropertyOperator, User

_OPENING_TIME = r"(?:[01]?[0-9]|2[0-3]):[0-5][0-9]"
_CLOSING_TIME = rf"(?:{_OPENING_TIME}|24:00)"
_HOURS_PREFIX = r"^\s*(?:每日|每天)?\s*"
_HOURS_SEPARATOR = r"\s*[-–—~～至]\s*"
_HOURS_SUFFIX = r"\s*$"


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

    async def public_merchant_page(
        self, scope: Select[tuple[UUID]], *, page: int, page_size: int, open_at: str | None
    ) -> tuple[list[tuple[Merchant, str | None]], int]:
        visible = scope
        if open_at is not None:
            opens = func.lpad(
                func.substring(
                    Merchant.business_hours,
                    rf"{_HOURS_PREFIX}({_OPENING_TIME}){_HOURS_SEPARATOR}{_CLOSING_TIME}{_HOURS_SUFFIX}",
                ),
                5,
                "0",
            ).collate("C")
            closes = func.lpad(
                func.substring(
                    Merchant.business_hours,
                    rf"{_HOURS_PREFIX}{_OPENING_TIME}{_HOURS_SEPARATOR}({_CLOSING_TIME}){_HOURS_SUFFIX}",
                ),
                5,
                "0",
            ).collate("C")
            visible = visible.where(
                or_(
                    and_(opens < closes, opens <= open_at, closes > open_at),
                    and_(opens > closes, or_(opens <= open_at, closes > open_at)),
                )
            )
        matching = visible.add_columns(Merchant.sort_order).cte("matching_merchants")
        totals = select(func.count().label("total")).select_from(matching).subquery()
        page_rows = (
            select(matching.c.id, matching.c.sort_order)
            .order_by(matching.c.sort_order.asc().nulls_last(), matching.c.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .subquery()
        )
        # Keep the count row even when the requested page is empty.
        result = await self.session.execute(
            select(Merchant, Asset.url, totals.c.total)
            .select_from(totals)
            .outerjoin(page_rows, true())
            .outerjoin(Merchant, Merchant.id == page_rows.c.id)
            .outerjoin(Asset, Asset.id == Merchant.logo_asset_id)
            .order_by(page_rows.c.sort_order.asc().nulls_last(), page_rows.c.id.desc())
        )
        rows = result.tuples().all()
        return [(merchant, url) for merchant, url, _ in rows if merchant is not None], int(rows[0][2])

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
