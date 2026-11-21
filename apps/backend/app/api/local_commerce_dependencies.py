from typing import Annotated

from fastapi import Depends, Request

from app.api.dependencies import (
    CurrentAdmin,
    CurrentUser,
    DatabaseSession,
    get_current_admin,
    get_current_user,
    get_phone_user,
    get_request_settings,
    get_resources,
)
from app.core.rate_limit import enforce_rate_limit
from app.core.request_metadata import request_metadata
from app.services.admin_audit import AdminAuditCoordinator
from app.services.local_actors import LocalActorsService
from app.services.merchant_finance import MerchantFinanceService
from app.services.redemptions import RedemptionService
from app.services.security_events import AuditCoordinator


def get_local_actors(session: DatabaseSession) -> LocalActorsService:
    return LocalActorsService(session)


def get_admin_local_actors(
    request: Request, session: DatabaseSession, current: Annotated[CurrentAdmin, Depends(get_current_admin)]
) -> LocalActorsService:
    return LocalActorsService(
        session,
        actor_id=current.admin.id,
        audit=AdminAuditCoordinator(
            audit=AuditCoordinator(
                session=session,
                session_factory=get_resources(request).session_factory,
                actor_id=current.admin.id,
                metadata=request_metadata(request),
            ),
            session=session,
            actor_id=current.admin.id,
            session_id=current.login_session.id,
        ),
    )


LocalActors = Annotated[LocalActorsService, Depends(get_local_actors)]
AdminLocalActors = Annotated[LocalActorsService, Depends(get_admin_local_actors)]


async def local_user(request: Request, current: Annotated[CurrentUser, Depends(get_phone_user)]) -> CurrentUser:
    environment = get_request_settings(request).environment
    await enforce_rate_limit(
        get_resources(request).redis,
        key=f"guizhouzhongying:{environment}:local-commerce:rate-limit:v1:user:{current.user.id}",
        limit=120,
        window_seconds=60,
    )
    return current


LocalUser = Annotated[CurrentUser, Depends(local_user)]
BasicUser = Annotated[CurrentUser, Depends(get_current_user)]


def get_user_actors(session: DatabaseSession, current: LocalUser) -> LocalActorsService:
    return LocalActorsService(
        session, consumer_session_id=current.login_session.id, credential_version=current.user.credential_version
    )


UserLocalActors = Annotated[LocalActorsService, Depends(get_user_actors)]


def get_redemptions(session: DatabaseSession, actors: UserLocalActors) -> RedemptionService:
    return RedemptionService(session, actors=actors)


def get_finance(session: DatabaseSession) -> MerchantFinanceService:
    return MerchantFinanceService(session)


def get_admin_finance(session: DatabaseSession, actors: AdminLocalActors) -> MerchantFinanceService:
    return MerchantFinanceService(session, audit=actors.audit, actor_id=actors.actor_id)


Redemptions = Annotated[RedemptionService, Depends(get_redemptions)]
MerchantFinance = Annotated[MerchantFinanceService, Depends(get_finance)]
AdminMerchantFinance = Annotated[MerchantFinanceService, Depends(get_admin_finance)]
