"""到店商家、物业积分、核销及结算。静态结构快照；禁止在迁移中导入当前模型。"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "20261121_01"
down_revision = "20261120_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "\nCREATE TABLE merchants (\n\tid UUID NOT NULL, \n\tname VARCHAR(100) NOT NULL, \n\tphone_e164 VARCHAR(16) NOT NULL, \n\tuser_id UUID, \n\tlogo_asset_id UUID, \n\tdescription TEXT NOT NULL, \n\taddress VARCHAR(300) NOT NULL, \n\tbusiness_hours VARCHAR(200) NOT NULL, \n\tpublic_phone VARCHAR(40) NOT NULL, \n\tis_active BOOLEAN NOT NULL, \n\tsort_order INTEGER, \n\trevision INTEGER NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tupdated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tCONSTRAINT ck_merchants_revision CHECK (revision > 0), \n\tCONSTRAINT ck_merchants_sort CHECK (sort_order >= 0), \n\tUNIQUE (phone_e164), \n\tUNIQUE (user_id), \n\tFOREIGN KEY(user_id) REFERENCES users (id) ON DELETE RESTRICT, \n\tFOREIGN KEY(logo_asset_id) REFERENCES assets (id) ON DELETE RESTRICT\n)\n\n"
    )
    op.execute("CREATE INDEX ix_merchants_logo_asset_id ON merchants (logo_asset_id)")
    op.execute("COMMENT ON TABLE merchants IS '线下消费商家，一商家一授权手机号一核销员'")
    op.execute("COMMENT ON COLUMN merchants.name IS '商家名称'")
    op.execute("COMMENT ON COLUMN merchants.phone_e164 IS '非公开授权手机号'")
    op.execute("COMMENT ON COLUMN merchants.user_id IS '可信手机号匹配的核销用户'")
    op.execute("COMMENT ON COLUMN merchants.logo_asset_id IS '商家 LOGO 资产'")
    op.execute("COMMENT ON COLUMN merchants.description IS '受限 HTML 商家介绍'")
    op.execute("COMMENT ON COLUMN merchants.address IS '线下消费地址'")
    op.execute("COMMENT ON COLUMN merchants.business_hours IS '营业时间'")
    op.execute("COMMENT ON COLUMN merchants.public_phone IS '明确公开的联系电话'")
    op.execute("COMMENT ON COLUMN merchants.is_active IS '是否启用'")
    op.execute("COMMENT ON COLUMN merchants.sort_order IS '排序权重，值越小越靠前，NULL 表示未人工设置自动排最后'")
    op.execute("COMMENT ON COLUMN merchants.revision IS '资料版本'")
    op.execute(
        "\nCREATE TABLE property_operators (\n\tid UUID NOT NULL, \n\tname VARCHAR(100) NOT NULL, \n\tphone_e164 VARCHAR(16) NOT NULL, \n\tuser_id UUID, \n\tis_active BOOLEAN NOT NULL, \n\trevision INTEGER NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tupdated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tCONSTRAINT ck_property_operators_revision CHECK (revision > 0), \n\tUNIQUE (phone_e164), \n\tUNIQUE (user_id), \n\tFOREIGN KEY(user_id) REFERENCES users (id) ON DELETE RESTRICT\n)\n\n"
    )
    op.execute("COMMENT ON TABLE property_operators IS '物业发积分授权，不设业务额度'")
    op.execute("COMMENT ON COLUMN property_operators.name IS '物业操作名称'")
    op.execute("COMMENT ON COLUMN property_operators.phone_e164 IS '授权手机号'")
    op.execute("COMMENT ON COLUMN property_operators.user_id IS '可信绑定用户'")
    op.execute("COMMENT ON COLUMN property_operators.is_active IS '授权是否启用'")
    op.execute("COMMENT ON COLUMN property_operators.revision IS '授权版本'")
    op.execute(
        "\nCREATE TABLE local_binding_events (\n\tid UUID NOT NULL, \n\trole VARCHAR(16) NOT NULL, \n\tresource_id UUID NOT NULL, \n\tprevious_user_id UUID, \n\tuser_id UUID, \n\tactor_id UUID, \n\treason VARCHAR(200) NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tupdated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tCONSTRAINT ck_local_binding_role CHECK (role IN ('merchant', 'property')), \n\tFOREIGN KEY(previous_user_id) REFERENCES users (id) ON DELETE RESTRICT, \n\tFOREIGN KEY(user_id) REFERENCES users (id) ON DELETE RESTRICT\n)\n\n"
    )
    op.execute("COMMENT ON TABLE local_binding_events IS '商家和物业授权关联变更历史'")
    op.execute("COMMENT ON COLUMN local_binding_events.role IS '业务角色'")
    op.execute("COMMENT ON COLUMN local_binding_events.resource_id IS '商家或物业授权标识'")
    op.execute("COMMENT ON COLUMN local_binding_events.previous_user_id IS '原用户'")
    op.execute("COMMENT ON COLUMN local_binding_events.user_id IS '新用户'")
    op.execute("COMMENT ON COLUMN local_binding_events.actor_id IS '后台操作者，自动匹配为空'")
    op.execute("COMMENT ON COLUMN local_binding_events.reason IS '变更原因'")
    op.execute(
        "\nCREATE TABLE property_grants (\n\tid UUID NOT NULL, \n\toperator_id UUID NOT NULL, \n\tactor_id UUID NOT NULL, \n\tuser_id UUID NOT NULL, \n\trequest_id UUID NOT NULL, \n\trequest_hash VARCHAR(64) NOT NULL, \n\tpoints BIGINT NOT NULL, \n\tnote VARCHAR(200) NOT NULL, \n\tledger_id UUID NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tupdated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tCONSTRAINT uq_property_grant_request UNIQUE (operator_id, request_id), \n\tCONSTRAINT ck_property_grant_points CHECK (points > 0), \n\tFOREIGN KEY(operator_id) REFERENCES property_operators (id) ON DELETE RESTRICT, \n\tFOREIGN KEY(actor_id) REFERENCES users (id) ON DELETE RESTRICT, \n\tFOREIGN KEY(user_id) REFERENCES users (id) ON DELETE RESTRICT, \n\tUNIQUE (ledger_id), \n\tFOREIGN KEY(ledger_id) REFERENCES points_ledgers (id) ON DELETE RESTRICT\n)\n\n"
    )
    op.execute("CREATE INDEX ix_property_grant_operator_id ON property_grants (operator_id, id)")
    op.execute("COMMENT ON TABLE property_grants IS '物业积分发放事实，不贡献会员升级资格'")
    op.execute("COMMENT ON COLUMN property_grants.operator_id IS '物业授权'")
    op.execute("COMMENT ON COLUMN property_grants.actor_id IS '实际发放用户'")
    op.execute("COMMENT ON COLUMN property_grants.user_id IS '目标会员'")
    op.execute("COMMENT ON COLUMN property_grants.request_id IS '操作幂等请求'")
    op.execute("COMMENT ON COLUMN property_grants.request_hash IS '发放目标与数量摘要'")
    op.execute("COMMENT ON COLUMN property_grants.points IS '授予积分'")
    op.execute("COMMENT ON COLUMN property_grants.note IS '发放说明'")
    op.execute("COMMENT ON COLUMN property_grants.ledger_id IS '积分入账流水'")
    op.execute(
        "\nCREATE TABLE order_points_reservations (\n\tid UUID NOT NULL, \n\torder_id UUID NOT NULL, \n\tuser_id UUID NOT NULL, \n\tpoints BIGINT NOT NULL, \n\tstatus VARCHAR(16) NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tupdated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tCONSTRAINT ck_order_points_positive CHECK (points > 0), \n\tCONSTRAINT ck_order_points_status CHECK (status IN ('frozen', 'spent', 'released', 'refunded')), \n\tUNIQUE (order_id), \n\tFOREIGN KEY(order_id) REFERENCES orders (id) ON DELETE RESTRICT, \n\tFOREIGN KEY(user_id) REFERENCES users (id) ON DELETE RESTRICT\n)\n\n"
    )
    op.execute("COMMENT ON TABLE order_points_reservations IS '订单独占积分预占与消费状态'")
    op.execute("COMMENT ON COLUMN order_points_reservations.order_id IS '订单'")
    op.execute("COMMENT ON COLUMN order_points_reservations.user_id IS '会员'")
    op.execute("COMMENT ON COLUMN order_points_reservations.points IS '订单冻结积分'")
    op.execute("COMMENT ON COLUMN order_points_reservations.status IS '冻结、消费、释放或已退款'")
    op.execute(
        "\nCREATE TABLE redemption_vouchers (\n\tid UUID NOT NULL, \n\torder_id UUID NOT NULL, \n\tmerchant_id UUID NOT NULL, \n\tcode_digest VARCHAR(64) NOT NULL, \n\tcode_ciphertext TEXT NOT NULL, \n\tstatus VARCHAR(16) NOT NULL, \n\texpires_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tredeemed_at TIMESTAMP WITH TIME ZONE, \n\tredeemed_by_id UUID, \n\trequest_id UUID, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tupdated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tCONSTRAINT ck_redemption_status CHECK (status IN ('available', 'redeemed', 'refunding', 'refunded')), \n\tCONSTRAINT ck_redemption_fact CHECK ((status = 'redeemed') = (redeemed_at IS NOT NULL AND redeemed_by_id IS NOT NULL)), \n\tUNIQUE (order_id), \n\tFOREIGN KEY(order_id) REFERENCES orders (id) ON DELETE RESTRICT, \n\tFOREIGN KEY(merchant_id) REFERENCES merchants (id) ON DELETE RESTRICT, \n\tUNIQUE (code_digest), \n\tFOREIGN KEY(redeemed_by_id) REFERENCES users (id) ON DELETE RESTRICT, \n\tUNIQUE (request_id)\n)\n\n"
    )
    op.execute("CREATE INDEX ix_redemption_expiry ON redemption_vouchers (expires_at, id) WHERE status = 'available'")
    op.execute("CREATE INDEX ix_redemption_merchant_id ON redemption_vouchers (merchant_id, id)")
    op.execute("COMMENT ON TABLE redemption_vouchers IS '同商家整单一次性核销凭证'")
    op.execute("COMMENT ON COLUMN redemption_vouchers.order_id IS '已成交订单'")
    op.execute("COMMENT ON COLUMN redemption_vouchers.merchant_id IS '成交商家'")
    op.execute("COMMENT ON COLUMN redemption_vouchers.code_digest IS '高熵核销码摘要'")
    op.execute("COMMENT ON COLUMN redemption_vouchers.code_ciphertext IS '经配置密钥保护的可恢复核销码'")
    op.execute("COMMENT ON COLUMN redemption_vouchers.status IS '凭证状态'")
    op.execute("COMMENT ON COLUMN redemption_vouchers.expires_at IS '服务端成交确认起七天截止'")
    op.execute("COMMENT ON COLUMN redemption_vouchers.redeemed_at IS '核销时间'")
    op.execute("COMMENT ON COLUMN redemption_vouchers.redeemed_by_id IS '实际核销用户'")
    op.execute("COMMENT ON COLUMN redemption_vouchers.request_id IS '核销提交幂等请求'")
    op.execute(
        "\nCREATE TABLE merchant_settlements (\n\tid UUID NOT NULL, \n\tmerchant_id UUID NOT NULL, \n\trequest_id UUID NOT NULL, \n\tamount NUMERIC(15, 2) NOT NULL, \n\tstatus VARCHAR(16) NOT NULL, \n\tpayment_reference VARCHAR(100), \n\tpaid_at TIMESTAMP WITH TIME ZONE, \n\tpaid_by_id UUID, \n\trevision INTEGER NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tupdated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tCONSTRAINT ck_merchant_settlement_status CHECK (status IN ('open', 'paid')), \n\tCONSTRAINT ck_merchant_settlement_amount CHECK (amount >= 0), \n\tCONSTRAINT ck_merchant_settlement_paid CHECK ((status = 'paid') = (paid_at IS NOT NULL AND payment_reference IS NOT NULL)), \n\tFOREIGN KEY(merchant_id) REFERENCES merchants (id) ON DELETE RESTRICT, \n\tUNIQUE (request_id), \n\tUNIQUE (payment_reference), \n\tFOREIGN KEY(paid_by_id) REFERENCES admins (id) ON DELETE RESTRICT\n)\n\n"
    )
    op.execute("CREATE INDEX ix_merchant_settlements_merchant_id ON merchant_settlements (merchant_id)")
    op.execute("COMMENT ON TABLE merchant_settlements IS '商家整批对账与线下打款登记'")
    op.execute("COMMENT ON COLUMN merchant_settlements.merchant_id IS '商家'")
    op.execute("COMMENT ON COLUMN merchant_settlements.request_id IS '组批幂等请求'")
    op.execute("COMMENT ON COLUMN merchant_settlements.amount IS '完整应收合计'")
    op.execute("COMMENT ON COLUMN merchant_settlements.status IS '待打款或已打款'")
    op.execute("COMMENT ON COLUMN merchant_settlements.payment_reference IS '线下付款凭据号'")
    op.execute("COMMENT ON COLUMN merchant_settlements.paid_at IS '线下实际打款时间'")
    op.execute("COMMENT ON COLUMN merchant_settlements.paid_by_id IS '登记管理员'")
    op.execute("COMMENT ON COLUMN merchant_settlements.revision IS '结算状态版本'")
    op.execute(
        "\nCREATE TABLE merchant_receivables (\n\tid UUID NOT NULL, \n\tmerchant_id UUID NOT NULL, \n\torder_id UUID NOT NULL, \n\tvoucher_id UUID NOT NULL, \n\tgross_amount NUMERIC(15, 2) NOT NULL, \n\tcash_amount NUMERIC(15, 2) NOT NULL, \n\tpoints_amount NUMERIC(15, 2) NOT NULL, \n\tsettlement_id UUID, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tupdated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tCONSTRAINT ck_merchant_receivable_amounts CHECK (gross_amount >= 0 AND cash_amount >= 0 AND points_amount >= 0 AND gross_amount = cash_amount + points_amount), \n\tFOREIGN KEY(merchant_id) REFERENCES merchants (id) ON DELETE RESTRICT, \n\tUNIQUE (order_id), \n\tFOREIGN KEY(order_id) REFERENCES orders (id) ON DELETE RESTRICT, \n\tUNIQUE (voucher_id), \n\tFOREIGN KEY(voucher_id) REFERENCES redemption_vouchers (id) ON DELETE RESTRICT, \n\tFOREIGN KEY(settlement_id) REFERENCES merchant_settlements (id) ON DELETE RESTRICT\n)\n\n"
    )
    op.execute("CREATE INDEX ix_merchant_receivable_merchant_id ON merchant_receivables (merchant_id, id)")
    op.execute("CREATE INDEX ix_merchant_receivables_settlement_id ON merchant_receivables (settlement_id)")
    op.execute("COMMENT ON TABLE merchant_receivables IS '核销后商家全额应收，平台承担积分补贴及佣金'")
    op.execute("COMMENT ON COLUMN merchant_receivables.merchant_id IS '商家'")
    op.execute("COMMENT ON COLUMN merchant_receivables.order_id IS '来源订单'")
    op.execute("COMMENT ON COLUMN merchant_receivables.voucher_id IS '唯一核销事实'")
    op.execute("COMMENT ON COLUMN merchant_receivables.gross_amount IS '含积分完整成交额'")
    op.execute("COMMENT ON COLUMN merchant_receivables.cash_amount IS '消费者微信实付'")
    op.execute("COMMENT ON COLUMN merchant_receivables.points_amount IS '平台积分补贴'")
    op.execute("COMMENT ON COLUMN merchant_receivables.settlement_id IS '所属对账批次'")
    op.add_column(
        "products",
        sa.Column(
            "merchant_id",
            sa.Uuid(),
            sa.ForeignKey("merchants.id", ondelete="RESTRICT"),
            nullable=True,
            comment="到店消费商家",
        ),
    )
    op.create_index("ix_products_merchant_id", "products", ["merchant_id"])
    op.add_column(
        "products",
        sa.Column(
            "fulfillment_mode",
            sa.String(16),
            nullable=False,
            comment="历史履约或商家到店核销",
            server_default=sa.text("'legacy'"),
        ),
    )
    op.add_column(
        "product_skus",
        sa.Column(
            "max_points_deduction",
            sa.BigInteger(),
            nullable=False,
            comment="每件最多抵扣的整数积分，1积分抵1元",
            server_default=sa.text("0"),
        ),
    )
    op.add_column(
        "orders",
        sa.Column(
            "order_gross_amount",
            sa.Numeric(15, 2),
            nullable=False,
            comment="积分抵扣前完整成交额",
            server_default=sa.text("0"),
        ),
    )
    op.add_column(
        "orders",
        sa.Column(
            "points_deduction",
            sa.BigInteger(),
            nullable=False,
            comment="订单使用积分，1积分抵1元",
            server_default=sa.text("0"),
        ),
    )
    op.add_column(
        "orders",
        sa.Column(
            "merchant_id",
            sa.Uuid(),
            sa.ForeignKey("merchants.id", ondelete="RESTRICT"),
            nullable=True,
            comment="成交商家",
        ),
    )
    op.create_index("ix_orders_merchant_id", "orders", ["merchant_id"])
    op.add_column(
        "orders",
        sa.Column(
            "merchant_snapshot", postgresql.JSONB(none_as_null=True), nullable=True, comment="成交商家公开资料快照"
        ),
    )
    op.add_column(
        "orders",
        sa.Column(
            "fulfillment_mode",
            sa.String(16),
            nullable=False,
            comment="历史履约或到店核销",
            server_default=sa.text("'legacy'"),
        ),
    )
    op.add_column(
        "order_items",
        sa.Column(
            "points_deduction",
            sa.BigInteger(),
            nullable=False,
            comment="确定性分配的行积分",
            server_default=sa.text("0"),
        ),
    )
    op.add_column(
        "refund_requests",
        sa.Column(
            "points_returned",
            sa.BigInteger(),
            nullable=False,
            comment="整单原路返还积分，现金退款额不含积分",
            server_default=sa.text("0"),
        ),
    )
    op.execute("UPDATE orders SET order_gross_amount = items_amount + freight_amount")
    op.create_check_constraint(
        "ck_products_fulfillment_mode",
        "products",
        "fulfillment_mode IN ('legacy', 'local') AND (fulfillment_mode <> 'local' OR merchant_id IS NOT NULL)",
    )
    op.create_check_constraint(
        "ck_product_skus_points_limit",
        "product_skus",
        "max_points_deduction >= 0 AND max_points_deduction <= 9999999999999",
    )
    op.drop_constraint("ck_order_amounts", "orders", type_="check")
    op.create_check_constraint(
        "ck_order_amounts",
        "orders",
        "items_amount >= 0 AND freight_amount >= 0 AND points_deduction >= 0 AND order_gross_amount = items_amount + freight_amount AND total_amount = order_gross_amount - points_deduction AND total_amount >= 0",
    )
    op.drop_constraint("ck_order_address_snapshot", "orders", type_="check")
    op.create_check_constraint(
        "ck_order_address_snapshot",
        "orders",
        "(fulfillment_mode = 'local' AND merchant_id IS NOT NULL AND address_snapshot IS NULL AND freight_amount = 0) OR (fulfillment_mode = 'legacy' AND points_deduction = 0 AND ((product_type = 'physical' AND address_snapshot IS NOT NULL AND jsonb_typeof(address_snapshot) = 'object') OR (product_type = 'virtual' AND address_snapshot IS NULL)))",
    )
    op.create_check_constraint(
        "ck_order_item_points", "order_items", "points_deduction >= 0 AND points_deduction <= line_amount"
    )
    op.drop_constraint("ck_refund_request_amount", "refund_requests", type_="check")
    op.create_check_constraint(
        "ck_refund_request_amount",
        "refund_requests",
        "items_amount >= 0 AND freight_amount >= 0 AND points_returned >= 0 AND amount = items_amount + freight_amount - points_returned AND amount >= 0",
    )
    op.drop_constraint("ck_points_ledger_source", "points_ledgers", type_="check")
    op.create_check_constraint(
        "ck_points_ledger_source",
        "points_ledgers",
        "source_type IN ('invite', 'order', 'refund', 'redemption', 'manual', 'property')",
    )
    op.alter_column("products", "fulfillment_mode", server_default=None)
    op.alter_column("product_skus", "max_points_deduction", server_default=None)
    op.alter_column("orders", "order_gross_amount", server_default=None)
    op.alter_column("orders", "points_deduction", server_default=None)
    op.alter_column("orders", "fulfillment_mode", server_default=None)
    op.alter_column("order_items", "points_deduction", server_default=None)
    op.alter_column("refund_requests", "points_returned", server_default=None)
    op.create_table(
        "merchant_payment_events",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column(
            "settlement_id",
            sa.Uuid(),
            sa.ForeignKey("merchant_settlements.id", ondelete="RESTRICT"),
            nullable=False,
            comment="结算批次",
        ),
        sa.Column("request_id", sa.Uuid(), nullable=False, unique=True, comment="付款或纠错幂等号"),
        sa.Column("revision", sa.Integer(), nullable=False, comment="操作后的批次版本"),
        sa.Column("kind", sa.String(16), nullable=False, comment="付款或冲正登记"),
        sa.Column("amount", sa.Numeric(15, 2), nullable=False, comment="本次登记全额"),
        sa.Column("payment_reference", sa.String(100), nullable=False, comment="原线下付款凭据"),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=False, comment="原实际付款时间"),
        sa.Column(
            "actor_id", sa.Uuid(), sa.ForeignKey("admins.id", ondelete="RESTRICT"), nullable=False, comment="登记管理员"
        ),
        sa.Column("reason", sa.String(300), nullable=False, comment="纠错原因，冲正不执行资金转账"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("settlement_id", "revision", name="uq_merchant_payment_revision"),
        sa.CheckConstraint("kind IN ('payment', 'reversal')", name="ck_merchant_payment_kind"),
        sa.CheckConstraint("amount >= 0 AND revision > 0", name="ck_merchant_payment_values"),
        comment="不可删除的线下付款登记及纠错冲正历史",
    )
    op.create_index("ix_merchant_payment_events_settlement_id", "merchant_payment_events", ["settlement_id"])


def downgrade() -> None:
    # 有到店资金、授权或商品配置后禁止破坏性降级，使用前向修复。
    op.execute(
        """DO $$ BEGIN IF EXISTS (SELECT 1 FROM merchants) OR EXISTS (SELECT 1 FROM property_operators) OR EXISTS (SELECT 1 FROM orders WHERE fulfillment_mode = 'local') OR EXISTS (SELECT 1 FROM product_skus WHERE max_points_deduction <> 0) THEN RAISE EXCEPTION 'Local commerce data exists; forward repair required'; END IF; END $$"""
    )
    op.drop_constraint("ck_products_fulfillment_mode", "products", type_="check")
    op.drop_constraint("ck_product_skus_points_limit", "product_skus", type_="check")
    op.drop_constraint("ck_order_amounts", "orders", type_="check")
    op.create_check_constraint(
        "ck_order_amounts",
        "orders",
        "items_amount >= 0 AND freight_amount >= 0 AND total_amount = items_amount + freight_amount",
    )
    op.drop_constraint("ck_order_address_snapshot", "orders", type_="check")
    op.create_check_constraint(
        "ck_order_address_snapshot",
        "orders",
        "(product_type = 'physical' AND address_snapshot IS NOT NULL AND jsonb_typeof(address_snapshot) = 'object') OR (product_type = 'virtual' AND address_snapshot IS NULL)",
    )
    op.drop_constraint("ck_order_item_points", "order_items", type_="check")
    op.drop_constraint("ck_refund_request_amount", "refund_requests", type_="check")
    op.create_check_constraint(
        "ck_refund_request_amount",
        "refund_requests",
        "items_amount >= 0 AND freight_amount >= 0 AND amount = items_amount + freight_amount",
    )
    op.drop_constraint("ck_points_ledger_source", "points_ledgers", type_="check")
    op.create_check_constraint(
        "ck_points_ledger_source",
        "points_ledgers",
        "source_type IN ('invite', 'order', 'refund', 'redemption', 'manual')",
    )
    op.drop_column("refund_requests", "points_returned")
    op.drop_column("order_items", "points_deduction")
    op.drop_column("orders", "fulfillment_mode")
    op.drop_column("orders", "merchant_snapshot")
    op.drop_column("orders", "merchant_id")
    op.drop_column("orders", "points_deduction")
    op.drop_column("orders", "order_gross_amount")
    op.drop_column("product_skus", "max_points_deduction")
    op.drop_column("products", "fulfillment_mode")
    op.drop_column("products", "merchant_id")
    op.drop_table("merchant_receivables")
    op.drop_table("merchant_payment_events")
    op.drop_table("merchant_settlements")
    op.drop_table("redemption_vouchers")
    op.drop_table("order_points_reservations")
    op.drop_table("property_grants")
    op.drop_table("local_binding_events")
    op.drop_table("property_operators")
    op.drop_table("merchants")
