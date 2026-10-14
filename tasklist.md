# 本文档为4象限的任务清单，全文书写大白话。

## 想做：
- 2026-10-14：完成 issue #10，保存 Supabase 配置后后台重新读取 Gate 密钥，失败每隔 5 秒重试，交给远端 CI 验证。
- 2026-10-14：完成当前仓库 issue #8，新增 Supabase Gate 备用密钥和远端 docker.md 地址记录，提交 PR，通过远端 CI 后关闭 issue。

- 2026-10-13：完成当前仓库 issue #6：只取消状态 1 的旧订单，状态 2 保留；更新说明和回归用例，提交 PR，通过远端 CI 后关闭 issue。
- 2026-10-11：完成 C0verSnow/Orders3 的 #1（Tailscale + SSH 部署）和 #2（空订单清理）。
- 完成 issue #8：平仓 value 改为 size × entry_price，并保留正负号。
- 完成 issue #6：数据库主文件合计 450 MB、请求日志合计 50 MB。
- 完成 issue #4：记录接口请求，给数据库加上 500 MB 上限，提交 PR，使用远端 CI 验证后关闭 issue。
- 完成 issue #2：来源订单直接读取 Supabase orders 表，保存到本地数据库，完成后将分支改名为 feature-supabse。
- 完成 issue #1：写脚本读取 Supabase 的 orders 表，保存到 orderstable.json，再推送新分支。

## 做完：
- 2026-10-14：issue #10 已完成并关闭，PR #11 已转为可审阅状态：https://github.com/C0verSnow/Orders3/pull/11 。代码 91a474a 的完整远端 CI 通过，包含网页及脚本、Windows x64、Linux x64/ARM64、macOS x64/ARM64 编译回归打包，以及 Docker 双架构网页、接口、随机端口和地址记录验证：https://github.com/C0verSnow/Orders3/actions/runs/38584005810 。
- 2026-10-14：issue #10 最后只更新任务记录，使用 [skip ci]；本地仅做代码阅读和差异检查，没有本地编译验证。
- 2026-10-14：issue #10 已补后台密钥重载；保存连接配置触发读取，失败等待 5 秒再试，成功停止，旧请求取消且结果隔离。启动失败也会重试，密钥仍只在内存。补充自动重试、重复保存、更换连接、手填优先、脱敏和退出回归，差异检查通过。
- 2026-10-14：issue #8 最新代码 3c478a4 的完整远端 CI 通过：网页及脚本、Windows x64、Linux x64/ARM64、macOS x64/ARM64 编译回归打包，以及 Docker 双架构网页接口、随机端口和 docker.md 地址一致性。PR #9：https://github.com/C0verSnow/Orders3/pull/9 ，验证记录：https://github.com/C0verSnow/Orders3/actions/runs/38573489826 。
- 2026-10-14：只读核查真实 Supabase 单条 secret 记录，确认两列名末尾带等号、两项值含外层引号；代码与回归均按真实格式处理，没有输出完整密钥。最后只更新任务记录，使用 [skip ci]；PR 保留供审阅，关闭 issue #8。
- 2026-10-14：完成启动读取 secret 唯一记录，按现有配置分别补齐 Key/Secret，备用值仅在内存保存；保留页面配置、缺失认证前拒绝和日志脱敏。按真实列名 API_KEY=、API_SECRET= 读取。
- 2026-10-14：start-docker.sh 看板就绪后用同一个实际地址原子更新当前目录 docker.md，SSH 部署对应服务器用户主目录；失败保留旧文件。增加远端密钥回归、脚本失败回归和真实 Docker 地址记录断言，更新 README。
- 2026-10-14：Bash 语法及差异检查通过。未进行本地 C++ 构建或测试；曾用 py_compile 检查新增 Python 文件语法，该命令生成 Python 字节码，后续不再使用编译类检查。
- 2026-10-13：当前仓库 issue #6 已完成，代码 099843a，分支 feature-issue-6-cancel-pending-only，PR #7：https://github.com/C0verSnow/Orders3/pull/7 。完整远端 CI 通过：网页与脚本检查、Windows x64、Linux x64/ARM64、macOS x64/ARM64 的编译、回归和打包，以及 Docker x64/ARM64、网页接口和随机端口检查：https://github.com/C0verSnow/Orders3/actions/runs/38383490455 。
- 2026-10-13：本地差异检查通过，未进行本地编译验证。最后只更新任务记录，使用 [skip ci]；PR 保留供审阅，不合并 master。
- 2026-10-13：issue #6 的开仓、平仓撤单和撤单 ID 预检查均只处理状态 1；状态 2 的匹配和新单创建逻辑保留。空来源且只剩状态 2 时直接结束，无需交易密钥。
- 2026-10-13：更新 README、开仓/平仓说明和旧设计稿；补充状态 2 参数变化、空来源、空持仓，以及状态 1/3/4/5 的远端回归断言。
- 2026-10-12：当前仓库 issue #4 已完成，分支 feature-issue-4-ssh-start-script，PR #5：https://github.com/C0verSnow/Orders3/pull/5 。SSH 连上后将仓库根目录脚本写到远端 ~/start-docker.sh，有同名文件就覆盖，没有就新建；临时文件通过语法检查后替换，再执行 bash start-docker.sh，失败返回给 CI。
- 2026-10-12：根目录 start-docker.sh 已纳入 Git，保留原有随机端口、就绪检查和数据卷行为，旧 scripts 路径调用它；README 补充部署过程和个人电脑 SSH 转发命令，无需额外 Compose yml。
- 2026-10-12：代码 858ec52 的完整远端 CI 通过：7 项 SSH 上传执行回归、网页静态检查与 11 项脚本测试、Windows x64、Linux x64/ARM64、macOS x64/ARM64 的编译回归打包，以及 Docker x64/ARM64 网页接口和根目录脚本随机端口检查。运行记录：https://github.com/C0verSnow/Orders3/actions/runs/38331742265 。本地只做 Shell 语法和差异检查，未进行本地编译验证。

