# issue #47：小数成交被截成零，挡住入仓历史和平仓维护

## 现场证据

先 SSH 到 `root@192.168.1.245`，在 `/home/deploy` 核对 Docker。容器 `orders-dashboard` 健康，镜像 revision 为 `28903bab8c9d2f7e7055529352e5e062b0e468b0`，与本次修复基线一致。下列时间为 UTC。

只读查询线上 SQLite、请求日志和工作台 GET 接口，发现：

- 每十分钟维护连续失败，最近多轮均为 `成交历史 size 与 close_size 无效或方向冲突`。成交历史 HTTP 请求实际返回 200，失败在业务解析阶段。
- 历史表有 5 条旧记录，并非数据库表完全为空；成功水位停留在旧时间，新增成交未提交。
- 持仓缓存为 SOL 1 张、SNDK 19 张；追踪单缓存没有 SOL 平仓单，SNDK 平仓单仍为 -10 张。没有 pending/unknown 交易意图。
- 普通订单同步继续成功，`/api/orders.error` 又变成 null，掩盖了独立维护失败。

优先检查部署目录 `.env`、容器配置和持久配置；Gate 凭证实际来自既有 Infisical 备用来源。沿用该认证读取凭证，仅在内存签名，未输出、保存或提交任何密钥。向 Gate 发出的业务请求全部为 GET，没有触发线上维护或交易。

完整拉取七天成交（8 条，到空页），仅输出必要字段：两条 SOL 成交在默认请求中都是 `size=0, close_size=0`，时间均为 `1793649595.9454`；相同范围、相同成交 ID 的请求加上 `X-Gate-Size-Decimal: 1` 后分别返回 `size=0.9` 和 `size=0.1`。SNDK 加仓为 9 张，其余整数成交不变。由此排除了方向判断错误、历史接口网络失败和未知交易阻断作为本次现场根因。

[Gate 官方迁移公告](https://www.gate.com/announcements/article/48788)说明：未启用该请求头时，旧整数响应会把小数数量向零截断；该开关也覆盖成交历史的 `size` 和 `close_size`。程序已有精确小数解析，缺的是请求头。不能忽略零成交来绕过本次问题，否则 SOL 的真实入仓会永久漏记。

## 修改行为

1. 所有成交历史分页都请求小数响应。保持无损 JSON、Decimal 比较、文本成交 ID、真实成交时间、七天回看、迟到成交去重、100 条展示上限和事务提交规则。
2. SOL 的 0.9 和 0.1 两笔成交分别记为入仓事件，最新一笔记录首次观察保证金；SNDK 加仓也能正常进入历史。维护随后按既有规则同步持仓、创建 SOL 反向只减仓单、重新核对并调整 SNDK 数量。
3. 维护错误单独保留，普通订单刷新成功不会抹掉。重启读取最近失败维护记录；下一轮维护成功后清除提示，旧失败执行记录仍留在数据库。
4. 历史接口失败、真正的零成交、方向冲突或分页无效时仍停止本轮维护，不推进历史水位、不提交部分历史、不继续交易。未知交易、激活单、缺少策略字段、提交前持仓变化的阻断保持原行为。

本次只给成交历史加精度响应头；当前持仓、订单执行仍沿用整数张数规则，不宣称已支持所有接口的小数持仓或小数下单。分笔成交小于一张而合计持仓为整数的现场问题可由本修复处理。若后续要支持小数持仓/下单，需要另行调整合约数量校验、SQLite 和所有读写接口。

## GitHub 检索与取舍

检索了官方 SDK 和活跃交易项目。官方 `gateio/gateapi-python`、`gateio/gateapi-nodejs` 检索结果已归档，不作为活跃候选。以下两个项目有明确许可证、较多 star、近期提交和问题响应；只借鉴精确数量与成交身份的处理思路，没有复制代码，也不引入整套交易框架。

| 项目 | 检索时情况 | 实现与依赖 | 限制与取舍 |
| --- | --- | --- | --- |
| [CCXT](https://github.com/ccxt/ccxt) | 约 4.47 万 star；2026-11-02 有提交；MIT；[#30881](https://github.com/ccxt/ccxt/issues/30881)有 Gate 问题回应 | [Gate parseTrade](https://github.com/ccxt/ccxt/blob/master/ts/src/gate.ts)保留成交 ID，使用 Precise 字符串运算处理数量；依赖含 undici、ws 和多种加密库 | 通用买卖方向不是开仓/平仓分类，不能直接代替本项目 close_size 判断；#30881 也说明通用适配层仍需核对交易所实际接口。本项目保留现有 lossless-json/Decimal，仅借鉴精确字段处理 |
| [Hummingbot](https://github.com/hummingbot/hummingbot) | 约 2.09 万 star；最近提交 2026-10-20；Apache-2.0；[#8281](https://github.com/hummingbot/hummingbot/issues/8281)有维护者讨论 | [Gate 永续连接器](https://github.com/hummingbot/hummingbot/blob/master/hummingbot/connector/derivative/gate_io_perpetual/gate_io_perpetual_derivative.py)使用 Decimal、成交 ID 和合约乘数；Python/Cython/numpy 构建体系 | 成交转换处明确没有 position_action，不能据此直接判定入仓；[#8351](https://github.com/hummingbot/hummingbot/issues/8351)报告乘数未初始化问题。本项目继续用自己的已校验合约规则和真实成交分类 |

## 验证与交付

遵守上级 AGENTS.md，没有本地构建、编译、运行 TypeScript 测试或冒烟。只做代码阅读和 `git diff --check`，执行测试与编译交给已有 GitHub Actions。

先推测试提交 `0383bb2`，用 [远端 CI](https://github.com/C0verSnow/Orders3/actions/runs/41556055354)确认旧实现失败，再提交修复。新增 `tests/node/issue-47.test.ts` 通过真实 HttpClient 解析和临时 SQLite、假交易所覆盖：

- 模拟缺请求头时 0.9/0.1 变零，加头后正确解析、分页、时间与大 ID 去重、保证金归属。
- 十分钟调度记录 SOL/SNDK 入仓，创建 SOL 平仓单并把 SNDK 从 10 调整为 19；再次维护不重复交易。
- 维护失败后普通刷新和重启仍显示错误，之后维护成功才清除；接口失败无写入。
- 小数开多/开空、纯平仓、反手和真正无效输入的分类。

[修复提交 06bcff2 的完整远端 CI](https://github.com/C0verSnow/Orders3/actions/runs/41556426465)已通过：94 项测试全部成功，类型/静态检查、构建、运行冒烟、桌面与手机浏览器、Windows EXE、Linux AMD64/ARM64 安装运行、双架构 Docker 与跨平台像素对比均成功。发布和部署在 feature/PR 上按规则跳过。[PR #48](https://github.com/C0verSnow/Orders3/pull/48)等待用户 review，issue #47 已按要求关闭。最终远端验证结果与 PR 链接也在 `tasklist.md` 记录。feature 分支提交 PR 供用户 review；合并和生产部署沿用 main 的既有流程。排查期间未改线上数据或镜像。
