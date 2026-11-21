from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from app.api.commerce_router import Page, PageSize
from app.api.dependencies import require_admin_csrf, require_permission
from app.api.local_commerce_dependencies import (
    AdminLocalActors,
    AdminMerchantFinance,
    BasicUser,
    LocalActors,
    LocalUser,
    MerchantFinance,
    Redemptions,
    UserLocalActors,
)
from app.core.batch import ActiveStatusBatch, BatchCompleted
from app.core.context import current_request_id
from app.core.pagination import PageResult
from app.core.response import ResponseModel, success_response
from app.domains.admin.permissions import PermissionCode
from app.services.local_commerce_schemas import (
    LocalRolesRead,
    MerchantInput,
    MerchantRead,
    MerchantUpdate,
    OperatorInput,
    OperatorRead,
    OperatorUpdate,
    PhoneLookup,
    PropertyGrantCreate,
    PropertyGrantRead,
    PropertyTargetRead,
    PublicMerchantRead,
    ReceivableRead,
    RedemptionConfirmInput,
    RedemptionPreviewInput,
    RedemptionPreviewRead,
    SettlementCreate,
    SettlementEventRead,
    SettlementPayment,
    SettlementRead,
    SettlementReversal,
    VoucherRead,
)

router = APIRouter(tags=["到店商家与物业"])
Search = Annotated[str | None, Query(max_length=100)]


@router.get(
    "/merchants",
    response_model=ResponseModel[list[PublicMerchantRead]],
    summary="当前分类及名称搜索范围内的去重商家列表",
)
async def category_merchants(
    service: LocalActors, category_id: UUID | None = None, search: Annotated[str | None, Query(max_length=200)] = None
) -> ResponseModel[list[PublicMerchantRead]]:
    return success_response(data=await service.category_merchants(category_id, search), request_id=current_request_id())


@router.get(
    "/users/me/business-roles", response_model=ResponseModel[LocalRolesRead], summary="读取本人实时附加业务身份"
)
async def roles(service: LocalActors, current: BasicUser) -> ResponseModel[LocalRolesRead]:
    return success_response(data=await service.roles(current.user.id), request_id=current_request_id())


@router.get("/merchants/{merchant_id}", response_model=ResponseModel[PublicMerchantRead], summary="查看商家公开资料")
async def public_merchant(merchant_id: UUID, service: LocalActors) -> ResponseModel[PublicMerchantRead]:
    return success_response(data=await service.public_merchant(merchant_id), request_id=current_request_id())


@router.get(
    "/admin/merchants",
    response_model=ResponseModel[PageResult[MerchantRead]],
    summary="分页查看商家",
    dependencies=[Depends(require_permission(PermissionCode.MERCHANTS_READ))],
)
async def merchants(
    service: AdminLocalActors, page: Page = 1, page_size: PageSize = 20, search: Search = None
) -> ResponseModel[PageResult[MerchantRead]]:
    return success_response(data=await service.merchants(page, page_size, search), request_id=current_request_id())


@router.post(
    "/admin/merchants",
    response_model=ResponseModel[MerchantRead],
    status_code=201,
    summary="创建商家并关联可信手机号用户",
    dependencies=[Depends(require_admin_csrf), Depends(require_permission(PermissionCode.MERCHANTS_UPDATE))],
)
async def create_merchant(payload: MerchantInput, service: AdminLocalActors) -> ResponseModel[MerchantRead]:
    return success_response(data=await service.save_merchant(payload), request_id=current_request_id())


@router.put(
    "/admin/merchants/{merchant_id}",
    response_model=ResponseModel[MerchantRead],
    summary="修改商家资料与核销授权",
    dependencies=[Depends(require_admin_csrf), Depends(require_permission(PermissionCode.MERCHANTS_UPDATE))],
)
async def update_merchant(
    merchant_id: UUID, payload: MerchantUpdate, service: AdminLocalActors
) -> ResponseModel[MerchantRead]:
    return success_response(data=await service.save_merchant(payload, merchant_id), request_id=current_request_id())


@router.patch(
    "/admin/merchants/status/batch",
    response_model=ResponseModel[BatchCompleted],
    summary="原子批量启停商家",
    dependencies=[Depends(require_admin_csrf), Depends(require_permission(PermissionCode.MERCHANTS_UPDATE))],
)
async def merchant_status(payload: ActiveStatusBatch, service: AdminLocalActors) -> ResponseModel[BatchCompleted]:
    return success_response(data=await service.status_batch(payload, merchant=True), request_id=current_request_id())


@router.get(
    "/admin/property-operators",
    response_model=ResponseModel[PageResult[OperatorRead]],
    summary="分页查看物业授权",
    dependencies=[Depends(require_permission(PermissionCode.PROPERTY_OPERATORS_READ))],
)
async def operators(
    service: AdminLocalActors, page: Page = 1, page_size: PageSize = 20, search: Search = None
) -> ResponseModel[PageResult[OperatorRead]]:
    return success_response(data=await service.operators(page, page_size, search), request_id=current_request_id())


