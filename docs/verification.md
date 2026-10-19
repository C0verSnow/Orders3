# 验证记录

## 分类

| 检查 | 当前证据 |
| --- | --- |
| 旧源码与 Node 业务对照 | 已完成代码审查，见 business-parity.md |
| 差异与发布依赖 | 已完成 git diff --check；当前入口无 Qt/CMake |
| 本地编译、构建、类型检查 | 尚未执行，用户禁止本地编译验证 |
| 回归测试、浏览器、发布包 | 源码提交 059cebb 的远端 CI 已通过；37 项 Node 回归、13 项宿主机脚本回归、六种宽度双主题浏览器检查和三种安装包启动检查均成功 |
| Release / Container Package | 已核实预发布 build-39141544883-1 的五个实际资产，以及 GHCR manifest 中的 linux/amd64、linux/arm64 |
| 实盘/真实手机 | 需要后续受控运行与真机验证；无实盘试单 |

## 可追溯的远端证据

- 验证源码：`059cebb73dda6e492fd7c9a33750d4121c8b5070`；本次后续提交只补充文档和任务记录。
- [PR 检查全部成功](https://github.com/C0verSnow/Orders3/actions/runs/39141547398)。
- [预发布完整流程成功](https://github.com/C0verSnow/Orders3/actions/runs/39141544883)：类型检查、业务与安全回归、React 构建、真实 HTTP 服务、浏览器、Windows exe、两种 deb 和两个原生容器均通过。预发布按设计跳过生产 SSH 部署。
- [可下载的预发布](https://github.com/C0verSnow/Orders3/releases/tag/build-39141544883-1)：Windows x64 exe、Linux AMD64 deb、Linux ARM64 deb、`SHA256SUMS.txt`、`container-image.txt` 均实际存在。
- 镜像：`ghcr.io/c0versnow/orders3@sha256:4efd669cdebba5cee7b3e7cf5e92fab8f40631bb4028e19cf43275f6c7ab81b6`。已直接读取 Registry manifest，确认同时包含 linux/amd64 与 linux/arm64；额外的 unknown 平台条目为构建证明。
- 实盘下单、真实手机触感和生产 SSH 部署不在上述通过结论内。本地没有执行编译、构建、类型检查或触发编译的测试。

## UI 静态审查

| Before | After | Why |
| --- | --- | --- |
| 原生 Web 与 Qt 桥接 | React 组件与受保护 API | 页面和交易职责分开 |
| 原有深浅主题覆盖分散 | 全局 CSS Tokens，持久化 light/dark/system | 统一表单、弹窗、表格和状态 |
| 窄屏表格信息拥挤 | 抽屉导航、布局重组、表格横滑、完整详情 | 保留业务字段和操作入口 |
| 页面可能直接依赖旧进度表现 | 真实请求 active 与任务事件；断线明确提示缓存 | 避免把动画误认为成交完成 |
| 交易刷新反馈较弱 | 刷新前说明真实交易影响，服务端结果反馈 | 用户知道刷新会操作真实账户 |

使用 apple-design、emil-design-eng、mobile-native 和 vercel:react-best-practices。按钮按下反馈使用 transform；仅能力匹配设备启用 hover；reduced-motion 关闭位移和旋转；输入移动端 16px，使用 dvh 与 safe-area，不禁止页面缩放。静态审查不能证明真机触感或所有 WCAG 2.2 AA 要求都已验收。

## Issue #33 审查报告交付验证

- 审查源码基线：`358df625c0390e29b47900df523e681b4cb4cabe`。本次仅新增 `检查报告.md`、README 导航和过程记录，不修改运行代码。
- 本地仅做文档引用、代码位置和差异检查；没有执行构建、类型检查、测试或服务启动，没有连接真实交易账户。
- [PR #34](https://github.com/C0verSnow/Orders3/pull/34) 的首轮完整远端验证已成功：[Actions 39183743439](https://github.com/C0verSnow/Orders3/actions/runs/39183743439)，对应报告提交 `27db5b8e43d4dbfdb479843f3ccd849ac1fa3c9d`。37 项 Node 回归（0 失败）、13 项宿主机脚本回归、静态语法/类型检查、React/Node 构建、六种宽度双主题浏览器检查、Windows exe、Linux AMD64/ARM64 deb 安装启动、双架构原生容器检查全部成功。
- feature 分支的 container manifest 发布、Release 和生产 SSH 部署按工作流条件跳过；不得把跳过视为部署问题 F12 已解决。后续提交只补本节与任务记录，最新提交检查以 [PR 检查页](https://github.com/C0verSnow/Orders3/pull/34/checks) 为准。
- issue #33 的审查报告已交付并关闭；PR #34 已转为可审阅，尚未合并。
- 现有回归没有覆盖报告列出的全部问题；CI 通过也不能当作这些问题已修复。

## PR #34 评论修复与 main 回退

main 已通过67502aa（skip ci）恢复旧部署分支f8d1a45的代码快照，唯一保留差异是带Unix时间戳的tasklist。PR已同步回退后的main基线，包含完整Node/React迁移和报告问题处理，未合并。

首轮037868d远端的类型检查、全部Node回归、宿主机回归及三种安装包启动已通过；因同步main基线而取消旧浏览器/容器流程，不能把该轮称作最终全绿。最终结果以[PR检查页](https://github.com/C0verSnow/Orders3/pull/34/checks)为准。新增回归覆盖配置路径、跨月Cron、空来源实时单、迟到成交/裁剪去重、忙时配置更新、保护单保留、原凭证核查、独立时间戳、正文解析失败、表单草稿、状态读取失败、digest传递、env-file和默认分支/latest条件。

本地只做阅读、git diff --check和shell静态语法检查，没有本地编译、构建、测试或服务启动。未连接真实交易账户，未更新现有latest、未生产部署。F06采用保留旧保护并人工替换；原子自动替换未验收。

最终源码 `1b58bd61aceae4a5b851bfb46023c9328d3ce0b1` 的[完整远端验证39195339290](https://github.com/C0verSnow/Orders3/actions/runs/39195339290)已全部成功：47项Node回归、19项宿主机回归、静态/类型、React/Node构建、六宽度双主题浏览器及新增焦点草稿和状态错误检查、Windows exe、Linux AMD64/ARM64 deb实际安装启动、双架构原生容器与随机端口宿主机启动均通过。已下载查看状态读取失败页和桌面设置页截图。Release、manifest发布与SSH生产部署按feature条件跳过，未更新latest。后续交付提交只补本文与tasklist，最终提交状态仍以PR检查页为准。
