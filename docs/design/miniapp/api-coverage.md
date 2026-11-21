# 小程序设计与现有后端能力映射

## 核对依据与适用范围

能力矩阵按 2026-11-21 的根 [OpenAPI](../../../openapi.json)、Backend Router、应用服务和小程序入口核对。接口及页面列为本地实现，真实微信、渠道和业务验收以实施计划的证据为准。

页面、弹层与状态图片清单见[完整设计目录](catalog-v2.md)，离线图片浏览见[图集](gallery-v2.html)。图集和设计元数据中的方法与路径均从当前根契约核验；元数据只登记设计图片与证据，不定义第二套 API、DTO 或业务政策。

图片与图集保留历史设计示例，包括配送结算、旧改密、直接注销和提现申请。当前业务范围查看本表、PRD 和实际页面源码。

用户已确认 V1 视觉风格。V2 延续该风格并覆盖 PRD 的 R1/R2 页面及相关限制状态，扩展流程仍待评审。所有商品、金额、用户、地址、时间、编号和邀请码均为设计示例，状态图是互相独立的示例，不构成一套真实交易账本。

## 全局身份与资金边界

- 身份、基础交易、履约售后与评价已并入原业务路径并统一使用 ConsumerBearer，默认微信登录关闭；本人订单履约组合分页、确认收货、整单售后记录与请求恢复、评价资格已接入。下表为统一后的实际消费者路径，详见[身份手册](../../operations/miniapp-identity-and-content.md)和[履约售后手册](../../operations/miniapp-fulfillment-and-aftersales.md)。账户设置、本人会话及只读注销前置已有源码，详见[账户安全手册](../../operations/miniapp-account-security.md)；实际注销关闭，不要求无密码账户填不存在的密码。
- 微信调起参数 `payment_parameters`、持久通知和查关单已有源码，渠道默认关闭。支付弹窗返回后查询服务端状态。见[微信支付手册](../../operations/wechat-pay.md)。
- 微信退款适配及内部补偿已有源码。到店未核销走自动整单退款，按原支付渠道退现金并返还积分。历史订单继续按原方式审核。申请、执行和资金状态分别展示，真实资金及动态恢复待验收。
- 提现申请、审核和带凭证的人工完成已有实现，真实自动打款和收款目标接入未完成。小程序历史查询已有源码，`succeeded` 且有确认时间才显示人工或渠道确认；`approved` 不表示到账，新提现申请继续关闭。资料与资金领域入口见[接入手册](../../operations/miniapp-profile-and-finance.md)。

## 页面能力矩阵

