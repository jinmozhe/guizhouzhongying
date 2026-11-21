# 环境变量与 Backend 本地运行手册

## 1. 适用范围

本文适用于 `guizhouzhongying` 的 Backend 与 Admin。本项目没有可运行的 Web 端，禁止创建或启动 Web 服务，禁止监听 3000 或其他 Web 端口。

## 2. 配置分层

| 层级 | 模板 | 真实文件 | 使用者 | 职责 |
| --- | --- | --- | --- | --- |
| 部署层 | 根 `.env.example` | 根 `.env` | `compose.prod.yml` | 选择 Backend、Admin 的不可变镜像 |
| Backend | `apps/backend/.env.example` | `apps/backend/.env` | FastAPI 与运维脚本 | 数据库、Redis、认证、安全和文件存储 |
| Admin | `apps/admin/.env.example` | `apps/admin/.env.local` | Umi Max | 本地代理配置 |

真实 `.env`、`.env.local`、Token、密码、证书、生产域名和镜像 digest 不得提交。根 `.env` 只包含 `BACKEND_IMAGE` 与 `ADMIN_IMAGE`，不会自动进入 Backend 容器。

## 3. Backend 本地配置

从模板创建 `apps/backend/.env` 后，至少设置本机 PostgreSQL、Redis 和四个相互不同的认证密钥。Backend 配置校验要求 `WEB_ORIGINS` 至少有一个显式来源，并与 `ADMIN_ORIGINS` 隔离。Web 服务保持冻结。

```dotenv
PROJECT_NAME="贵州众赢 Backend"
ENVIRONMENT=local
DATABASE_URL=postgresql+asyncpg://guizhouzhongying:your_password@localhost:5432/guizhouzhongying_dev
TEST_DATABASE_URL=postgresql+asyncpg://guizhouzhongying_test:your_password@localhost:5432/guizhouzhongying_test
REDIS_MODE=required
REDIS_URL=redis://127.0.0.1:6381/0
WEB_ORIGINS=["https://miniapp.example.com"]
ADMIN_ORIGINS=["http://localhost:3001"]
WEB_JWT_SECRET=<至少32字节且独立的密钥>
ADMIN_JWT_SECRET=<至少32字节且独立的密钥>
WEB_TOKEN_HMAC_KEY=<至少32字节且独立的密钥>
ADMIN_TOKEN_HMAC_KEY=<至少32字节且独立的密钥>
```

`WEB_JWT_SECRET` 与 `WEB_TOKEN_HMAC_KEY` 仍由 Backend 启动校验要求。微信小程序使用独立 `MINIAPP_*` 凭据，启用方式见[身份接入手册](miniapp-identity-and-content.md)，到店核销和微信支付分别见[到店业务手册](local-commerce.md)与[微信支付手册](wechat-pay.md)。

## 4. 启动顺序

在仓库根目录启动 Redis：

```powershell
docker compose -f compose.yml up -d redis
```

在 `apps/backend` 执行：

```powershell
uv sync --locked
uv run alembic upgrade head
uv run python -m scripts.sync_permissions --check
uv run uvicorn app.main:app --host 127.0.0.1 --port 18168
```

在仓库根目录启动 Admin：

```powershell
pnpm --filter @pinjie/admin dev
```

Admin 默认使用 3001。启动后检查 `http://127.0.0.1:18168/health/live` 与 `http://127.0.0.1:18168/health/ready`。实际数据库升级和权限写入会改变本地数据库，只在确认目标环境后执行。

### 4.1 一键启动本地 Backend

仓库根目录提供 `scripts/start-local.ps1`，会启动或等待 Docker Desktop，启动并验证 Redis，执行数据库迁移和权限目录检查，然后启动 Backend：

```powershell
pnpm dev:backend
```

权限目录需要写入本地开发库时，显式追加 `-ApplyPermissions`：

```powershell
pnpm dev:backend -- -ApplyPermissions
```

脚本以前台方式运行 Uvicorn，使用 `Ctrl+C` 停止 Backend；Redis 容器继续由 Docker Desktop 管理。

## 5. 生产配置

1Panel 源码部署通过独立生产配置文件注入 Backend 环境变量，按 [1Panel 源码部署手册](1panel-source-deployment.md) 配置。下文用于应用镜像部署。

生产根 `.env` 使用来自商城独立 CNB/TCR 发布清单的完整 digest：

```dotenv
BACKEND_IMAGE=ccr.ccs.tencentyun.com/guizhouzhongying/guizhouzhongying-backend@sha256:<64位十六进制摘要>
ADMIN_IMAGE=ccr.ccs.tencentyun.com/guizhouzhongying/guizhouzhongying-admin@sha256:<64位十六进制摘要>
```

`apps/backend/.env` 保存生产数据库、Redis、可信主机、Admin 来源和密钥。生产 Compose 通过 `env_file` 注入 Backend 配置，并固定 `LOG_FILE_ENABLED=false`。数据库和 Redis 由 1Panel 的共享基础设施提供，不在项目 Compose 中声明。
