# apps/backend

FastAPI 商城后端，提供认证、授权、审计、运行基础设施和按阶段建设的电商领域。

## 技术栈

- FastAPI + SQLAlchemy 2.0 async + Alembic
- PostgreSQL + Redis
- Pydantic v2 + Loguru
- uv 包管理

## 本地启动

```powershell
uv python install 3.14
uv python pin 3.14
uv sync --locked
uv run python -c "import sys; assert sys.version_info[:2] == (3, 14); print(sys.version)"
uv run alembic upgrade head
uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 18168
```

本项目使用 uv 管理 Python 版本、项目 `.venv`、依赖和命令运行，不要求激活 Conda 环境。环境变量职责、VS Code 工作区和后端启动顺序见[环境变量分层与 Backend 本地运行手册](../../docs/operations/environment-variables-and-backend-local-run.md)，完整的 Windows 环境、PostgreSQL 和 Docker Desktop Redis 初始化见[本地开发环境手册](../../docs/operations/local-dev-environment.md)。

## 环境变量

复制 `apps/backend/.env.example` 为 `apps/backend/.env` 并填入本地配置。真实 `.env` 不得提交到仓库。

## 当前范围

当前已实现配置、请求上下文、统一错误响应、数据库会话与事务、Redis 生命周期、Alembic、健康探针和 `system` 状态接口，以及消费者微信 Bearer、Admin Cookie 认证、用户、管理员、RBAC、Session/Refresh、CSRF、限流、安全事件、审计和可选请求元数据管道。

- 商城已有商品分类、SPU 与稳定 SKU、商品图片、库存、购物车、本人订单、支付售后、评价与对账，以及会员资格、三级佣金、双轨钱包和历史提现处理。
- 新购仅支持已绑定有效商家的到店商品，同一订单限一个商家。服务端提供 SKU 限额积分抵扣、支付确认、纯积分内部成交、核销、未核销整单退款和商家结算。历史物流和虚拟履约按原订单处理。见[商城后端设计](../../docs/architecture/commerce-backend.md)和[到店业务手册](../../docs/operations/local-commerce.md)。
- 消费者私有接口使用微信 Bearer。普通商户微信支付、通知、查关单及退款已有源码，微信登录和支付默认关闭。新提现申请当前未开放，后台保留历史申请审核及人工付款确认。见[微信支付手册](../../docs/operations/wechat-pay.md)和[小程序 PRD](../../docs/MINIAPP_PRD.md)。
- 已记录的本机开发库版本为 `20261121_01`，权限目录已同步。来源项目的数据库及动态测试记录保存在原实施计划，本项目测试库、生产及真实渠道需独立验证。见[项目索引](../../PROJECT_INDEX.md)。

## 质量检查

```powershell
uv run ruff check .
uv run ruff format --check .
uv run mypy app
uv run lint-imports
uv run python -m compileall -q app alembic scripts
uv run python -c "from app.main import app; app.openapi()"
uv run python -m scripts.verify_target_model
```

公开接口变化后运行 `uv run python -m scripts.export_openapi`，再在仓库根运行 `pnpm generate-api`。待付款超时处理使用 `uv run python -m scripts.expire_pending_orders --confirm-database <数据库名>` 预览，显式追加 `--apply` 后才写入。持久任务执行器使用 `uv run python -m scripts.run_durable_tasks --confirm-database <数据库名>` 预览，追加 `--apply` 运行一轮，追加 `--apply --watch` 持续运行有界批次。常驻运行需要外部托管与告警。pytest 与真实数据库迁移仅在当前任务明确点名授权后执行。数据库集成测试必须显式配置独立的 `TEST_DATABASE_URL` 和 `TEST_REDIS_URL`，数据库名以 `_test` 结尾。
