import hashlib
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.batch import ActiveStatusBatch, BatchCompleted
from app.core.error_codes import ErrorCode
from app.core.exceptions import AppException
from app.core.identifiers import new_uuid7
from app.core.pagination import PageResult
from app.db.models import LocalBindingEvent, Merchant, PropertyGrant, PropertyOperator, User
from app.db.repositories import SessionRepository
from app.db.repositories.local_commerce import LocalActorsRepository
from app.db.transaction import transaction_scope
from app.domains.admin.permissions import PermissionCode
from app.domains.points import PointsService
from app.domains.products.repository import ProductRepository
from app.services.admin_audit import AdminAuditCoordinator
from app.services.local_commerce_schemas import (
    LocalRolesRead,
    MerchantInput,
    MerchantRead,
    MerchantUpdate,
    OperatorInput,
    OperatorRead,
    OperatorUpdate,
    PropertyGrantCreate,
    PropertyGrantRead,
    PropertyTargetRead,
    PublicMerchantRead,
)


def local_conflict(message: str) -> AppException:
    return AppException(status_code=409, code=ErrorCode.STATE_CONFLICT, message=message)


class LocalActorsService:
    def __init__(
        self,
        session: AsyncSession,
        *,
        audit: AdminAuditCoordinator | None = None,
        actor_id: UUID | None = None,
        consumer_session_id: UUID | None = None,
        credential_version: int | None = None,
    ) -> None:
        self.session = session
        self.repository = LocalActorsRepository(session)
        self.audit, self.actor_id = audit, actor_id
        self.consumer_session_id, self.credential_version = consumer_session_id, credential_version

    async def validate_session(self, user: User) -> None:
        if self.consumer_session_id is None:
            return
        current = await SessionRepository(self.session).get_web(self.consumer_session_id, for_update=True)
        now = datetime.now(UTC)
        if (
            current is None
            or current.user_id != user.id
            or current.credential_profile != "miniapp_bearer"
            or current.client_id != "pinjie-miniapp"
            or current.csrf_digest is not None
            or current.revoked_at is not None
            or current.idle_expires_at <= now
            or current.absolute_expires_at <= now
            or user.credential_version != self.credential_version
        ):
            raise AppException(
                status_code=401, code=ErrorCode.AUTH_SESSION_REVOKED, message="登录状态已变化，请重新登录"
            )

    async def synchronize_phone_in_open_transaction(self, user: User) -> None:
        """调用方先取绑定保护锁及用户锁，双向建档共用同一规则。"""
        if not user.phone_bound or not user.is_active or user.deleted_at is not None or user.phone_e164 is None:
            return
        for model, role in ((Merchant, "merchant"), (PropertyOperator, "property")):
            row = await self.repository.by_phone(model, user.phone_e164)
            if row is not None and row.user_id != user.id:
                if row.user_id is not None:
                    raise local_conflict("该手机号已有其他业务身份关联，请联系后台核实")
                row.user_id = user.id
                row.revision += 1
                await self.repository.save(row)
                await self.repository.save(
                    LocalBindingEvent(
                        role=role,
                        resource_id=row.id,
                        previous_user_id=None,
                        user_id=user.id,
                        actor_id=None,
                        reason="可信手机号自动匹配",
                    )
                )

    async def _valid_user(self, user_id: UUID, *, lock: bool = False) -> User:
        user = await self.repository.user(user_id, lock=lock)
        if user is None or not user.is_active or user.deleted_at is not None or not user.phone_bound:
            raise AppException(
                status_code=403, code=ErrorCode.PERMISSION_DENIED, message="需要有效且已绑定手机号的用户"
            )
        return user

    async def require_role[T: Merchant | PropertyOperator](
        self, model: type[T], user_id: UUID, *, lock: bool = False
    ) -> T:
        user = await self._valid_user(user_id, lock=lock)
        if lock:
            await self.validate_session(user)
        row = await self.repository.by_user(model, user_id, lock=lock)
        if row is None or not row.is_active or row.phone_e164 != user.phone_e164:
            raise AppException(status_code=403, code=ErrorCode.PERMISSION_DENIED, message="当前业务身份已失效")
        return row

    async def roles(self, user_id: UUID) -> LocalRolesRead:
        user = await self.repository.user(user_id)
        if user is None or not user.is_active or user.deleted_at is not None:
            raise AppException(status_code=403, code=ErrorCode.PERMISSION_DENIED, message="当前用户不可用")
        merchant = await self.repository.by_user(Merchant, user_id)
        operator = await self.repository.by_user(PropertyOperator, user_id)
        return LocalRolesRead(
            merchant_id=merchant.id
            if merchant and merchant.is_active and user.phone_bound and merchant.phone_e164 == user.phone_e164
            else None,
            property_operator_id=operator.id
            if operator and operator.is_active and user.phone_bound and operator.phone_e164 == user.phone_e164
            else None,
        )

    async def merchant_read(self, row: Merchant) -> MerchantRead:
        asset = await self.repository.asset(row.logo_asset_id) if row.logo_asset_id else None
        return MerchantRead.model_validate(row).model_copy(update={"logo_url": asset.url if asset else None})

    async def public_merchant(self, merchant_id: UUID) -> PublicMerchantRead:
        row = await self.repository.actor(Merchant, merchant_id)
        if row is None:
            raise AppException(status_code=404, code=ErrorCode.NOT_FOUND, message="商家不存在")
        result = PublicMerchantRead.model_validate(row)
        asset = await self.repository.asset(row.logo_asset_id) if row.logo_asset_id else None
        result.logo_url = asset.url if asset else None
        return result

    async def category_merchants(self, category_id: UUID | None, search: str | None) -> list[PublicMerchantRead]:
        ids = await ProductRepository(self.session).public_merchant_ids(category_id, search)
        return [
            PublicMerchantRead.model_validate(row).model_copy(update={"logo_url": url})
            for row, url in await self.repository.public_merchants(ids)
        ]

    async def merchants(self, page: int, page_size: int, search: str | None) -> PageResult[MerchantRead]:
        rows, total = await self.repository.page(Merchant, page, page_size, search)
        return PageResult[MerchantRead].create(
            items=[await self.merchant_read(row) for row in rows], total=total, page=page, page_size=page_size
        )

    async def operators(self, page: int, page_size: int, search: str | None) -> PageResult[OperatorRead]:
        rows, total = await self.repository.page(PropertyOperator, page, page_size, search)
        return PageResult[OperatorRead].create(
            items=[OperatorRead.model_validate(row) for row in rows], total=total, page=page, page_size=page_size
        )

    async def _save[T: Merchant | PropertyOperator](
        self, model: type[T], data: OperatorInput, resource_id: UUID | None
    ) -> T:
        await self.repository.lock_bindings()
        owner = await self.repository.by_phone(model, data.phone_e164)
        if owner is not None and owner.id != resource_id:
            raise local_conflict("该手机号已建立相同业务身份")
        user = await self.repository.user_by_phone(data.phone_e164)
        if user is not None:
            user = await self._valid_user(user.id, lock=True)
        if resource_id is None:
            row = model(id=new_uuid7(), revision=1)
            previous_user = None
        else:
            existing = await self.repository.actor(model, resource_id, lock=True)
            if (
                existing is None
                or not isinstance(data, (MerchantUpdate, OperatorUpdate))
                or existing.revision != data.revision
            ):
                raise local_conflict("资料已变化，请刷新后重试")
            row = existing
            previous_user = row.user_id
            row.revision += 1
        for field, value in data.model_dump(exclude={"revision"}).items():
            setattr(row, field, value)
        if isinstance(row, Merchant) and row.logo_asset_id is not None:
            asset = await self.repository.asset(row.logo_asset_id, lock=True)
            if asset is None or asset.uploader_type != "admin" or not asset.mime_type.startswith("image/"):
                raise local_conflict("商家 LOGO 必须使用后台上传的图片资产")
        row.user_id = user.id if user else None
        await self.repository.save(row)
        if resource_id is None or previous_user != row.user_id:
            await self.repository.save(
                LocalBindingEvent(
                    role="merchant" if model is Merchant else "property",
                    resource_id=row.id,
                    previous_user_id=previous_user,
                    user_id=row.user_id,
                    actor_id=self.actor_id,
                    reason="后台维护业务身份",
                )
            )
        return row

    async def save_merchant(self, data: MerchantInput, merchant_id: UUID | None = None) -> MerchantRead:
        if self.audit is None:
            raise AppException(status_code=403, code=ErrorCode.PERMISSION_DENIED, message="需要后台权限")

        async def operation() -> MerchantRead:
            return await self.merchant_read(await self._save(Merchant, data, merchant_id))

        return await self.audit.execute(
            action=PermissionCode.MERCHANTS_UPDATE.value,
            target_type="merchant",
            target_id=merchant_id,
            changed_fields={"name": data.name, "is_active": data.is_active},
            operation=operation,
        )

    async def save_operator(self, data: OperatorInput, operator_id: UUID | None = None) -> OperatorRead:
        if self.audit is None:
            raise AppException(status_code=403, code=ErrorCode.PERMISSION_DENIED, message="需要后台权限")

        async def operation() -> OperatorRead:
            return OperatorRead.model_validate(await self._save(PropertyOperator, data, operator_id))

        return await self.audit.execute(
            action=PermissionCode.PROPERTY_OPERATORS_UPDATE.value,
            target_type="property_operator",
            target_id=operator_id,
            changed_fields={"name": data.name, "is_active": data.is_active},
            operation=operation,
        )

    async def status_batch(self, data: ActiveStatusBatch, *, merchant: bool) -> BatchCompleted:
        if self.audit is None:
            raise AppException(status_code=403, code=ErrorCode.PERMISSION_DENIED, message="需要后台权限")

        async def operation() -> BatchCompleted:
            await self.repository.lock_bindings()
            for target in sorted(data.targets, key=lambda item: item.id):
                row = await self.repository.actor(Merchant if merchant else PropertyOperator, target.id, lock=True)
                if row is None or row.revision != target.revision:
                    raise local_conflict("批量目标已变化，请刷新后重试")
                row.is_active = data.is_active
                row.revision += 1
                await self.repository.save(row)
            return BatchCompleted(completed_count=len(data.targets))

        return await self.audit.execute(
            action=(PermissionCode.MERCHANTS_UPDATE if merchant else PermissionCode.PROPERTY_OPERATORS_UPDATE).value,
            target_type="local_actor_batch",
            target_id=None,
            changed_fields={"targets": [str(item.id) for item in data.targets], "is_active": data.is_active},
            operation=operation,
        )

    async def lookup_target(self, phone: str, *, actor_id: UUID | None = None) -> PropertyTargetRead:
        if actor_id is not None:
            await self.require_role(PropertyOperator, actor_id)
        user = await self.repository.user_by_phone(phone)
        if (
            user is None
            or not user.is_active
            or user.deleted_at is not None
            or not user.phone_bound
            or user.phone_verified_at is None
            or user.phone_masked is None
        ):
            raise AppException(status_code=404, code=ErrorCode.NOT_FOUND, message="未找到有效且已绑定该手机号的用户")
        return PropertyTargetRead(
            id=user.id,
            display_name=user.display_name,
            phone_masked=user.phone_masked,
            phone_verified_at=user.phone_verified_at,
        )

    @staticmethod
    def grant_read(row: PropertyGrant) -> PropertyGrantRead:
        return PropertyGrantRead(
            id=row.id,
            request_id=row.request_id,
            user_id=row.user_id,
            points=str(row.points),
            note=row.note,
            ledger_id=row.ledger_id,
            created_at=row.created_at,
        )

    async def grant_points(self, actor_id: UUID, data: PropertyGrantCreate) -> PropertyGrantRead:
        request_hash = hashlib.sha256(data.model_dump_json(exclude={"request_id"}).encode()).hexdigest()
        async with transaction_scope(self.session):
            await self.repository.lock_bindings()
            for user_id in sorted({actor_id, data.user_id}):
                await self._valid_user(user_id, lock=True)
            operator = await self.require_role(PropertyOperator, actor_id, lock=True)
            existing = await self.repository.grant(operator.id, data.request_id)
            if existing is not None:
                if existing.actor_id != actor_id or existing.request_hash != request_hash:
                    raise local_conflict("请求号已用于其他发放内容")
                return self.grant_read(existing)
            target = await self.lookup_target(data.phone_e164)
            if target.id != data.user_id or target.phone_verified_at != data.phone_verified_at:
                raise AppException(
                    status_code=409,
                    code=ErrorCode.PHONE_BINDING_CONFLICT,
                    message="手机号绑定或目标已变化，请重新查询并确认",
                )
            grant_id = new_uuid7()
            ledger_id = await PointsService(session=self.session).grant_property_in_open_transaction(
                user_id=data.user_id, grant_id=grant_id, points=int(data.points), note=data.note
            )
            row = PropertyGrant(
                id=grant_id,
                operator_id=operator.id,
                actor_id=actor_id,
                user_id=data.user_id,
                request_id=data.request_id,
                request_hash=request_hash,
                points=int(data.points),
                note=data.note,
                ledger_id=ledger_id,
            )
            await self.repository.save(row)
            return self.grant_read(row)

    async def grant_by_request(self, actor_id: UUID, request_id: UUID) -> PropertyGrantRead:
        operator = await self.require_role(PropertyOperator, actor_id)
        row = await self.repository.grant(operator.id, request_id)
        if row is None or row.actor_id != actor_id:
            raise AppException(status_code=404, code=ErrorCode.NOT_FOUND, message="该请求尚无发放结果")
        return self.grant_read(row)

    async def grants(self, actor_id: UUID, page: int, page_size: int) -> PageResult[PropertyGrantRead]:
        operator = await self.require_role(PropertyOperator, actor_id)
        rows, total = await self.repository.grant_page(operator.id, page, page_size, actor_id)
        return PageResult[PropertyGrantRead].create(
            items=[self.grant_read(row) for row in rows], total=total, page=page, page_size=page_size
        )
