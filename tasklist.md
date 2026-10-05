# 本文档为4象限的任务清单，全文书写大白话

## 想做：
- 完成 issue #2：来源订单直接读取 Supabase orders 表，保存到本地数据库，完成后将分支改名为 feature-supabse。
- 完成 issue #1：写脚本读取 Supabase 的 orders 表，保存到 orderstable.json，再推送新分支。

## 做完：
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
- 按用户约定，不进行本地编译验证。
- 未合并到 master，也未关闭 GitHub issue；本次按 issue 要求交付新分支。

## 在做：
- issue #2：正在做静态检查和差异检查，随后推送 feature-supabse 分支交给远端 CI 验证。
