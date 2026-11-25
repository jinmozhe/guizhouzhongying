# 1Panel 单机源码部署手册

贵州众赢的 Backend 使用一个 1Panel Python 运行环境。整仓按发布版本保存在宿主机，每次只把当前发布的 `apps/backend` 只读挂载至 `/app`。Admin 构建产物由 OpenResty 托管。

## 1. 准备发布文件

1. 核对待部署提交的 GitHub 验证结果，记录完整 40 位 Git SHA。将 Git 跟踪的源码导出到独立发布目录，例如 `/srv/guizhouzhongying/releases/<commit>`。每次发布创建新目录，保留上一版。
2. 在验证过的环境按根目录 Node 和 pnpm 版本执行 `pnpm install --frozen-lockfile` 和 `pnpm --filter @pinjie/admin build`。部署同一提交生成的 `apps/admin/dist`，记录静态归档的 SHA-256。OpenResty 的网站根目录只能指向静态产物，不指向仓库根目录。
3. 核对 1Panel 支持标准 CPython 3.14、主机架构为 Linux x86_64、Compose 支持 `env_file.format: raw`。核验 Docker 官方 `python` 镜像的受支持补丁和完整 digest。选择通过原生扩展导入检查的 Python 镜像并记录实际版本。
4. 从 [Backend Dockerfile](../../apps/backend/Dockerfile) 首行固定的 uv 镜像中取得 `/uv` 文件。用 `docker create`、`docker cp` 提取，移除本次用于提取的临时容器。把 Linux x86_64 的二进制放入受控目录，给运行用户执行权限。记录来源 digest，版本须符合 `pyproject.toml`。
5. 创建一个持久 Python 依赖目录及一个持久数据目录。数据目录内建 `uploads` 和 `settings-media`。授权 `10001:10001` 写入这两个目录及依赖目录，源码与 uv 文件仅需读权限及相应的搜索或执行权限。
6. 在发布目录之外使用 [Backend 配置模板](../../apps/backend/.env.example) 准备受限的生产配置文件。采用 `KEY=value`，值中的密码、JSON 数组和 `$` 按原样传入，不给值加用于 shell 解析的外层引号。准备用于生产的认证密钥、`DEBUG=false`、`API_DOCS_ENABLED=false`、`AUTH_COOKIE_SECURE=true`、可信域名和代理 CIDR。`TRUSTED_HOSTS` 包含实际 API 域名、Admin 域名和容器健康探针所用的 `127.0.0.1`。PostgreSQL 和 Redis 通过 `1panel-network` 和实际服务名访问。

## 2. 创建和配置 Python 环境

1. 在 1Panel 的网站、运行环境中创建一个 Python 环境，源码目录选择该发布的 `apps/backend`。端口预留宿主机 `127.0.0.1:18168` 到容器的 `18168`。创建阶段可以先使用 `exec sleep infinity`，登记成功后停止该运行环境。
2. 定位面板运行环境目录 `<1Panel 运行环境根目录>/python/<环境名称>`，备份其 `docker-compose.yml` 和 `.env`。用仓库 [Python 运行模板](../../deploy/1panel/python.compose.yml) 替换该目录的 `docker-compose.yml`。保留面板登记的 `CONTAINER_NAME`，使用原目录和 `python` 服务名。
3. 在该目录的 `.env` 中设置下表变量。此文件与 Backend 的生产配置文件分开维护。

| 变量 | 值 |
| --- | --- |
| `CONTAINER_NAME` | 1Panel 已生成的容器名 |
| `CODE_DIR` | 已核验提交对应的宿主机 `apps/backend` 绝对路径 |
| `BACKEND_COMMIT` | 该发布的完整 Git SHA |
| `PYTHON_RUNTIME_DIGEST` | 批准的 Docker 官方 Python 镜像完整 `sha256:` 引用中的摘要部分 |
| `BACKEND_ENV_FILE` | 受限 Backend 生产配置文件的宿主机绝对路径 |
| `BACKEND_RUNTIME_DIR` | Python 依赖和 uv 缓存的持久目录绝对路径 |
| `BACKEND_STORAGE_DIR` | 上传及配置媒体的持久目录绝对路径 |
| `BACKEND_UV_BIN` | Linux uv 可执行文件的宿主机绝对路径 |

面板的状态、启停和日志使用同一个运行环境。配置更新以仓库模板及服务器变量为准。面板的编辑和版本升级操作可能重写生成文件，操作后复核实际 Compose 配置再启动。

## 3. 准备依赖并启动

在面板运行环境目录执行以下命令。切换版本前暂停写入与后台任务，备份 PostgreSQL 和 `/storage` 对应的宿主机目录。确认原服务与新运行环境使用的数据库、存储和端口符合部署记录。准备依赖期间保持常驻 Backend 停止。