| 页面组 | 现有消费端方法与路径 | 设计采用的信息与操作 | 尚需补齐或限制 |
| --- | --- | --- | --- |
| 首页/分类 | `GET /api/v1/product-categories`、`GET /api/v1/products/recommended`、`GET /api/v1/products` | 分类名称、父子关系、图标、完整推荐商品数组、分类分页商品、基础 SKU 价格 | 首页一次完整展示。分类按名称和分类树服务端过滤。推荐字段已在本机开发库迁移，微信动态验收未执行 |
| 商品详情/规格 | `GET /api/v1/products/{product_id}` | 主图、description、attributes、SKUs、detail_images；有效规格组合、图片原生预览 | 当前公开 SKU 无可用库存字段，不能给出库存承诺；受限 HTML v1 已有源码，历史说明审计及迁移未执行 |
| 商品评价 | `GET /api/v1/products/{product_id}/reviews` | rating、content、published_at 与分页 | 不虚构头像、评价图片、回复或全量好评率 |
| 购物车 | `GET/POST /api/v1/cart-items`、`PATCH/DELETE /api/v1/cart-items/{item_id}` | sku_id、quantity、selected、revision；修改数量、选择和单条删除 | 已返回名称、缩略图、可售性与库存状态；不伪造批量删除 |
| 统一报价/结算 | `POST /api/v1/commerce/quotes`、`POST /api/v1/checkout/preview` | 服务端会员价、成交总额、积分用量、现金应付与报价指纹 | 实际结算只接受同一启用商家的到店 SKU，免地址与运费。数量或积分变化后重新报价 |
| 下单 | `POST /api/v1/orders` | request_id、完整商品意图、quote_fingerprint；零应付内部成交 | 按原 request_id 查询或主动同键同内容恢复，不生成新号重复下单 |
| 我的订单列表 | `GET /api/v1/orders` | 本人分页、订单与履约组合状态、筛选 | 已有安全查询与页面，不显示未经查询的统计角标 |
| 订单详情/取消 | `GET /api/v1/orders/{order_id}`、`POST /api/v1/orders/{order_id}/cancel` | 订单与商品快照、金额、acceptance_status、待付款取消 | status 只有 pending_payment/paid/cancelled；待发货/待收货/已完成须联合履约事实，不另造订单枚举 |
| 支付结果 | `POST /api/v1/orders/{order_id}/payment-attempts`、`GET /api/v1/orders/{order_id}/payment-attempts/by-request/{request_id}` | 微信调起参数、原请求查询与未知结果恢复 | 微信默认关闭，真实渠道待验证。纯积分直接查询服务端成交 |
| 历史实物/虚拟履约 | `GET /api/v1/orders/{order_id}`、`POST /api/v1/orders/{order_id}/fulfillment/confirm-receipt` | 本人履约事实、操作资格、运单与交付引用、时间与 revision | 历史实物和虚拟订单适用。交付信息限本人，动态验收未执行 |
| 退款申请/记录 | `POST /api/v1/orders/{order_id}/refunds`、`GET /api/v1/refunds` 及详情和原请求查询 | 整单金额、执行与资金状态、未知结果恢复 | 到店仅未核销可退。历史物流和虚拟订单按既有规则。真实渠道与恢复待验收 |
| 到店角色与凭证 | `GET /api/v1/merchants/{merchant_id}`、`GET /api/v1/orders/{order_id}/redemption`、`POST /api/v1/merchant/redemptions/preview`、`POST /api/v1/merchant/redemptions/confirm` | 公开商家、本人凭证、商家预览和确认整单核销 | 凭证仅买家本人读取。核销要求有效商家身份及订单归属，实际扫码和并发待验收 |
| 物业与商家财务 | `POST /api/v1/property/points/lookup-user`、`POST /api/v1/property/points/grants`、`GET /api/v1/merchant/receivables`、`GET /api/v1/merchant/settlements` | 物业按手机号核对目标和发放，商家查询本人应收与批次 | 服务端分别校验物业和商家角色，资金由平台线下付款后登记 |
| 提交评价 | `POST /api/v1/order-items/{order_item_id}/review`、orders 本人 item_reviews | 1 至 5 分、正文最多 1000 字、资格与已有本人评价 | 已有源码；仅本人已交付明细一次评价；无图片上传；重复及动态验收未执行 |
| 本人资料/头像/手机 | `GET/PATCH /api/v1/users/me`、`PUT /api/v1/users/me/avatar`、`POST /api/v1/users/me/avatar-assets`、`POST /api/v1/users/me/phone` | 昵称、主动头像上传及本人首次可信绑手机 | 固定本人头像场景，手机号仅首次绑定。平台授权与上传待验收 |
| 退出与恢复 | `POST /api/v1/auth/logout`、`POST /api/v1/auth/refresh` | 主动退出、内存凭据单次刷新轮换、保留公开浏览 | 已有独立 ConsumerBearer 源码，平台及动态账户隔离验收未执行 |
| 账户设置/会话 | `GET /api/v1/users/me/sessions`、`POST /api/v1/users/me/sessions/revoke`、`POST /api/v1/users/me/sessions/revocation-status` | 本人分页、遮掩网络段、当前/有效/过期/撤销、明确原集合确认与恢复 | 已有源码，不证明物理设备身份；一次最多 100 个，当前会话走退出，新登录会话不加入原目标；并发及平台未验收 |
| 注销前置/隐私 | `GET /api/v1/users/me/closure-precheck`、公开帮助 | 公开说明、本人八类交易权益只读核对、未开通/零事项/失败区分、联系运营 | 已有源码，self_service_enabled 恒 false，实际注销关闭；不删除账户、解绑身份或放弃权益，旧 Browser 密码/注销入口已退役 |
| 收货地址 | `GET/POST /api/v1/addresses`、`PUT/DELETE /api/v1/addresses/{address_id}` | 收件人、联系号码、三级区域名称/编码、详细地址、默认值与 revision | 最多 20 条，删除默认地址由后端选替补。小程序使用 `@vant/area-data`，当前到店结算免地址 |
| 分销档案 | `GET /api/v1/distribution/me/profile` | 基础档案自动初始化，查看等级名称、有效状态及已有推荐关系 | 小程序已移除手动开通入口，根契约保留 POST。无有效邀请统计 |
| 推荐关系 | `GET/POST /api/v1/distribution/me/referrer` | 本人码、主动确认首次绑定、已绑定事实及指定原码匹配查询 | 已有安全投影与页面源码；服务端拒绝自邀/循环/换绑；平台及数据库动态验证未执行，不输出推荐人身份 |
| 微信分享 | 本人推荐查询与页面原生分享，无独立发码接口 | 固定落地路径、本人邀请码、登录后主动确认、非法参数反馈 | 已有页面钩子、按钮与固定 5:4 封面源码；AppID 预留、平台未验收；有效邀请政策未定义，不做收益承诺 |
| 双钱包/流水 | `GET /api/v1/distribution/me/wallets`、`GET /api/v1/distribution/me/wallets/{wallet_type}/ledgers` | 两轨可用/冻结/欠款、本人分页流水、三类变化与历史余额快照 | 已有源码；无充值、互转或抵扣；读取失败不伪造余额；不输出幂等键或关联订单 |
| 佣金 | `GET /api/v1/distribution/me/commissions` | amount、level、base_amount、rate、recovered_amount、状态与时间 | 已有本人分页源码；无状态筛选或收益汇总，不输出买家、订单或完整规则快照；动态验收未执行 |
| 提现 | `GET /api/v1/distribution/me/withdrawals` | 金额、审核/执行状态、人工或渠道确认事实、时间与分页 | 已有历史查询源码；不输出收款目标、运营身份、自由文本或渠道引用；新申请关闭，真实自动渠道未接通 |
| 积分 | `GET /api/v1/users/me/points`、`GET /api/v1/users/me/points/ledgers` | 本人账户状态、可用、冻结、欠款及分页流水 | 大整数使用精确字符串。到店结算支持 SKU 限额抵扣，积分自身到期及其他兑换暂未开放 |
| 关于/帮助/隐私 | `GET /api/v1/system/help`；原 system/site-profile 仅资料参考 | 公开帮助、问题展开、电话/邮箱操作或未配置提示、隐私说明 | 已有帮助源码；联系方式由 Backend Settings 配置，未配置明确 null；正式协议与主体需运营确认，无聊天客服 |

