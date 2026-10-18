# 本文档为4象限的任务清单，全文书写大白话。

## 想做：
- 2026-10-16：完成 issue #23，把 docker.md 改成两行的本地看板地址，更新说明和远端检查，提交 PR 并交给远端 CI 验证。
- 2026-10-16：完成 issue #21，固定入仓或加仓后的 initial_margin，多空追踪平仓价分别乘 1.01、0.99；更新文档、提交 PR、通过远端 CI 后关闭 issue。
- 2026-10-15：完成 issue #19，修复凭证配置状态与成交历史回归，在 feature 分支提 PR，更新文档并跑远端 CI。
- 2026-10-15：完成 issue #16，在 feature 分支移除平仓 ID 专用表，修改目标毛收益公式，抓取真实合约参数，新增实际入仓历史和所有开仓入口的 7 天限制；更新文档、提 PR、跑远端 CI 后关闭 issue。
- 2026-10-14：完成 issue #14，把 Docker ARM64 构建和测试迁到原生 Runner，保留双架构发布，提交 PR 并使用远端 CI 验证。
- 2026-10-14：修复 PR #13 与最新 master 的合并冲突，保留两边改动，推送原 PR 分支。
- 2026-10-14：完成 issue #12，核对平多仓收益公式，说明本金、净利润和 300% 回报率，提供完整数字示例。
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
- [1792303832] issue #27：独立部署公钥已添加到服务器，原 authorized_keys 已备份；新密钥 SSH 验证返回 orders-ssh-ok，确认 /home/deploy 可写且可访问 Docker。浏览器已打开 Orders3 新增 Repository secret 页面并填好 DEPLOY_SSH_KEY 名称；采用仓库级同名值，避免改动其他仓库共用的组织密钥。README 已补充部署与机器人分开使用密钥的说明。

- [1792303728] issue #27：通过 root SSH 查看 /home/deploy，确认 authorized_keys 将现有公钥强制交给 /usr/local/lib/tgbot-control.py；该脚本只接受 start/stop 加数字。把部署用的 bash 命令交给同一脚本后，重现退出码 1 和 {"result":"failed"}。服务器 Bash 正常，失败原因是部署密钥碰到了机器人的命令限制。

- [1792302650] issue #27：已同步 origin/master 并新建 feature/issue-27-deploy-fix 分支；读取 Actions 39100677303，构建、测试、镜像和发布通过，只有 SSH 部署失败。

- 1792301157：issue #25 已完成并关闭，PR #26 已转为可审阅：https://github.com/C0verSnow/Orders3/pull/26 。按用户确认用程序内 C++ 获取 Infisical Production、根目录的 Gate 备用密钥，保留本地逐字段优先、内存保存、5 秒失败重试和网页保存后刷新；更新 README 和配置示例。
- 1792301157：代码 a416dc4 的完整远端检查通过：https://github.com/C0verSnow/Orders3/actions/runs/39100073550 ，包含网页与脚本、Windows x64、Linux x64/ARM64、macOS x64/ARM64 编译回归及打包，以及 AMD64/ARM64 原生 Docker 启动、接口、随机端口和地址记录检查。真实 Infisical 仅只读确认认证与两项密钥均 HTTP 200，提交泄密静态检查通过；本地未编译、未运行测试。最后只补过程记录，使用 [skip ci]。
- 1792300670：fa885c2 远端 Windows 报告确认核心回归 127 项通过、1 项失败，仅新增空环境变量断言不符合 Windows 的 Qt 行为；Infisical 认证、混合来源、重试和刷新全部通过。按 Qt 官方规则分别验证 Windows 删除变量后使用别名、Unix 保留显式空值，修正说明，继续完整远端验证。
- 1792300411：47934af 的远端 Linux x64/ARM64、macOS ARM64 和网页脚本检查通过；Windows 编译通过但核心回归失败，Qt 默认输出未进日志。补上文本报告和失败时打印，继续由远端 CI 定位，不在本地编译。
- 1792300099：已提交 d22723c，创建草稿 PR #26，远端 CI 已启动。静态复查补上两项密钥分别读取：单项失败仍可补另一项，失败字段保留内存旧值并继续重试；不改变本地优先规则。
- 1792300034：用户确认沿用程序内取密钥，不引入独立脚本。浏览器只读确认 Example Project、根目录，用户选择 Production；真实 Universal Auth 和两项密钥读取均 HTTP 200，只输出状态和是否存在，不显示或落盘密钥。正在补模拟接口回归及文档，随后提交 PR 并交远端 CI。
- 1792299853：已从最新 origin/master 建立 feature-issue-25-infisical 分支，正在核对现有取密钥流程和官方 API；本地只检查 .env 字段名，没有输出凭据。已询问 Infisical 服务地址、项目、环境和路径。