```bash
docker compose config --quiet
docker compose pull python
docker compose run --rm -T --no-deps python bash /app/scripts/run_1panel.sh prepare
docker compose run --rm -T --no-deps python \
  /runtime/.venv/bin/python -c 'import sys, sysconfig, asyncpg, cryptography, orjson, PIL, ssl; assert sys.version_info[:2] == (3, 14); assert not sysconfig.get_config_var("Py_GIL_DISABLED"); print(sys.version, ssl.OPENSSL_VERSION)'
```

模板按 `uv.lock` 安装 Linux 生产 Wheel，复用镜像内的 Python。安装、原生扩展导入或 OpenSSL 检查有异常时停止发布。同一运行环境的维护命令、API 和后台任务共用 `/runtime/.venv`。

确认迁移与目标库已获授权后执行一次性命令。把 `YOUR_DATABASE` 改成已核验的目标数据库名。

```bash
docker compose run --rm -T --no-deps python /runtime/.venv/bin/python -m alembic upgrade head
docker compose run --rm -T --no-deps python \
  /runtime/.venv/bin/python -m scripts.sync_permissions --apply --confirm-database YOUR_DATABASE
docker compose run --rm -T --no-deps python \
  /runtime/.venv/bin/python -m scripts.sync_permissions --check --confirm-database YOUR_DATABASE
docker compose up -d --wait python
docker compose ps python
```

API 启动时离线核验已安装依赖。初始管理员使用同一运行环境的 `scripts.create_initial_admin`，参数见脚本 `--help`。启用 `REQUEST_LOG_MODE=metadata` 时，独立托管 `docker compose exec -T python /runtime/.venv/bin/python -m scripts.consume_request_logs`。

到店交易启用前，在 API 和 Worker 注入相同的 `LOCAL_REDEMPTION_KEY`，核对六项权限并独立托管持久任务进程。七天到期退款也适用于纯积分订单，因此启用到店时即需要 Worker。Compose 模板的 `python` 服务只启动 API。以下命令由外部进程管理器执行，并配置重启、日志和告警。微信现金支付另需配置只读密钥挂载。见[到店业务手册](local-commerce.md)及[微信支付手册](wechat-pay.md)。

```bash
docker compose exec -T python /runtime/.venv/bin/python -m scripts.run_durable_tasks \
  --confirm-database YOUR_DATABASE --apply --watch
```

## 4. 配置 HTTPS 和验收

1. Admin 使用 1Panel 静态网站。把 [Admin 站点配置](../../deploy/1panel/admin.locations.conf) 合入站点的 `server` 块，替换已有的 `location /`，并核对同层配置无重复项。保留面板设置的 `root`、TLS 证书及证书签发路径。`/static/uploads/` 与 `/static/settings/` 路径采用内容哈希与版本化命名，模板已附带 `Cache-Control: public, max-age=31536000, immutable` 强缓存与安全响应头。
2. 小程序使用独立 API HTTPS 域名。1Panel 配置反代上游 `http://127.0.0.1:18168`，前提是 OpenResty 可访问宿主机环回地址。若 OpenResty 使用独立容器网络，将其接入 `1panel-network`，并在两个站点使用实际 Python 容器名和 `18168` 作为上游。建议在小程序 API 站点的 `/static/uploads/` 与 `/static/settings/` 同样设置 `Cache-Control: public, max-age=31536000, immutable` 与 `X-Content-Type-Options: nosniff` 响应头，避免小程序重复下载图片。保持 Backend 宿主机端口只绑定环回地址。
3. 转发有效的 `Host`、`X-Forwarded-Proto` 和客户端 IP。站点覆盖外部传入的 `X-Forwarded-For`。根据 Backend 实际收到的 TCP 对端配置精确的 `TRUSTED_PROXY_CIDRS`，仅信任实际反代来源。
4. 如需将既有历史静态图片离线转换为 WebP 并按需补齐 480px 缩略图，可先执行 `docker compose exec -T python /runtime/.venv/bin/python -m scripts.optimize_legacy_image_assets --dry-run --confirm-database YOUR_DATABASE` 预演核对，确认备份后再传入 `--apply`。
5. 验证 OpenResty 配置语法后应用。核验 Backend `/health/live`、`/health/ready`、Admin `/healthz`、Admin 同域登录与刷新、上传和配置媒体、独立 API 域名的关键入口。首个成功发布记录完整 Git SHA、Python 和 uv 来源 digest、Admin 静态归档哈希、数据库 revision、备份编号和结果。

## 5. 回滚

停止应用和后台任务，确认旧版与当前数据库 revision 的兼容范围。恢复上一版源码路径、`BACKEND_COMMIT`、批准的 Python/uv 运行配置和 Admin 静态根目录。重跑 `prepare`，启动并验证探针与关键业务。PostgreSQL 和文件恢复按同一备份窗口执行，涉及覆盖或数据回退时遵循 [数据库备份与恢复手册](database-backup-restore.md)。