- 2026-10-12：尝试通过 home@192.168.1.245 登录，默认 SSH 密钥和工作区已有部署密钥都返回 Permission denied (publickey,password)。没有修改服务器或容器，没有进行本地编译验证。
- 2026-10-11：自动部署地址改为 ghcr.io/c0versnow/orders3:latest，同步 SSH 脚本地址校验和 README。GHCR 镜像包已从 Private 改为 Public；临时启用组织公开包开关完成设置后，恢复组织原有创建限制。匿名读取 latest 镜像清单返回 HTTP 200，包含 Linux amd64/arm64；Shell 语法和差异检查通过，未进行本地编译验证。
- 2026-10-11：查明 Actions #4（38113788776）失败在服务器拉取 GHCR 镜像，报 unauthorized（没有下载权限）；网页、五个平台编译、镜像发布和安装包发布均成功，Tailscale 与 SSH 已连通。部署脚本没有登录 GHCR 的步骤；需检查镜像公开设置或给服务器配置可读取镜像的登录凭据。拉取失败发生在删除旧容器之前，本次没有执行替换旧容器。只阅读远端日志和脚本，未进行本地编译验证，未修改部署代码或重跑部署。
- 2026-10-11：代码 52c1948 的完整远端 CI 通过：网页检查、Windows、Linux x64/ARM64、macOS x64/ARM64 的编译、回归、打包，以及 Docker x64/ARM64 和随机端口检查。运行记录：https://github.com/C0verSnow/Orders3/actions/runs/38112949543 。
- 已提交 PR #3：https://github.com/C0verSnow/Orders3/pull/3 。最后只补充组织密钥说明、镜像示例和任务记录，使用 [skip ci]，不重复编译。
- 2026-10-11：本次处理 C0verSnow/Orders3 的 #1 和 #2，历史记录中的同号 issue 属于旧仓库。
- #2：全 null 订单仍计入原始分页和记录，但不进入可下单列表；空来源会清空旧来源并停止有效开仓单，保留平仓保护单和历史完成单。
- #2：已增加空表、null 记录、混合分页、部分 null、无效时间戳的远端回归用例。
- #1：已按本地 .env 的名称接入 AUTH_KEY、DEPLOY_HOST、DEPLOY_PORT、DEPLOY_USER、DEPLOY_SSH_KEY，密钥内容未进入代码或输出。
- #1：master 镜像发布成功后，经 Tailscale 和 SSH 执行远端 Docker 启动脚本，部署精确 digest，保留数据卷；已补充使用说明。
- 本地仅进行代码阅读、Shell 语法和差异检查，通过；没有进行本地编译验证。

