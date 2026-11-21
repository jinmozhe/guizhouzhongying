"""到店交易回归资产；只在明确授权及已迁移的隔离 PostgreSQL 中执行。"""

from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import func, select

from app.core.config import Settings
from app.core.exceptions import AppException
from app.core.identifiers import new_uuid7
from app.db.models import MerchantReceivable, PaymentAttempt, RedemptionVoucher, RefundAttempt, User
from app.db.models.distribution import MembershipQualificationEvent, PointsAccount
from app.db.transaction import transaction_scope
from app.domains.lifecycle.schemas import (
    PaymentAttemptCreate,
    RefundRequestCreate,
    VerifiedPaymentConfirmation,
    VerifiedRefundConfirmation,
)
from app.domains.orders import CheckoutLine, CheckoutRequest
from app.domains.products import CategoryInput, ProductCreate, ProductStatusUpdate
from app.domains.products.catalog_schemas import NewSkuInput
from app.services.admin_audit import AdminAuditCoordinator
from app.services.customer_accounts import CustomerAccountsService
from app.services.local_actors import LocalActorsService
from app.services.local_commerce_schemas import (
    MerchantInput,
    OperatorInput,
    PropertyGrantCreate,
    RedemptionConfirmInput,
)
from app.services.redemptions import RedemptionService
from tests.test_admin_commerce_workflows import shop as shop


