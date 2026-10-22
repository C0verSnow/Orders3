# 架构

`apps/web` 为 React / TypeScript / Vite 应用。TanStack Query 管理服务端快照和失败重读，Table 提供筛选/排序/分页，Lucide 提供图标。Tailwind v4 与 CSS Variables 管理双主题。只需要按钮反馈和导航移动，选择 CSS transform/opacity、系统 reduced-motion，无须再引入 Motion 运行依赖。

`apps/server` 为 Node 24 / TypeScript / Fastify。API 层调用 Dashboard；交易、历史同步、调度、配置、凭证和存储分别独立。网络全部异步，交易任务串行，SQLite 同步事务不跨 await。源抓取可与 Gate 网络读取并行，进入交易时等待共享 Gate 锁；Gate 忙时跳过周期检查。进程持有 proper-lockfile 数据目录租约，第二个进程拒绝启动。

`packages/shared` 提供前后端类型；`packages/decimal` 提供 Decimal 精度和 Gate 约束边界。lossless-json 将远端数字字面量解析为原文，时间/状态显式检查安全整数。源 ID、成交 ID、金额与数量不经过二进制浮点运算。

`scripts/build.mjs` 可独立构建 React（build:web）和 Node（build:server 读取已构建 dist/web）。生产 Node CJS 内嵌白名单 React 资源；没有运行时 npm、源码、配置文件下载或本地文件夹静态开放。Node SEA 用同一原生 Node 二进制生成 blob 并注入，不使用原生 addon 或旧后端。Docker 只需 Node 与 server.cjs。

## API

| 路径 | 行为 |
| --- | --- |
| GET /health | 无敏感信息的就绪检查 |
| GET /api/data；POST /api/refresh | 来源缓存；只读抓取并保存来源 |
| GET /api/orders；POST /api/orders/refresh | 跟踪单/持仓缓存；只读同步持仓与订单 |
| GET /api/activity | 最近 64 个真实请求/任务事件；600 ms 页面轮询 |
| GET/POST /api/settings | 脱敏设置、保存设置并后台刷新 Infisical |
| GET/POST /api/schedule | 五段 Cron 与下一次本地时间 |
| GET /api/history | 最近 100 条真实入仓事件 |
| GET /api/status | 数据库阻断、未知交易意图 |
| POST /api/intents/resolve | 原凭证指纹匹配、人工依据和实时订单/持仓/成交读取成功后串行解除，不重发请求 |
| GET /api/download | VACUUM INTO 独立一致 SQLite 快照 |

按 issue #39 取消工作台身份认证，无令牌、会话 Cookie 或登录接口。写请求要求受信任 Origin，所有非 health 请求检查 Host，显式外来 Origin 拒绝。这些校验用于阻止跨站请求和 DNS 重绑定，不提供用户身份认证。无 CORS 通配符，不从任意路径读取资源。响应禁缓存、nosniff、严格 CSP，禁止第三方脚本、frame 和外部表单。

遥测不伪造交易完成；只有真实请求开始才计 active。失败显示旧缓存与错误。UI 不乐观地把订单标成成交。交易写入超时必须先查交易所，不能自动重试。

## 桌面容器

`desktop/main.cjs` 管理 Electron 45 窗口，`scripts/package-desktop.mjs` 在远端用固定版本 electron-builder 生成 Windows 便携 EXE 和 Debian 包。Electron 只启动一份原生 Node SEA，监听 127.0.0.1 并等待 health 后加载 React；不在 Electron 内运行 SQLite 或调度器。窗口使用沙箱、上下文隔离、禁用 Node、拒绝弹窗和跨来源导航。窗口关闭时结束服务 stdin 管道，服务按原有退出顺序停止任务、HTTP、数据库并释放锁；父进程崩溃也会关闭管道。Linux `/usr/bin/orders3` 按命令参数选择窗口或原无图形服务；Docker 仍只包含服务。