- 2026-10-06：issue #8 和 #6 均完成并关闭；PR #9、#10 已转为可审阅状态，保留供审阅，未合并 master。
- issue #8：代码提交 9a19005 的完整远端 CI 通过，包含网页、Windows x64、Linux x64/ARM64、macOS x64/ARM64 的编译、回归、打包，以及 Docker x64/ARM64 和随机端口检查；运行记录 https://github.com/f1515x/orders3/actions/runs/37568012466 。
- issue #6：代码提交 5e669fb 的完整远端 CI 通过，包含同样的网页、五个平台与 Docker 验证；运行记录 https://github.com/f1515x/orders3/actions/runs/37568221188 。
- issue #8：在 feature-close-position-value 分支完成修改并提交 PR #9：https://github.com/f1515x/orders3/pull/9 。用精确十进制乘法保存 size × entry_price，不再读取交易所 value，也不按空仓方向再次取负；统一使用带符号的公式，保留多仓 ×1.01、空仓 ×0.99 和原有舍入规则，跳过 size=0。
- issue #8：更新 README 与平仓说明，补充多空方向、精度、交易所 value 缺失或无效、零持仓、无效张数及失败保留旧缓存的回归用例。
- issue #6：在 feature-combined-storage-limit 分支完成修改并提交 PR #10：https://github.com/f1515x/orders3/pull/10 。用户确认固定分配 450 MB 数据库、50 MB 日志，临时事务文件及下载快照另算。
- issue #6：同目录数据库共用额度，线程和进程串行写入，超限拒绝写入并保留旧数据，旧数据库仍可读取和下载；旧 WAL 数据写回主文件的空间也预留。请求日志使用十进制 MB，启动与追加前清理最旧的超额日志及旧版本备份。
- issue #6：更新 README，补充共享额度、并发写入、WAL 预留、超限回滚和旧日志清理的回归用例。最初提交后静态复查补上 WAL 预留与日志元数据长度限制，再用最新代码完整复验。
- 两项差异检查通过，没有进行本地编译验证。最后仅更新任务记录与说明措辞，使用 [skip ci]，不重复远端编译；两个分支的本任务记录保持一致。
- 2026-10-06：核查 master（43b8632）的平仓公式。说明使用 entry_price × (1 ± initial_margin × 3.1 / value)；代码还给多仓乘 1.01、空仓乘 0.99。实际下单只调用代码这一套，说明没有同步更新。
- 此前公式核查只阅读代码、说明和已有测试断言，并检查差异；当时没有改业务代码，没有进行本地编译验证。
- issue #4：代码提交 42bc3d1 的完整远端 CI 已通过，包含 Docker x64/ARM64 和随机端口检查；运行记录 https://github.com/f1515x/orders3/actions/runs/37472178811 。
- issue #4：已更新 PR #5 的验证说明并关闭 issue；PR 保留供审阅，未合并 master。最后这次提交只补充任务记录，使用 [skip ci]，不重复编译。
- issue #4：代码已提交为 42bc3d1，推送 feature-request-logs-storage-limit，并创建 PR #5：https://github.com/f1515x/orders3/pull/5 。
- issue #4：远端网页检查和 Windows x64、Linux x64/ARM64、macOS x64/ARM64 的编译、测试、打包及接口日志检查全部通过。
- issue #4：git 差异检查和 Shell 语法检查通过；本机没有 npm，网页检查交给远端 CI，没有进行本地编译验证。
- issue #4：用户确认数据库超限拒绝写入、保留旧数据；程序访问 Supabase/Gate 和客户端访问本程序的请求都记日志。
- issue #4：已加请求日志及文件轮换，密钥和请求内容不进日志；数据库每个写连接设置 500 MB 上限，已有超限文件只允许读取。
- issue #4：补充远端回归用例，覆盖超限回滚、旧数据库、并发日志、日志轮换、取消请求和成功/失败请求；远端打包检查增加本地接口日志检查。
- issue #4：确认只有这一项未完成的 issue；已单独克隆 f1515x/orders3，并新建 feature-request-logs-storage-limit 分支。
- issue #2：代码提交 d30e035 的完整远端 CI 通过，包含网页、所有平台应用及 Docker x64/ARM64 验证；运行记录 https://github.com/huan00000/orders3/actions/runs/37303010661 。
- issue #2：已标记完成并关闭，PR #3 已转为可审阅状态；本次最后一次提交只更新这份过程记录。
- issue #2：第四轮远端 Windows x64、Linux x64/ARM64、macOS x64/ARM64 的编译、回归和打包均通过，网页检查也通过。
- issue #2：第三轮 Linux x64 和 ARM64 全部通过；macOS 新版 Qt 会转小写请求头，已将测试断言改为按 HTTP 规则忽略请求头名称大小写，继续复验。
- issue #2：第二轮远端 Linux ARM64 编译、回归和打包通过；Windows 提示测试条件表达式类型不明确，已明确使用 QByteArray 后继续远端复验。
- issue #2：第一轮远端 CI 已编译主程序；测试链接失败，日志提示 Qt 没生成测试类元信息，已调整新增测试里的字符串写法，继续交给远端验证。
- issue #2：本地和远端分支已改名为 feature-supabse，代码已提交推送，并创建草稿 PR #3 供查看改动。
- issue #2：网页静态检查通过，11 项纯 JavaScript 测试通过，均不触发编译；差异检查通过。
- issue #2：确认旧流程是读取 Supabase 的 1 表、访问 URL、解析文本、存入 SQLite。
- issue #2：改为按 id 分页直接读取 orders 表，保存原始记录并直接填入本地 orders 表；手动、定时和启动入口共用新流程。
- issue #2：价格和数量保留精度，分页或字段出错保留旧数据；新旧 Supabase 密钥都支持，保存成功后继续使用原有自动下单流程。
- issue #2：补充远端 C++ 回归用例，覆盖直接入库、分页、密钥、精度、无效数据和失败保留缓存；更新网页和说明。
- 找到现有本地仓库，读取 issue，确认只有这一项未完成的任务。
- 拉取远端最新代码，从 origin/master 新建 issue-1-export-orders 分支。
- 确认本地已有 Supabase 配置；密钥只在本地读取，不写入提交。
- 写好 scripts/export-orders.mjs 和 npm run export:orders，补充 README 使用说明。
- 直接读取 orders 表成功，导出 1 条真实订单到 orderstable.json；没有修改 Supabase 数据。
- 分页、数字精度、失败保留旧文件、订单数量变化和配置优先级共 5 项脚本测试通过，均不触发编译。
- 数据库结构接口返回 401，但实际 orders 表读取返回 200；已确认无需更换配置。
- 网页静态检查通过，全部 11 项纯 JavaScript 测试通过，git 差异检查通过。
- 已提交脚本、真实数据、说明和测试，并成功推送 issue-1-export-orders 分支。
- 将原来的 Tasklist.md 改为用户要求的 tasklist.md，继续按四个栏目记录。