- 2026-10-16：issue #23 已完成：docker.md 现在第一行是“本地看板：”，第二行是实际的 127.0.0.1:端口，不带协议和末尾斜杠；同步 README、原有脚本回归断言及双架构 Docker 完整文件比对。PR #24：https://github.com/C0verSnow/Orders3/pull/24 。
- 2026-10-16：代码 e0615b4 的完整远端 CI 通过：https://github.com/C0verSnow/Orders3/actions/runs/38880733461 ，含网页和脚本、五个平台编译回归打包、AMD64/ARM64 原生 Docker、随机端口和地址记录检查；PR 触发的运行也通过：https://github.com/C0verSnow/Orders3/actions/runs/38880779992 。本地仅做 Shell 语法、Python 语法解析和差异检查，未进行本地编译或运行本地测试。GitHub 连接器写入权限不足，使用本机已有 GitHub 登录完成 PR 操作，没有输出凭据；最后只补本记录，使用 [skip ci]。
- 2026-10-16：issue #21 已完成并关闭，PR #22 已转为可审阅：https://github.com/C0verSnow/Orders3/pull/22 。代码 d7af9ec 的完整远端 CI 通过：https://github.com/C0verSnow/Orders3/actions/runs/38859341178 ，包含网页与脚本、Windows x64、Linux x64/ARM64、macOS x64/ARM64 编译回归打包，以及 AMD64/ARM64 原生 Docker、网页接口、三种启动方式、随机端口和地址记录检查。
- 2026-10-16：issue #21 已固定初次读取或最新真实入仓、加仓后的保证金，重复成交、行情变化和纯减仓不覆盖；历史清理后仍保留当前固定值。多仓原目标乘 1.01、空仓乘 0.99，再按真实步长舍入。已更新 README、平仓说明、历史规则和数据库文档。GitHub 连接器写入受限，创建及更新 PR、转为可审阅和关闭 issue 使用本机已有 GitHub 登录完成，未输出凭据。最后仅补任务记录并使用 [skip ci]；静态差异检查通过，未进行本地编译或运行本地测试。
- 2026-10-16：issue #21 首轮远端 Linux 编译成功，核心回归 121 项通过、1 项旧价格断言失败；新增保证金用例全部通过。已把多仓样例预期同步到乘 1.01 后的 89.369，继续完整远端验证；未进行本地编译或运行本地测试。
- 2026-10-15：issue #19 已完成并关闭，PR #20 已转为可审阅状态：https://github.com/C0verSnow/Orders3/pull/20 。业务代码 a833cf2 的完整远端 CI 通过：https://github.com/C0verSnow/Orders3/actions/runs/38754693904 ，包括网页与脚本、Windows x64、Linux x64/ARM64、macOS x64/ARM64 回归及打包，以及 AMD64/ARM64 原生 Docker 架构、网页接口、三种启动方式、随机端口和地址记录检查。
- 2026-10-15：issue #19 最后仅补充本任务记录，使用 [skip ci]；代码阅读与 git 差异检查通过，未进行本地编译验证。GitHub 连接器写入返回 403，PR 创建、更新、转为可审阅和关闭 issue 使用已有本机 GitHub 登录完成，没有输出凭据。
- 2026-10-15：issue #19 首轮修复远端已通过全部 15 类成交数量回归和凭证拦截用例；发现原有空任务应直接返回、无需凭证的兼容行为被前置检查改变，已恢复；同步旧错误提示断言与空白凭证来源断言，继续完整远端复验。
- 2026-10-15：issue #19 远端复现成功：987f0ae 的 Linux x64/ARM64 回归失败，日志确认提示文字被识别为凭证、数字成交数量触发原始错误；复现记录 https://github.com/C0verSnow/Orders3/actions/runs/38753344323 。本地未运行编译。
- 2026-10-15：issue #19 已通过 root SSH 进入 /home/deploy 只读核查：运行版本 5938e99；配置中的 Gate 双凭证为空，但 Supabase 备用凭证非空；真实成交 3 条均使用数字 size/close_size，PR #18 的字符串整数解析会全部拒绝。未输出密钥或修改现场交易数据。已补实际调用链回归用例，先交远端复现。
- 2026-10-15：issue #16 已完成并关闭，PR #18 已转为可审阅状态：https://github.com/C0verSnow/Orders3/pull/18 。代码 43aa691 的完整远端 CI 通过：https://github.com/C0verSnow/Orders3/actions/runs/38745943242 ，包含网页和脚本、Windows x64、Linux x64/ARM64、macOS x64/ARM64 编译回归打包，以及 AMD64/ARM64 原生 Docker 架构、网页、接口、三种启动方式、随机端口和 docker.md 地址记录检查。
- 2026-10-15：issue #16 文档已同步；用户确认加仓也记入仓历史并重新算 7 天。最终只更新任务记录，使用 [skip ci]，不重复远端构建；本地仅阅读、静态差异检查和十进制算例复核，未进行本地编译验证。GitHub 连接器写入权限不足，PR 创建与更新、转可审阅和关闭 issue 使用本机已有 GitHub 登录完成，没有输出凭据。
- 2026-10-15：第二轮远端编译通过；Linux 核心测试 101 项通过、1 项旧鉴权失败用例失败，活动和数据库日志回归通过。原因是平仓流程先写历史进度再鉴权，已调整为持仓接口鉴权及响应格式检查成功后才同步历史，仍在任何交易写入前完成；继续远端完整复验。
- 2026-10-15：issue #16 已完成首轮代码、回归用例和文档：移除平仓专用 ID API；真实合约参数参与公式和保存；按真实成交识别开仓、加仓、反手并保留最近 100 条；所有新开仓提交前同步历史并检查 7 天限制，历史读取失败暂停。旧平仓 ID 表原样保留且不访问。静态差异及十进制算例复核通过，等待远端 CI。
- 2026-10-14：issue #14 已完成并关闭，PR #15 已转为可审阅状态：https://github.com/C0verSnow/Orders3/pull/15 。代码 301069d 的完整远端 CI 通过：https://github.com/C0verSnow/Orders3/actions/runs/38666215830 ，包含网页和脚本、Windows x64、Linux x64/ARM64、macOS x64/ARM64，以及 AMD64 和 ARM64 原生 Docker 构建、架构核对、网页接口、三种启动方式、随机端口与 docker.md 地址检查；确认仓库可运行 ubuntu-24.04-arm Docker 任务。
- 2026-10-14：issue #14 最后只更新任务记录，使用 [skip ci]；本地仅做静态检查和差异检查，未进行本地编译验证。GitHub 连接器写入权限不足，PR 创建、更新、转可审阅和 issue 关闭改用本机已有 GitHub 登录完成，没有输出凭据。
- 2026-10-14：issue #14 已拆分 AMD64/ARM64 原生 Docker 构建和验证，删除 QEMU，增加宿主机、Docker 引擎、镜像架构检查；两边保留网页、接口、三种启动方式、随机端口和地址记录检查，缓存分架构。发布时上传各自摘要，独立任务合并双架构清单，保留原有标签、Release 和部署输出。
- 2026-10-14：issue #14 的 actionlint、YAML 解析、Bash 语法和 git 差异检查通过；没有运行本地构建、编译、容器或冒烟脚本。
- 2026-10-14：PR #13 合入最新 master（6a67f94），解决 tasklist.md 三处冲突，完整保留 issue #10、issue #12 和本次任务记录；README 自动合并，保留凭据后台刷新说明和平仓收益分析入口。静态检查确认业务代码与最新 master 一致、原 PR 分析文档未变；未进行本地编译验证。
- 2026-10-14：issue #12 的完整分析已回复到 GitHub 并关闭，PR #13 保留供审阅：https://github.com/C0verSnow/Orders3/pull/13 。分支 docs-issue-12-close-profit。GitHub 连接器写入返回 403，改用本机已有 GitHub 登录完成提交；没有输出登录凭据。
- 2026-10-14：issue #12 已完成公式分析文档，区分保证金、名义价值、释放本金、毛利润、净利润和 ROI；补充含费目标成交价、投入 1 净赚 3 的完整示例，以及现行公式漏合约乘数、当前保证金变化、追踪激活价与成交价不一致的问题。
- 2026-10-14：issue #12 十进制算术复核、新增文档链接和差异检查通过；README 原有 AGENTS.md 链接目标缺失，与本次修改无关。本次只有文档和任务记录，提交使用 [skip ci]，未触发远端编译，也未进行本地编译验证。
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
- 1792301157：issue #25 未合并或部署服务器，未访问真实 Gate 下单或撤单；启用备用来源时需在运行环境配置 Infisical 机器身份和项目 ID，修改机器认证参数需重启。
- 2026-10-16：issue #23 未合并 master、未发布或部署服务器；新版 docker.md 在下次使用新脚本成功启动后写入。
- 2026-10-16：issue #21 未合并 master、未发布或部署、未连接真实交易所下单或撤单。保证金是确认成交后首次成功读取的持仓整体观察值，不能回溯历史逐笔保证金；同批只填最新事件。价格乘 1.01/0.99 仅近似补偿回撤，不保证实际成交收益。
- 2026-10-15：issue #19 未合并 master、未发布或部署服务器、未连接真实 Gate 下单或撤单；服务器仅做只读凭证状态和成交字段类型核查。交易回归使用模拟接口，交易权限仍须由真实交易所验证。
- 2026-10-15：issue #16 未合并 master、未发布或部署、未连接真实 Gate 操作订单；远端交易回归使用模拟接口。目标是持仓初始保证金 3.1 倍毛收益对应的追踪激活价，继续原有 1% 回撤，不保证成交毛收益或净收益。历史仅保留 100 条，旧 managed_close_orders 表保留但不访问。
- 2026-10-14：issue #14 没有合并 master、发布真实镜像或部署服务器；GHCR 摘要上传、双架构清单合并和发布摘要输出只在发布分支执行，本次 PR CI 没有执行这些发布步骤。
- 2026-10-14：issue #12 按需求交付分析说明，未修改交易策略、未合并或部署、未连接真实交易接口；逐笔成本定义和下单方式需在后续策略实现时确定。
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
- [1792304098] issue #27：用户已保存新私钥；浏览器确认组织级 DEPLOY_SSH_KEY 已更新，仓库级仍为空，已告知组织共享范围的影响。开始重跑原 Actions 39100677303 的失败作业，验证真实部署。

