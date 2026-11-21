# guizhouzhongying

> 标准电商与多级分销全栈商城平台 | FastAPI + Ant Design Pro + pnpm + Turborepo

`guizhouzhongying` 是独立维护、独立发布的商城仓库，中文名称为“贵州众赢”。项目继承来源商城的 Backend、Admin 与微信小程序源码，后续数据库、微信、支付、发布和部署资源均使用本项目自己的配置。

## 当前边界

- `apps/web` 是冻结保留的历史骨架，禁止开发、启动、构建、测试、发布和部署。
- 本地服务只允许 Backend 使用 18168 端口、Admin 使用 3001 端口。禁止监听或暴露 3000 及其他 Web 端口。
- Backend 已有商品、库存、购物车、订单、支付售后及会员分销源码。当前新购仅支持同一商家的到店订单，支持 SKU 积分抵扣、整单核销、未核销整单退款及商家全额应收。已记录的本机开发库版本为 `20261121_01`，六项到店权限已同步。测试库、生产及真实资金验收仍需专项验证。见[到店业务手册](docs/operations/local-commerce.md)。
- Admin 已接入商品、订单履约、退款审核、支付对账、会员分销及钱包运营，并提供商家管理、物业授权、应收和结算登记。动态交互验收见各实施计划。
- 小程序源码已覆盖公开浏览、微信身份、本人交易、账户与资金查询、物业发分及商家核销。微信登录与支付默认关闭，启用前需完成本项目的平台配置与联调。见[小程序 PRD](docs/MINIAPP_PRD.md)及[开发手册](docs/operations/local-dev-environment.md)。
- 当前已具备认证、用户、管理员、RBAC、文件资产、系统设置、审计、健康检查与 OpenAPI 契约等基础能力。

## 技术栈

- **Backend**：FastAPI、SQLAlchemy 2 async、PostgreSQL、Redis、Alembic、uv
- **Admin**：Ant Design Pro v6、Umi Max、React、TypeScript、ProComponents、TanStack Query
- **用户端**：微信小程序，采用 Taro React、NutUI React-Taro、TanStack Query、TypeScript 与 Sass；精确版本与实际工程状态见[工程标准](docs/architecture/miniapp-engineering-standard.md)
- **共享包**：OpenAPI 生成的 TypeScript API Client、ESLint 配置、TypeScript 配置
- **部署**：当前 1Panel 源码方案使用独立 Backend Python 运行环境和 OpenResty 托管的 Admin 静态站点。仓库同时保留独立镜像及 GitHub Actions、CNB、TCR 发布流程。

## 项目结构

```text
apps/
  backend/              FastAPI 后端
  admin/                Ant Design Pro 管理后台
  miniapp/              微信小程序商城、交易与到店角色入口
  web/                  冻结保留的历史骨架

packages/
  api-client/           自动生成的 TypeScript SDK
  eslint-config/        共享 ESLint 配置
  typescript-config/    共享 TypeScript 配置

docs/                   项目文档
plans/                  全栈实施计划及永久登记
```

## 开发入口

先阅读 [项目索引](PROJECT_INDEX.md) 确认当前阶段和活动计划。环境搭建及 Backend 启动见[本地开发环境手册](docs/operations/local-dev-environment.md)，环境变量分层见[环境变量与 Backend 本地运行手册](docs/operations/environment-variables-and-backend-local-run.md)。

- 根 `pnpm dev` 仅启动 Admin。
- Backend、Admin 与 Miniapp 分别遵守其目录中的 `AGENTS.md`。
- 公开 API 变化依次执行 Backend 实现、导出 `openapi.json`、运行 `pnpm generate-api`、适配受影响的 Admin 和小程序消费者。
- 在仓库根目录运行 `pnpm --filter @pinjie/miniapp dev:weapp` 持续编译小程序，按[开发手册](docs/operations/local-dev-environment.md#终端三小程序-watch-与微信开发者工具)在微信开发者工具中导入 `apps/miniapp`。
- 新增跨端能力需创建一份全栈计划，并登记到 [plans/INDEX.md](plans/INDEX.md)。

## 项目资料

- [产品需求基线](docs/PROJECT_REQUIREMENTS.md)：目标、范围、验收边界
- [微信小程序 PRD](docs/MINIAPP_PRD.md)：小程序用户流程、需求编号、交付分组和验收条件
- [小程序架构文档](docs/architecture/miniapp-architecture.md)：目标目录、Feature 分层、请求链路和状态归属
- [小程序工程标准](docs/architecture/miniapp-engineering-standard.md)：已定版技术基线、初始化配置、内容与验证要求
- [小程序 UI 规范](docs/architecture/miniapp-ui-standard.md)：设计 tokens、组件、页面布局与交互状态
- [文档索引](docs/README.md)：架构、运维、ADR 与业务设计入口
- [计划规范](plans/README.md)：计划创建、更新与保护规则
- [变更记录](CHANGELOG.md)：已交付能力与治理变化

## 工程原则

- Backend、Admin 和共享包只能通过明确公开入口协作。
- 失败必须明确传播，禁止假成功、弱默认值和静默降级。
- 根 `openapi.json` 是唯一机器契约，`packages/api-client/src/` 只能由生成链更新。
- 生产按 [1Panel 源码部署手册](docs/operations/1panel-source-deployment.md) 固定源码提交、Python 运行镜像 digest 和 Admin 静态产物。发布、部署和回滚需要单独授权。