@router.post(
    "/admin/property-operators",
    response_model=ResponseModel[OperatorRead],
    status_code=201,
    summary="创建物业手机号授权",
    dependencies=[Depends(require_admin_csrf), Depends(require_permission(PermissionCode.PROPERTY_OPERATORS_UPDATE))],
)
async def create_operator(payload: OperatorInput, service: AdminLocalActors) -> ResponseModel[OperatorRead]:
    return success_response(data=await service.save_operator(payload), request_id=current_request_id())


@router.put(
    "/admin/property-operators/{operator_id}",
    response_model=ResponseModel[OperatorRead],
    summary="编辑物业授权",
    dependencies=[Depends(require_admin_csrf), Depends(require_permission(PermissionCode.PROPERTY_OPERATORS_UPDATE))],
)
async def update_operator(
    operator_id: UUID, payload: OperatorUpdate, service: AdminLocalActors
) -> ResponseModel[OperatorRead]:
    return success_response(data=await service.save_operator(payload, operator_id), request_id=current_request_id())


@router.patch(
    "/admin/property-operators/status/batch",
    response_model=ResponseModel[BatchCompleted],
    summary="原子批量启停物业授权",
    dependencies=[Depends(require_admin_csrf), Depends(require_permission(PermissionCode.PROPERTY_OPERATORS_UPDATE))],
)
async def operator_status(payload: ActiveStatusBatch, service: AdminLocalActors) -> ResponseModel[BatchCompleted]:
    return success_response(data=await service.status_batch(payload, merchant=False), request_id=current_request_id())


@router.post(
    "/admin/property-operators/lookup-user",
    response_model=ResponseModel[PropertyTargetRead],
    summary="按完整手机号查询可绑定用户",
    dependencies=[Depends(require_admin_csrf), Depends(require_permission(PermissionCode.PROPERTY_OPERATORS_READ))],
)
async def admin_lookup(payload: PhoneLookup, service: AdminLocalActors) -> ResponseModel[PropertyTargetRead]:
    return success_response(data=await service.lookup_target(payload.phone_e164), request_id=current_request_id())


@router.post(
    "/property/points/lookup-user", response_model=ResponseModel[PropertyTargetRead], summary="物业按手机号查询发分目标"
)
async def lookup(payload: PhoneLookup, service: LocalActors, current: LocalUser) -> ResponseModel[PropertyTargetRead]:
    return success_response(
        data=await service.lookup_target(payload.phone_e164, actor_id=current.user.id), request_id=current_request_id()
    )


@router.post(
    "/property/points/grants",
    response_model=ResponseModel[PropertyGrantRead],
    status_code=201,
    summary="物业幂等发放积分，不累计升级资格",
)
async def grant(
    payload: PropertyGrantCreate, service: UserLocalActors, current: LocalUser
) -> ResponseModel[PropertyGrantRead]:
    return success_response(data=await service.grant_points(current.user.id, payload), request_id=current_request_id())


@router.get(
    "/property/points/grants/by-request/{request_id}",
    response_model=ResponseModel[PropertyGrantRead],
    summary="找回原积分发放请求结果",
)
async def grant_request(request_id: UUID, service: LocalActors, current: LocalUser) -> ResponseModel[PropertyGrantRead]:
    return success_response(
        data=await service.grant_by_request(current.user.id, request_id), request_id=current_request_id()
    )


@router.get(
    "/property/points/grants",
    response_model=ResponseModel[PageResult[PropertyGrantRead]],
    summary="查询本人物业发放记录",
)
async def grants(
    service: LocalActors, current: LocalUser, page: Page = 1, page_size: PageSize = 20
) -> ResponseModel[PageResult[PropertyGrantRead]]:
    return success_response(
        data=await service.grants(current.user.id, page, page_size), request_id=current_request_id()
    )


@router.get(
    "/orders/{order_id}/redemption", response_model=ResponseModel[VoucherRead], summary="买家读取本人整单核销凭证"
)
async def buyer_voucher(order_id: UUID, service: Redemptions, current: LocalUser) -> ResponseModel[VoucherRead]:
    return success_response(
        data=await service.buyer_voucher(current.user.id, order_id), request_id=current_request_id()
    )


@router.post(
    "/merchant/redemptions/preview",
    response_model=ResponseModel[RedemptionPreviewRead],
    summary="商家预览核销码，不执行核销",
)
async def redemption_preview(
    payload: RedemptionPreviewInput, service: Redemptions, current: LocalUser
) -> ResponseModel[RedemptionPreviewRead]:
    return success_response(data=await service.preview(current.user.id, payload.code), request_id=current_request_id())