- [1792303832] issue #27：浏览器工具要求认证凭据的填写和提交由用户亲自完成，等待用户粘贴新私钥并点击 Add secret；随后重跑原失败部署，再提交 PR 和关闭 issue。尚未更新 GitHub 私钥值，未本地编译。

- [1792303807] issue #27：按用户授权生成独立 Ed25519 部署密钥，保存在仓库外 ~/.ssh/orders3_actions_deploy_ed25519；备份服务器 authorized_keys 并追加部署公钥，保留机器人公钥和强制命令限制。

- [1792303728] issue #27：需要单独的部署密钥及 GitHub DEPLOY_SSH_KEY 更新方式；保留机器人公钥的原有限制。本次只查看服务器配置并重现命令拒绝，未改服务器配置、重启容器或本地编译。

- [1792303703] issue #27：用户授权直接 SSH 登录 root@192.168.1.245 并查看 /home/deploy，开始检查部署账号、SSH 限制和服务日志。

- [1792302674] issue #27：用户在服务器本机运行 bash 成功，确认 Bash 可用；这还没有经过 SSH，继续询问从其他电脑通过同一部署账号执行 SSH 命令的结果。

- [1792302650] issue #27：SSH 只返回 {"result":"failed"}，没有脚本上传提示，原因尚未确认；已向用户询问远端 bash 命令结果或可用登录方式，收到后继续定位。没有执行本地构建、编译或测试。

- 2026-10-12：等待可用于 home@192.168.1.245 的 SSH 登录方式；登录成功后继续检查 Docker、orders-dashboard 容器和 orders3 的进程、日志及服务响应。
- 2026-10-11：latest 下载和公开镜像设置已完成；提交 a238428 已推送 master，远端 Actions 已触发，当前排队，尚未确认本次自动部署结果：https://github.com/C0verSnow/Orders3/actions/runs/38116671757 。
- 本次 #1/#2 的代码和验证已完成，PR #3 等待审阅，未合并 master。

- [1792302617] 开始处理 issue #27：查看失败的 Actions 日志，修复后更新文档、提交 PR；不做本地编译验证。
