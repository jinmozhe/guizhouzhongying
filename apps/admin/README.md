# apps/admin

B 端管理后台，基于官方 Ant Design Pro v6 的 Umi Max 应用架构。

## 技术栈

- @umijs/max 4.7.x + React 19 + TypeScript
- Ant Design 6.x + @ant-design/pro-components 3.x + @ant-design/icons 6.x
- ProLayout、Umi 配置式路由、Access 权限和运行时 `app.tsx`
- TanStack Query v5，Browser Cookie 认证由项目 HTTP 层维护
- @pinjie/api-client（自动生成 DTO）+ 项目安全 HTTP 管道

## 本地启动

```powershell
pnpm install
pnpm --filter @pinjie/admin dev   # http://localhost:3001
```

开发服务器会把同域 `/api/v1` 请求代理到 Backend。生产构建输出 `dist`，1Panel 源码部署由 OpenResty 托管并反代同域 API。见[部署手册](../../docs/operations/1panel-source-deployment.md)。

## 当前范围

当前 Admin 已接入登录、Cookie 会话、RBAC 权限导航、用户、管理员、角色权限、安全日志和系统状态页面。`@pinjie/api-client` 提供 OpenAPI 生成类型，`src/lib/api/http.ts` 统一承担 Cookie、CSRF、单飞 Refresh 和错误解包；物理硬删除共用标准警告弹窗，所有管理操作继续保留服务端最终授权、审计和请求追踪。

商城运营包括商品、SKU、库存、履约售后、支付对账、会员分销和历史提现处理。“到店消费”提供商家、物业授权和商家结算页面。线下付款后的登记和纠错由服务端校验结算状态及权限。见[到店业务手册](../../docs/operations/local-commerce.md)。

路由、运行时、请求、状态、UI 组件和依赖准入的开发边界见 [Admin 工程实施标准](../../docs/architecture/admin-engineering-standard.md)。

## 质量检查

```powershell
pnpm --filter @pinjie/admin lint
pnpm --filter @pinjie/admin typecheck
```

Vitest 和生产构建属于单独授权的验证项。

```powershell
pnpm --filter @pinjie/admin test
pnpm --filter @pinjie/admin build
```

Umi 运行目录、端口、生成缓存和浏览器验证边界见[Admin 本地运行与验证排障手册](../../docs/operations/admin-local-development-and-validation-troubleshooting.md)。