@router.post("/merchant/redemptions/confirm", response_model=ResponseModel[VoucherRead], summary="所属商家确认整单核销")
async def redemption_confirm(
    payload: RedemptionConfirmInput, service: Redemptions, current: LocalUser
) -> ResponseModel[VoucherRead]:
    return success_response(data=await service.confirm(current.user.id, payload), request_id=current_request_id())


@router.get(
    "/merchant/redemptions", response_model=ResponseModel[PageResult[VoucherRead]], summary="查看本商家整单核销记录"
)
async def redemption_records(
    service: Redemptions, current: LocalUser, page: Page = 1, page_size: PageSize = 20
) -> ResponseModel[PageResult[VoucherRead]]:
    return success_response(
        data=await service.records(current.user.id, page, page_size), request_id=current_request_id()
    )


@router.get(
    "/merchant/receivables", response_model=ResponseModel[PageResult[ReceivableRead]], summary="商家查看本人全额应收"
)
async def own_receivables(
    service: MerchantFinance, current: LocalUser, page: Page = 1, page_size: PageSize = 20
) -> ResponseModel[PageResult[ReceivableRead]]:
    return success_response(
        data=await service.receivables(page, page_size, None, current.user.id), request_id=current_request_id()
    )


@router.get(
    "/merchant/settlements", response_model=ResponseModel[PageResult[SettlementRead]], summary="商家查看本人结算"
)
async def own_settlements(
    service: MerchantFinance, current: LocalUser, page: Page = 1, page_size: PageSize = 20
) -> ResponseModel[PageResult[SettlementRead]]:
    return success_response(
        data=await service.settlements(page, page_size, None, current.user.id), request_id=current_request_id()
    )


@router.get(
    "/admin/merchant-receivables",
    response_model=ResponseModel[PageResult[ReceivableRead]],
    summary="后台商家全额应收台账",
    dependencies=[Depends(require_permission(PermissionCode.MERCHANT_SETTLEMENTS_READ))],
)
async def receivables(
    service: AdminMerchantFinance, page: Page = 1, page_size: PageSize = 20, merchant_id: UUID | None = None
) -> ResponseModel[PageResult[ReceivableRead]]:
    return success_response(
        data=await service.receivables(page, page_size, merchant_id), request_id=current_request_id()
    )


@router.get(
    "/admin/merchant-settlements",
    response_model=ResponseModel[PageResult[SettlementRead]],
    summary="后台商家结算批次",
    dependencies=[Depends(require_permission(PermissionCode.MERCHANT_SETTLEMENTS_READ))],
)
async def settlements(
    service: AdminMerchantFinance, page: Page = 1, page_size: PageSize = 20, merchant_id: UUID | None = None
) -> ResponseModel[PageResult[SettlementRead]]:
    return success_response(
        data=await service.settlements(page, page_size, merchant_id), request_id=current_request_id()
    )


@router.post(
    "/admin/merchant-settlements",
    response_model=ResponseModel[SettlementRead],
    status_code=201,
    summary="以完整未结算应收创建对账批次",
    dependencies=[Depends(require_admin_csrf), Depends(require_permission(PermissionCode.MERCHANT_SETTLEMENTS_UPDATE))],
)
async def create_settlement(payload: SettlementCreate, service: AdminMerchantFinance) -> ResponseModel[SettlementRead]:
    return success_response(data=await service.create(payload), request_id=current_request_id())


@router.post(
    "/admin/merchant-settlements/{settlement_id}/payment",
    response_model=ResponseModel[SettlementRead],
    summary="登记线下全额打款事实",
    dependencies=[Depends(require_admin_csrf), Depends(require_permission(PermissionCode.MERCHANT_SETTLEMENTS_UPDATE))],
)
async def pay_settlement(
    settlement_id: UUID, payload: SettlementPayment, service: AdminMerchantFinance
) -> ResponseModel[SettlementRead]:
    return success_response(data=await service.pay(settlement_id, payload), request_id=current_request_id())


@router.get(
    "/admin/merchant-settlements/{settlement_id}/history",
    response_model=ResponseModel[list[SettlementEventRead]],
    summary="查看不可变付款及冲正历史",
    dependencies=[Depends(require_permission(PermissionCode.MERCHANT_SETTLEMENTS_READ))],
)
async def settlement_history(
    settlement_id: UUID, service: AdminMerchantFinance
) -> ResponseModel[list[SettlementEventRead]]:
    return success_response(data=await service.history(settlement_id), request_id=current_request_id())


@router.post(
    "/admin/merchant-settlements/{settlement_id}/reversal",
    response_model=ResponseModel[SettlementRead],
    summary="冲正错误付款登记，保留历史且不操作实际资金",
    dependencies=[Depends(require_admin_csrf), Depends(require_permission(PermissionCode.MERCHANT_SETTLEMENTS_UPDATE))],
)
async def reverse_settlement(
    settlement_id: UUID, payload: SettlementReversal, service: AdminMerchantFinance
) -> ResponseModel[SettlementRead]:
    return success_response(data=await service.reverse(settlement_id, payload), request_id=current_request_id())
