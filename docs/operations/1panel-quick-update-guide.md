# 1Panel 线上日常版本极简更新指南

本手册面向贵州众赢线上已有 1Panel v2 环境的日常版本迭代更新，只保留直接可执行的 4 步操作。首次建站或全新宿主机初始化见 [1Panel v2 原生网页部署指南](1panel-v2-native-deployment-guide.md) 与 [1Panel 单机源码部署手册](1panel-source-deployment.md)。

---

## 更新前确认（30 秒速查）

每次更新前确认本次变更是否包含以下附加项，没有则全部跳过：

- **是否新增 Python 依赖**（`apps/backend/pyproject.toml` 变化）：有则在第 2 步容器终端补跑依赖安装。
- **是否有数据库迁移**（`apps/backend/alembic/versions/` 新增文件）：有则在第 2 步执行 `alembic upgrade head`。
- **是否新增后台权限点**：有则在第 2 步补跑 `scripts.sync_permissions --apply`。
- **是否改动 Worker 持久任务逻辑**：有则重启 `guizhouzhongying-worker`。
- **是否改动 OpenResty 配置**：有则在对应网站配置中同步后保存重载。

---

## 第 1 步：本地准备 2 个压缩包

在确认本地仓库已切换至目标提交后准备发布包：

1. **打包后端源码 `backend.zip`**
   - 打开本地 `apps/backend/`，只选中以下 5 项压缩为 `backend.zip`（禁止打包 `.venv`、`.env`、`uploads`、日志及缓存目录）：
     - `app/`
     - `alembic/`
     - `alembic.ini`
     - `scripts/`
     - `pyproject.toml`
   - 若本次新增了 Python 依赖，同步导出最新 `requirements.txt` 一并打包。
2. **构建并打包管理端 `admin-dist.zip`**
   - 在仓库根目录执行：

   ```powershell
   pnpm --filter @pinjie/admin build
   ```

   - 打开 `apps/admin/dist/`，全选内部所有文件和目录压缩为 `admin-dist.zip`（确保解压后直接看到 `index.html`，不要多套一层 `dist/`）。

---

## 第 2 步：在 1Panel 网页备份数据库并更新后端

1. **一键备份数据库**
   - 进入「数据库 -> PostgreSQL -> `guizhouzhongying_prod` -> 备份列表」，点击「备份」。
   - 若涉及历史磁盘图片批量改写，同步在主机备份 `/srv/guizhouzhongying/storage/`。
2. **上传并解压覆盖后端源码**
   - 进入「主机 -> 文件」，打开 `/srv/guizhouzhongying/app/`。
   - 上传 `backend.zip` -> 点击「解压」覆盖同名文件 -> 解压后删除 `backend.zip`。
   - 保留 `/srv/guizhouzhongying/app/.venv`、`/srv/guizhouzhongying/storage/` 和面板环境变量不动。
3. **按需执行容器终端命令**
   - 进入「容器 -> `guizhouzhongying-backend` -> 终端」，按本次变更需要执行对应命令：

   ```bash
   # 有新数据库迁移时执行（核对 current 输出与本次最新 revision 一致）
   /app/.venv/bin/python -m alembic upgrade head
   /app/.venv/bin/python -m alembic current
   ```

   ```bash
   # 仅本次新增后台权限时执行
   /app/.venv/bin/python -m scripts.sync_permissions --apply --confirm-database guizhouzhongying_prod
   /app/.venv/bin/python -m scripts.sync_permissions --check --confirm-database guizhouzhongying_prod
   ```

   ```bash
   # 仅本次新增 Python 依赖时执行
   /app/.venv/bin/pip install -r /app/requirements.txt
   ```

4. **重启后端服务**
   - 进入「网站 -> 运行环境 -> Python」，点击 `guizhouzhongying-backend` 的「重启」。
   - 如本次修改了持久任务逻辑，在「主机 -> 终端」补执行：

   ```bash
   sudo systemctl restart guizhouzhongying-worker
   ```

---

## 第 3 步：在 1Panel 网页更新管理端（无需重启）

1. 进入「网站 -> 网站」，找到 `admin.guizhouzhongying.com` 这一行点击目录图标（确认路径为 `/opt/1panel/www/sites/admin.guizhouzhongying.com/index/`，切勿进入 `api.guizhouzhongying.com`）。
2. 上传 `admin-dist.zip` -> 删除除 `admin-dist.zip` 外的全部旧静态文件 -> 点击「解压」 -> 删除 `admin-dist.zip`。
3. 打开 [线上管理后台](https://admin.guizhouzhongying.com) 按一次 `Ctrl + F5` 强刷清除旧缓存，核验本次新增或修改的功能正常。

---

## 第 4 步：更新微信小程序（微信开发者工具发版）

仅本次包含小程序改动时执行：

1. 关闭本地运行中的 `dev:weapp` 终端，在仓库根目录执行生产编译：

   ```powershell
   $env:NODE_ENV = 'production'
   $env:TARO_APP_API_BASE_URL = 'https://api.guizhouzhongying.com'
   $env:TARO_APP_ASSET_BASE_URL = 'https://api.guizhouzhongying.com'
   pnpm --filter @pinjie/miniapp build:weapp
   ```

   编译完成后如需回到本地联调，请新开一个 PowerShell 窗口再运行 `dev:weapp`，避免 `NODE_ENV=production` 残留。

2. 打开微信开发者工具，右上角「详情 -> 本地设置」取消勾选“不校验合法域名”，核验线上接口与图片展示正常。
3. 点击「上传」，在微信公众平台设为体验版真机验证后提交审核发布。

---

## 常用按需附加项

### 1. OpenResty 静态图片不可变强缓存配置（仅需配一次）

在 1Panel 的 `admin.guizhouzhongying.com` 与 `api.guizhouzhongying.com` 两个网站的配置文件中，确认 `location ^~ /static/uploads/` 与 `location ^~ /static/settings/` 包含以下响应头并保存：

```nginx
add_header Cache-Control "public, max-age=31536000, immutable" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
```

### 2. 存量历史图片离线压缩为 WebP 并补齐 480px 缩略图

旧图不处理也可直接兼容读取。如需批量瘦身已有历史图，请先备份数据库和 `/srv/guizhouzhongying/storage/`，再在 `guizhouzhongying-backend` 容器终端中执行：

```bash
# 先只读预演，核对预计体积变化
/app/.venv/bin/python -m scripts.optimize_legacy_image_assets --dry-run --confirm-database guizhouzhongying_prod --limit 100

# 确认无误后再正式改写
/app/.venv/bin/python -m scripts.optimize_legacy_image_assets --apply --confirm-database guizhouzhongying_prod --limit 100
```
