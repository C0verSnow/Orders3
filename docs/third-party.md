# 依赖

React / React DOM、Vite、TypeScript、Tailwind、TanStack Query / Table、Lucide：前端与工程化。

Fastify、Zod：HTTP 与运行时校验。Decimal.js：确定性十进制计算。lossless-json：远端数字原文。proper-lockfile：数据目录租约。Node 内置 crypto/sqlite：HMAC-SHA512、哈希与持久化。

esbuild：远端打包服务端与内嵌前端资源。postject：Node SEA 二进制注入。Playwright：远端浏览器回归与截图。所有 npm 版本由根 package-lock.json 固定。Node 运行时固定 24.22.1；Qt、CMake、Python 不参与当前应用构建，已有部署脚本的纯 Python 回归仅在 CI 执行。

远端跨平台截图比较使用 Pillow 11.3.0 和 pixelmatch 0.4.0；后者仅用于边缘抗锯齿识别，原始像素差异继续保留。它们不进入应用运行时。Electron 45.0.0 内置 Node 与业务服务独立，尚待上游安全修复，详见 [issue #41](issue-41.md)。
