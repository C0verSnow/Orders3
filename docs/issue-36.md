# Issue #36：设置导航、按钮反馈与跨平台渐隐

需求：[Issue #36](https://github.com/C0verSnow/Orders3/issues/36)；交付：[PR #37](https://github.com/C0verSnow/Orders3/pull/37)。

## 改动内容

系统设置首页展示外观设置、连接与存储、预测抓取、自动开仓四个入口，统一为高 96px、间隔 16px、圆角 12px 的全宽卡片。首页隐藏详细表单；点击进入对应配置，返回时恢复四卡片概览。四个表单保持挂载，切换模块和语言不丢草稿；成功保存仍按服务端返回值更新。没有新增设置字段、改变配置含义或交易策略。

共享 Button 负责悬停上移 2px、按压缩放 94%、180ms 缓动、加载和结果反馈。异步按钮预留默认、加载、成功、失败四种状态和两种语言的尺寸；加载中禁用，真实请求成功后显示勾选和成功文案，1.8 秒后恢复原标签；失败显示按钮内部状态并保留可访问错误原因。保存和刷新不再额外生成独立成功提示。主题切换仍即时保存，支持系统减少动态效果。

ScrollFade 的底部 48px 层使用透明到当前主题表格表面的渐变；仅有尚未展示的内容时显示。它按真实 clientWidth/clientHeight 避开平台滚动条，保持表头和详情操作入口可用，保留原来的逐行淡出。

## 远端验收

用户于 2026-10-20 明确要求跳过手机和平板检查；当前验收只保留桌面，不能声称已验收手机或平板。此前桌面 1440px 的 96 个比较区域已在原始 2% 容差下通过；最新桌面矩阵须另跑完整 CI。

- `scripts/check-browser.mjs` 保留三种桌面宽度、精度、详情、动效、圆形揭示、草稿及故障注入回归，适配新二级设置导航。
- `scripts/check-settings.mjs` 覆盖 1440px 桌面视口、中英文、明暗主题；核对四卡片尺寸及间距、首页无可见表单、二级导航、主题选择、三个配置表单真实 POST/GET 保存、禁用自动开仓、延迟响应、阻止重复提交、尺寸稳定、成功恢复、失败说明，以及刷新按钮的悬停和按压。
- `scripts/capture-platform.mjs` 在 Windows 启动实际打包 EXE，在 Linux 启动实际 Docker 镜像。SQLite 提前写入一致的 0/2/45 条固定数据，全程 cached 模式，不访问真实交易账户。使用锁文件固定的同版 Chromium、同一份固定提交的 Noto Sans SC 字体、UTC、缩放 1、同一视口和主题语言。
- 每个平台包含 3 种数据量 × 2 种桌面视口（1440/1280px） × 2 种语言 × 2 种主题 × 4 个滚动位置，共 96 场景。每个场景保存全表视口、底部 48px 原始 PNG，以及环境、滚动几何和遮罩开关清单。
- `scripts/compare-platforms.py` 先要求浏览器、字体哈希、源版本、缩放、时区、场景及几何一致，再比较 192 个区域，保存差异 PNG、JSON 和 Markdown 报告。精确差异统计所有非零像素；容差统计单通道差异超过 32/255 的像素，最多允许 2%。阈值预先写入脚本，不按观测结果调整。
- 原图产物：`platform-windows`、`platform-docker`；差异报告：`platform-visual-comparison`；功能截图：`browser-evidence`。像素完全相同和容差通过分别报告；不能把容差通过写成完全相同。
- 发布 manifest 依赖 `visual-comparison`，失败时阻止后续发布。feature 分支不会自动发布或部署生产。

本地仅阅读源码和检查差异，没有编译、构建、运行测试或启动程序。首轮 CI 仍在执行；以最终远端运行结果为准。


## 源码定位

以下位置以源码提交 `954c4b309d696c6337128bc3c3c583b5f489477b` 为准。

| 内容 | 文件与行号 |
|---|---|
| 表格滚动容器与逐行渐隐 | [apps/web/src/components/motion.tsx:285](https://github.com/C0verSnow/Orders3/blob/954c4b309d696c6337128bc3c3c583b5f489477b/apps/web/src/components/motion.tsx#L285) |
| 滚动条边界与渐隐层定位 | [apps/web/src/components/motion.tsx:310](https://github.com/C0verSnow/Orders3/blob/954c4b309d696c6337128bc3c3c583b5f489477b/apps/web/src/components/motion.tsx#L310) |
| 渐隐层样式 | [apps/web/src/tailwind.css:44](https://github.com/C0verSnow/Orders3/blob/954c4b309d696c6337128bc3c3c583b5f489477b/apps/web/src/tailwind.css#L44) |
| 表格组件与详情按钮层级 | [apps/web/src/components/data-table.tsx:18](https://github.com/C0verSnow/Orders3/blob/954c4b309d696c6337128bc3c3c583b5f489477b/apps/web/src/components/data-table.tsx#L18) |
| 共享按钮与状态恢复 | [apps/web/src/components/ui.tsx:14](https://github.com/C0verSnow/Orders3/blob/954c4b309d696c6337128bc3c3c583b5f489477b/apps/web/src/components/ui.tsx#L14) |
| 刷新请求结果与失败反馈 | [apps/web/src/app.tsx:322](https://github.com/C0verSnow/Orders3/blob/954c4b309d696c6337128bc3c3c583b5f489477b/apps/web/src/app.tsx#L322) |
| 统一刷新按钮 | [apps/web/src/app.tsx:531](https://github.com/C0verSnow/Orders3/blob/954c4b309d696c6337128bc3c3c583b5f489477b/apps/web/src/app.tsx#L531) |
| 设置四模块与两级导航 | [apps/web/src/pages/settings.tsx:13](https://github.com/C0verSnow/Orders3/blob/954c4b309d696c6337128bc3c3c583b5f489477b/apps/web/src/pages/settings.tsx#L13) |
| 保存程序配置 | [apps/web/src/pages/settings.tsx:182](https://github.com/C0verSnow/Orders3/blob/954c4b309d696c6337128bc3c3c583b5f489477b/apps/web/src/pages/settings.tsx#L182) |
| 定时配置共用表单 | [apps/web/src/pages/settings.tsx:235](https://github.com/C0verSnow/Orders3/blob/954c4b309d696c6337128bc3c3c583b5f489477b/apps/web/src/pages/settings.tsx#L235) |
| 中英文新增文案 | [apps/web/src/messages.ts:3](https://github.com/C0verSnow/Orders3/blob/954c4b309d696c6337128bc3c3c583b5f489477b/apps/web/src/messages.ts#L3) |
| 按钮与卡片样式 | [apps/web/src/tailwind.css:31](https://github.com/C0verSnow/Orders3/blob/954c4b309d696c6337128bc3c3c583b5f489477b/apps/web/src/tailwind.css#L31) |
| 旧浏览器回归与导航适配 | [scripts/check-browser.mjs:1](https://github.com/C0verSnow/Orders3/blob/954c4b309d696c6337128bc3c3c583b5f489477b/scripts/check-browser.mjs#L1) |
| 设置与按钮状态验收 | [scripts/check-settings.mjs:3](https://github.com/C0verSnow/Orders3/blob/954c4b309d696c6337128bc3c3c583b5f489477b/scripts/check-settings.mjs#L3) |
| 实际 EXE/Docker 截图 | [scripts/capture-platform.mjs:10](https://github.com/C0verSnow/Orders3/blob/954c4b309d696c6337128bc3c3c583b5f489477b/scripts/capture-platform.mjs#L10) |
| 像素比较和预设容差 | [scripts/compare-platforms.py:12](https://github.com/C0verSnow/Orders3/blob/954c4b309d696c6337128bc3c3c583b5f489477b/scripts/compare-platforms.py#L12) |
| Windows 实际 EXE 截图步骤 | [.github/workflows/build.yml:139](https://github.com/C0verSnow/Orders3/blob/954c4b309d696c6337128bc3c3c583b5f489477b/.github/workflows/build.yml#L139) |
| Docker 实际截图步骤 | [.github/workflows/build.yml:229](https://github.com/C0verSnow/Orders3/blob/954c4b309d696c6337128bc3c3c583b5f489477b/.github/workflows/build.yml#L229) |
| 跨平台比较与产物上传 | [.github/workflows/build.yml:275](https://github.com/C0verSnow/Orders3/blob/954c4b309d696c6337128bc3c3c583b5f489477b/.github/workflows/build.yml#L275) |