## 源码证据入口

| 范围 | 实际文件 |
| --- | --- |
| 交易 Router 与本人安全投影 | [transaction_router.py](../../../apps/backend/app/api/transaction_router.py)、[trade_queries.py](../../../apps/backend/app/services/trade_queries.py)、[专用展示契约](../../../apps/backend/app/services/trade_query_schemas.py) |
| 消费端商品、地址 Router | [commerce_router.py](../../../apps/backend/app/api/commerce_router.py) |
| 购物车、结算与订单 Router | [transaction_router.py](../../../apps/backend/app/api/transaction_router.py) |
| 支付、履约、退款与评价 Router | [lifecycle_router.py](../../../apps/backend/app/api/lifecycle_router.py) |
| 分销、推荐、双钱包与提现 Router | [distribution_router.py](../../../apps/backend/app/api/distribution_router.py) |
| 小程序资料与资金安全投影 | [finance_queries.py](../../../apps/backend/app/services/finance_queries.py)、[专用展示契约](../../../apps/backend/app/services/finance_query_schemas.py)、[共享资料用例](../../../apps/backend/app/services/accounts.py) |
| 统一报价、管理端积分等 Router | [membership_router.py](../../../apps/backend/app/api/membership_router.py) |
| 用户与设备安全 Router | [users/router.py](../../../apps/backend/app/domains/users/router.py) |
| 订单/报价字段 | [orders/schemas.py](../../../apps/backend/app/domains/orders/schemas.py) |
| 履约/支付/退款/评价字段 | [lifecycle/schemas.py](../../../apps/backend/app/domains/lifecycle/schemas.py) |
| 会员/双钱包/佣金/提现字段 | [distribution/schemas.py](../../../apps/backend/app/domains/distribution/schemas.py) |
| 支付、退款资格与审核、收货和评价校验 | [payment_lifecycle.py](../../../apps/backend/app/services/payment_lifecycle.py) |
| 购物车版本与数量校验 | [cart.py](../../../apps/backend/app/services/cart.py) |
| 地址数量、版本与默认替补 | [addresses/service.py](../../../apps/backend/app/domains/addresses/service.py) |
| 提现冻结、欠款约束与人工确认 | [distribution/service.py](../../../apps/backend/app/domains/distribution/service.py) |
| 状态硬约束 | [订单模型](../../../apps/backend/app/db/models/order.py)、[生命周期模型](../../../apps/backend/app/db/models/commerce_lifecycle.py)、[分销模型](../../../apps/backend/app/db/models/distribution.py) |

## 交互表现与验证边界

图片覆盖页面首屏、弹层打开、已选/禁用规格、删除确认、数量与版本冲突、报价变化、提交中、结果未知、失败后保留输入及适用的初次加载/空态/未登录。每张图的具体限制见图片图集的“接口与设计边界”。

图片只能呈现一个状态，不能演示动画、点击、键盘、滚动、手势、请求结果或账户隔离。生成前检查画布布局，生成后核对图片解码与尺寸、每个引用方法/路径存在于根契约，并人工检查分组总览；这些辅助检查不等于应用测试、浏览器验证或微信真机验收。

静态图保留设计交付时的视觉状态。当前页面及平台验收边界见[小程序 PRD](../../MINIAPP_PRD.md)和[到店全栈计划](../../../plans/2026-11-21_商家核销与物业积分消费全栈计划.md)。
