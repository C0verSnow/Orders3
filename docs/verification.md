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

## PR #34 使用手册与首次登录竞态

- 新增 `使用手册.md` 并核对实际路径、优先级、打包文件、Infisical 与 Docker 宿主机脚本；Compose/systemd 为自建示例，未实机执行。
- 文档提交 `2ecd92f` 的远端安装包检查成功，但浏览器首次登录超时。随后用真实生产服务的登录 POST 加延迟匿名 GET 重现：[`1e739e0` / 39200989809](https://github.com/C0verSnow/Orders3/actions/runs/39200989809) 明确失败于 `late anonymous session cannot undo login`。
- 修复登录成功前取消旧会话查询，向会话 GET 传递 AbortSignal；相同断言保留，修复后的完整远端结果在 PR 说明更新。未进行本地编译、构建或测试。
- 修复提交 `6cbcf35` 的[完整远端 CI 39201168155](https://github.com/C0verSnow/Orders3/actions/runs/39201168155) 全部成功：相同登录回归、六宽度双主题与草稿/状态错误场景、业务/安全/类型/构建、Windows EXE、AMD64/ARM64 DEB 和双架构原生容器。发布、镜像推送合并与生产部署跳过。后续只补验证记录与 tasklist，使用 `[skip ci]`，运行代码与已通过提交相同。


## PR #34 显示、计算和下单精度分离

- 按最新评论及用户确认，开仓与保护价均按 Supabase `price_round` 用 ROUND_HALF_EVEN 对齐，再独立校验 Gate 实际步长、整数张数和上下限。两位 HALF_UP 仅用于展示，不再阻止合法高精度下单。缺失、无效或同合约冲突的 Supabase 步长仍整批拦截，不用 Gate 步长替代。
- 来源原始价格/数量与 Supabase 步长独立持久化，Gate 规则刷新不覆盖它。追踪单 raw 字段供匹配，持仓计算值入库保留高精度，盈亏仍先汇总原始值再展示。保护公式的循环小数保留内部 Decimal 至最终对齐。
- 最终源码 `5612af595204db01dfdf1f1308256bf728183dd0` 的[完整远端 CI 39219606380](https://github.com/C0verSnow/Orders3/actions/runs/39219606380) 全部成功：53 项 Node 回归（0 失败）、19 项宿主机回归、静态语法/类型、构建和运行冒烟、六宽度双主题浏览器、Windows EXE、Linux AMD64/ARM64 DEB 安装启动和两架构原生容器。
- 新回归覆盖 `100.005` 精确下单、`0.005` 整数倍步长、HALF_EVEN 居中取偶、低价及零对齐、缺失/冲突/无效步长、Gate 不兼容、整批无 POST、原始存储、重复匹配、保护价高精度及来源数字字段完整刷新。真实服务读取预置 SQLite，浏览器核查来源、追踪单和持仓均显示两位；已下载查看 `browser-evidence/precision-positions.png`，确认持仓 `2.00`、均价 `100.01`、标记价 `100.12` 和保护价 `101.01`。
- README、使用手册、报告中的现行规则已更新；本地文档围栏、引用和 git diff --check 通过。没有本地编译、构建、类型检查、测试或服务启动，没有连接真实交易账户。Release、镜像 manifest 发布及生产部署均跳过，未移动 latest。
- 保护任务只读取最近保存来源快照中对应合约的步长；升级前备份，旧缓存需成功刷新来源，无对应步长则保护批次停止并保留已有保护。旧数据已舍入且无 raw 副本的精度不可恢复。后续交付提交只更新本验证文档和 tasklist，标记 skip ci，运行代码与上述成功提交一致。PR 等待用户 review，未合并；仓库没有待关闭的开放 issue。


## PR #34 最新报错与 Release 附件版本

本轮最终源码 `482ff26e2386d075ef55573eb568f71fee1f0c84` 已通过 [远端 CI 39224288259](https://github.com/C0verSnow/Orders3/actions/runs/39224288259)：56 项 Node 回归、20 项宿主机/发布脚本回归、静态/类型/构建、HTTP 运行检查、六宽度双主题浏览器、Windows EXE、AMD64/ARM64 DEB 安装启动和两种原生容器全部成功。后续仅补本文及 tasklist，标记 skip ci。

- 最新报错评论中的旧“两位小数会改变激活价格”校验已在 `fa93560` 移除。新增完整来源刷新用例覆盖 `100.005` 和 `0.005`：真正 Gate 步长冲突时保存来源并暂停、无 POST 和待核对意图；改为合法步长后重刷完成、清除错误，POST 保留原价与整数数量。此前 `6daeec0` 的远端已通过同组断言，本轮再次通过。没有用户运行版本信息，因此不能断言现场已升级或现场报错已消失。
- 用户确认新 Release 的五个附件统一后缀 `v-版本`。正式标签 `v1.2.3` 使用 `v-1.2.3`；标签预发布保留 `rc`；自动预发布使用 `v-1.0.0-build.运行ID.重试号`。实际 DEB 验证日志包含 `orders3_v-1.0.0-build.39224288259.1_amd64.deb`，两种架构和 Windows 按新名安装或启动通过。
- 新增回归直接执行 workflow 的发布 shell，模拟 GitHub 上传，验证正式/rc/自动预发布的五个附件名、精确上传清单、SHA256 校验和镜像说明内容；故意放入旧文件，确认不会混入新发布。Release 真正上传、GHCR 发布与生产部署在本轮按条件跳过，不能把模拟上传当成实际发布。
- [39224177924](https://github.com/C0verSnow/Orders3/actions/runs/39224177924) 中新 rc 用例明确复现旧 Bash `~` 替换展开为运行用户目录的问题；`482ff26` 保留相同预期 `1.2.3~rc.1` 并改为字面波浪号后通过。
- README、使用手册和部署说明已同步新文件名及旧包排查。历史 Release 附件保留原名，不自动更名。DEB 内部版本与安装命令不变。
- issue #35 已在 PR 关联：默认分支、latest 和部署条件的修复随 PR 一起等待 review，main 仍保留用户要求的旧部署快照；不提前宣称现有 latest 已更新。
- 本地仅阅读、Python AST 静态语法与 `git diff --check`，没有本地编译、构建、类型检查、测试或服务启动，没有连接真实交易账户。PR 不合并，等待用户 review。


## PR #34 Supabase 实际步长列修复

- 用户确认真实列为 Supabase `public.orders.order_price_round`（下划线）。旧代码读取不存在的 `price_round`，导致合法来源提示“缺少有效 Supabase price_round”；同时 Gate 刷新会写入同名 `order_price_round`，不能在其后才读取来源步长。
- 在 Supabase 入口将 `orders.order_price_round` 复制到独立内部 `price_round`，随后 Gate 的 `order_price_round` 仅用于独立校验。远端不存在或无效的真实列不会回退到旧 `price_round` 列或 Gate 步长；两列同时存在时真实列优先。无需改远端表结构；旧来源快照需要更新程序后刷新，不靠重启自动补值。
- 先提交回归 `22045a5`，在 [远端39231136215](https://github.com/C0verSnow/Orders3/actions/runs/39231136215/job/117989096636) 的 `npm test` 复现相同缺失步长报错，且验证旧列误用会造成非零 POST。该轮检查任务明确失败，其余任务随后被新提交取消，不作为成功结果。
- 修复源码 `94ef9b70fcc0a00631d3daef6dfa6c3a02668145` 的 [PR 远端39231260371](https://github.com/C0verSnow/Orders3/actions/runs/39231260371) 与 [分支远端39231254609](https://github.com/C0verSnow/Orders3/actions/runs/39231254609) 均全部成功：58 项 Node 回归、20 项宿主机/发布脚本回归、静态/类型/构建、HTTP 运行检查、六宽度双主题浏览器、Windows EXE、AMD64/ARM64 DEB 安装启动，以及两架构原生容器。
- 同组断言未放宽：数字与文本来源步长保留、Gate 同名字段隔离、ETH_USDT 开仓 `100.125` 和保护 `101.125` 使用来源 `0.005`（Gate 为 `0.0001`）、原始数量为整数、错误旧列优先级、缺失/空值/无效/非正来源步长零 POST、原有高精度与冲突恢复均通过。README、手册、保护单说明和报告已同步真实列名及刷新步骤。
- 本地仅阅读、文档及 git 差异检查，未编译、构建、类型检查、运行测试或启动服务。未连接真实交易账户，未发布 Release/GHCR、未生产部署、未移动 latest。PR 保持未合并，等待用户 review；issue #35 继续关联等待合并生效。后续记录提交仅改本文与 tasklist，标记 skip ci，运行代码与上述成功源码一致。

## 最新评论：取消自动保护与详情弹窗

- 用户明确取消整个自动保护单功能，未采用 `/trail/update`。启动、每分钟任务、手动持仓刷新仅同步真实数据；已有保护单仍可查看，开仓路径排除所有 reduce_only 订单。
- 远端复现：提交 dd8e789 的 [Actions 39237466286](https://github.com/C0verSnow/Orders3/actions/runs/39237466286) 在新回归中因 SNDK 缺少 Supabase 步长失败；说明旧持仓刷新确实依赖来源缓存。改后同组断言要求来源为空、重复刷新、保护单状态 1/2/5 均零交易 POST、无保护价及无待核对写入。
- 弹窗使用中文业务信息及原始值分组；普通金额显示两位，原始值和步长保留完整精度。远端浏览器覆盖桌面/手机、浅色/深色、Escape 和按钮关闭及焦点返回。
- 未进行本地编译、构建或测试；最终远端结果见下方。不访问真实交易账户，不发布、不部署，不合并 PR。前述保护公式验证属于历史行为。

- 最终源码 `b97d39c` 的 [PR Actions 39238159543](https://github.com/C0verSnow/Orders3/actions/runs/39238159543) 全部成功：58 项 Node、20 项宿主机/发布脚本、静态/类型/构建、HTTP 运行、六种宽度双主题及四组详情弹窗浏览器回归、Windows EXE、AMD64/ARM64 DEB 安装启动、两种架构原生容器。发布、镜像上传和生产部署跳过。
- 已下载并查看 `browser-evidence` 中的桌面浅色和手机深色详情截图，修正样式重置引起的左上贴边；新增断言验证居中且不溢出、原始 `100.005`、来源 `0.001` 与 Gate `0.0001` 保留、Escape/按钮/遮罩关闭及焦点返回。
- 最终仅补文档和 tasklist 的 skip-ci 提交，运行代码与上述成功源码一致；没有本地编译或测试，没有访问真实交易账户，没有合并、发布或部署。