@pytest.mark.integration
@pytest.mark.parametrize("finish", ["redeem", "refund", "expire"])
@pytest.mark.parametrize("points_used", [0, 80, 100])
async def test_points_grant_checkout_and_whole_order_completion(shop, monkeypatch, finish, points_used):
    # Only configuration is substituted; SQL, transactions and business services are real.
    from app.core import redemption_code

    settings = Settings.model_construct(local_redemption_key=Fernet.generate_key().decode())
    monkeypatch.setattr(redemption_code, "get_settings", lambda: settings)
    now = datetime.now(UTC)
    async with transaction_scope(shop.session):
        for index, user_id in enumerate(shop.users):
            user = await shop.session.get(User, user_id)
            user.phone_e164 = f"+8613{int(user_id) % 100000000:08d}{index}"
            user.phone_verified_at, user.phone_verification_source = now, "wechat_phone_quick"
            await CustomerAccountsService(shop.session).initialize_in_open_transaction(user_id)
        await shop.session.flush()
    users = [await shop.session.get(User, value) for value in shop.users]
    audit = AdminAuditCoordinator(
        audit=shop.commerce.audit,
        session=shop.session,
        actor_id=shop.actor,
        session_id=shop.commerce.actor_session_id,
    )
    actors = LocalActorsService(shop.session, audit=audit, actor_id=shop.actor)
    merchant = await actors.save_merchant(MerchantInput(name="到店商家", phone_e164=users[1].phone_e164))
    await actors.save_operator(OperatorInput(name="合作物业", phone_e164=users[2].phone_e164))
    assert (await actors.roles(users[1].id)).merchant_id == merchant.id
    grant = PropertyGrantCreate(
        request_id=new_uuid7(),
        user_id=users[0].id,
        phone_e164=users[0].phone_e164,
        phone_verified_at=users[0].phone_verified_at,
        points="160",
    )
    first = await actors.grant_points(users[2].id, grant)
    assert (await actors.grant_points(users[2].id, grant)).id == first.id
    assert (
        await shop.session.scalar(
            select(func.count())
            .select_from(MembershipQualificationEvent)
            .where(
                MembershipQualificationEvent.user_id == users[0].id,
                MembershipQualificationEvent.metric == "points",
            )
        )
        == 0
    )
    category = await shop.commerce.create_category(CategoryInput(name="到店测试"))
    product = await shop.commerce.create_product(
        ProductCreate(
            name="整单到店服务",
            product_type="virtual",
            merchant_id=merchant.id,
            fulfillment_mode="local",
            category_id=category.id,
            category_revision=category.revision,
            image_asset_ids=[shop.image],
            skus=[
                NewSkuInput(
                    code=f"LOCAL-{new_uuid7().hex}", price="100.00", max_points_deduction=100, initial_quantity=5
                )
            ],
        )
    )
    product = await shop.commerce.set_product_status(
        product.id, ProductStatusUpdate(revision=product.revision, status="on_sale")
    )
    request = CheckoutRequest(
        request_id=new_uuid7(), items=[CheckoutLine(sku_id=product.skus[0].id, quantity=1)], points_to_use=100
    )
    quote = await shop.orders.preview(users[0].id, request)
    assert (quote.order_gross_amount, quote.total_amount, quote.maximum_points) == (Decimal("100"), Decimal("0"), 100)
    mixed = await shop.orders.preview(users[0].id, request.model_copy(update={"points_to_use": 80}))
    assert (mixed.order_gross_amount, mixed.total_amount, mixed.points_deduction) == (Decimal("100"), Decimal("20"), 80)
    with pytest.raises(AppException):
        await shop.orders.preview(users[0].id, request.model_copy(update={"points_to_use": 101}))
    request = request.model_copy(update={"points_to_use": points_used})
    quote = await shop.orders.preview(users[0].id, request)
    request = request.model_copy(update={"quote_fingerprint": quote.fingerprint})
    order = await shop.orders.create(users[0].id, request)
    assert (await shop.orders.create(users[0].id, request)).id == order.id
    if points_used < 100:
        assert order.status == "pending_payment"
        attempt = await shop.lifecycle.initiate_payment(
            users[0].id, order.id, PaymentAttemptCreate(request_id=new_uuid7(), channel="wechat")
        )
        # Channel facts are constructed only inside this isolated test, no external payment is made.
        async with transaction_scope(shop.session):
            payment_row = await shop.session.get(PaymentAttempt, attempt.id)
            payment_row.status = "pending"
        await shop.lifecycle.confirm_verified_payment(
            VerifiedPaymentConfirmation(
                payment_attempt_id=attempt.id,
                channel="wechat",
                channel_transaction_id=f"LOCAL-TEST-{attempt.id}",
                amount=order.total_amount,
                currency="CNY",
                confirmed_at=datetime.now(UTC),
                payload_hash="b" * 64,
            )
        )
        await shop.lifecycle.confirm_order_scheduled(attempt.id)
    else:
        assert order.status == "paid" and order.settlement_kind == "zero_amount"
    consumption = await shop.session.scalar(
        select(MembershipQualificationEvent.amount_delta).where(
            MembershipQualificationEvent.user_id == users[0].id,
            MembershipQualificationEvent.source_type == "order_confirm",
            MembershipQualificationEvent.source_id == order.id,
        )
    )
    assert consumption == Decimal("100")
    service = RedemptionService(shop.session)
    voucher = await service.buyer_voucher(users[0].id, order.id)
    assert voucher.code and voucher.qr_data_url
    assert timedelta(days=7, seconds=-5) < voucher.expires_at - datetime.now(UTC) <= timedelta(days=7)
    if finish == "redeem":
        payload = RedemptionConfirmInput(request_id=new_uuid7(), order_id=order.id, code=voucher.code)
        with pytest.raises(AppException):
            await service.confirm(users[2].id, payload)
        await service.confirm(users[1].id, payload)
        await service.confirm(users[1].id, payload)
        receivables = list(
            await shop.session.scalars(select(MerchantReceivable).where(MerchantReceivable.order_id == order.id))
        )
        assert len(receivables) == 1
        assert (receivables[0].gross_amount, receivables[0].cash_amount, receivables[0].points_amount) == (
            100,
            100 - points_used,
            points_used,
        )
        with pytest.raises(AppException):
            await shop.lifecycle.create_refund(
                users[0].id, order.id, RefundRequestCreate(request_id=new_uuid7(), reason="已核销不能退款")
            )
    else:
        if finish == "expire":
            async with transaction_scope(shop.session):
                row = (
                    await shop.session.scalars(select(RedemptionVoucher).where(RedemptionVoucher.order_id == order.id))
                ).one()
                row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
            await service.expire(order.id)
            await service.expire(order.id)
        else:
            request_refund = RefundRequestCreate(request_id=new_uuid7(), reason="未消费整单退款")
            result = await shop.lifecycle.create_refund(users[0].id, order.id, request_refund)
            assert result.status == ("completed" if points_used == 100 else "approved")
            assert result.points_returned == points_used and result.amount == 100 - points_used
            await shop.lifecycle.create_refund(users[0].id, order.id, request_refund)
        if points_used < 100:
            refund_attempt = (
                await shop.session.scalars(select(RefundAttempt).where(RefundAttempt.order_id == order.id))
            ).one()
            payment = await shop.session.get(PaymentAttempt, refund_attempt.payment_attempt_id)
            await shop.lifecycle.confirm_verified_refund(
                VerifiedRefundConfirmation(
                    refund_attempt_id=refund_attempt.id,
                    channel="wechat",
                    payment_transaction_id=payment.channel_transaction_id,
                    amount=refund_attempt.amount,
                    currency="CNY",
                    channel_refund_id=f"LOCAL-REFUND-{refund_attempt.id}",
                    confirmed_at=datetime.now(UTC),
                    payload_hash="c" * 64,
                )
            )
            await shop.lifecycle.complete_refund_scheduled(refund_attempt.id)
            await shop.lifecycle.complete_refund_scheduled(refund_attempt.id)
        assert (await service.buyer_voucher(users[0].id, order.id)).status == "refunded"
        assert (
            await shop.session.scalar(
                select(func.count()).select_from(MerchantReceivable).where(MerchantReceivable.order_id == order.id)
            )
            == 0
        )
    account = (
        await shop.session.scalars(
            select(PointsAccount).where(PointsAccount.user_id == users[0].id).execution_options(populate_existing=True)
        )
    ).one()
    assert account.available_points == (160 - points_used if finish == "redeem" else 160)
    assert account.frozen_points == 0