## 没做：
- 2026-10-14：issue #10 没有合并 master、部署服务器或连接真实 Gate 下单；密钥读取回归使用远端 CI 模拟 Supabase 接口。
- 2026-10-14：issue #8 未合并 master，未连接真实 Gate 操作订单，未执行真实服务器部署；远端回归使用模拟接口和 CI Docker。未进行本地 C++ 编译验证；曾执行的 Python 字节码语法检查已在上面如实记录。
- 2026-10-13：当前 issue #6 没有合并或部署，没有连接真实 Gate/Supabase；远端回归使用模拟接口。
- 当前仓库 issue #4：PR #5 未合并 master；本次没有连接真实服务器，没有发布镜像或执行真实部署。最后仅补任务记录，使用 [skip ci]，不重复编译。
- 本次 #1/#2：未合并 master，未执行真实部署或连接真实 Gate/Supabase。用户说明密钥在 Organization secrets 中；组织密钥元数据读取返回 403，无法确认本仓库授权范围，未复制或更改密钥。
- issue #8、#6：没有合并 PR；没有连接真实 Supabase/Gate 操作订单，远端回归使用模拟接口。
- issue #4：未连接真实 Supabase/Gate 操作订单，回归使用模拟接口；没有合并 PR。
- 按用户约定，不进行本地编译验证。
- 未合并到 master；issue #2 按要求交付 feature-supabse 分支。
- issue #2 的新流程没有连接真实 Supabase 或 Gate，远端回归使用模拟接口。

## 在做：
- 2026-10-12：等待可用于 home@192.168.1.245 的 SSH 登录方式；登录成功后继续检查 Docker、orders-dashboard 容器和 orders3 的进程、日志及服务响应。
- 2026-10-11：latest 下载和公开镜像设置已完成；提交 a238428 已推送 master，远端 Actions 已触发，当前排队，尚未确认本次自动部署结果：https://github.com/C0verSnow/Orders3/actions/runs/38116671757 。
- 本次 #1/#2 的代码和验证已完成，PR #3 等待审阅，未合并 master。
