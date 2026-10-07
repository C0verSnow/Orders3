# 本文档为4象限的任务清单，全文书写大白话

## 想做：
- 完成 issue #6：数据库主文件合计 450 MB，请求日志合计 50 MB，提交独立 PR，使用远端 CI 验证后关闭 issue。
- 完成 issue #4：记录接口请求，给数据库加上 500 MB 上限，提交 PR，使用远端 CI 验证后关闭 issue。
- 完成 issue #2：来源订单直接读取 Supabase orders 表，保存到本地数据库，完成后将分支改名为 feature-supabse。
- 完成 issue #1：写脚本读取 Supabase 的 orders 表，保存到 orderstable.json，再推送新分支。

## 做完：
- issue #6：已实现同目录数据库合计 450 MB、进程与线程串行写入，请求日志合计 50 MB；补充共享额度、并发写入、超限保留旧数据与旧日志清理的远端回归用例，更新 README。差异检查通过，没有进行本地编译验证。
- 2026-10-06：用户确认本次完成 #8 和 #6；#8 已提交 9a19005 并创建 PR #9（https://github.com/f1515x/orders3/pull/9），远端 CI 正在运行。
- issue #6：用户确认固定分配 450 MB 数据库、50 MB 请求日志；临时事务文件和下载快照另算。
- 2026-10-06：核查 master（43b8632）的平仓公式。说明使用 entry_price × (1 ± initial_margin × 3.1 / value)；代码还给多仓乘 1.01、空仓乘 0.99。实际下单只调用代码这一套，说明没有同步更新。
- 本次只阅读代码、说明和已有测试断言，并检查差异；没有改业务代码，没有进行本地编译验证。
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
- issue #4：未连接真实 Supabase/Gate 操作订单，回归使用模拟接口；没有合并 PR。
- 按用户约定，不进行本地编译验证。
- 未合并到 master；issue #2 按要求交付 feature-supabse 分支。
- issue #2 的新流程没有连接真实 Supabase 或 Gate，远端回归使用模拟接口。

## 在做：
- issue #6：在 feature-combined-storage-limit 分支修改数据库共享额度和日志总量限制，补充远端回归用例；#8 在独立分支等待远端 CI。
