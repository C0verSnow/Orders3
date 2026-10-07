# 自动平仓追踪单

服务启动时（未设置 `--cached`）、每 60 秒的 Gate 更新，以及网页“获取跟踪订单”都会调用 `closePositionOrders(config)`。它与开仓追踪单共用交易锁，任务未结束时不叠加下一轮。来源 Cron 关闭不影响此轮询。`--list` 仍然只读取跟踪订单，不执行平仓下单。

一次执行按以下顺序处理：

1. 签名读取 `/api/v4/futures/usdt/positions`，校验整个持仓数组。
2. 先校验 `size` 是有效整数张数，跳过 `size=0` 的空持仓。用精确十进制乘法计算并保存 `value = size × entry_price`，不读取 Gate 返回的 `value`，也不按空仓方向再次把它变成负数。多仓的 value 为正，空仓为负；统一使用 `entry_price × (1 + initial_margin × 3.1 / value)`，再给多仓乘 `1.01`、空仓乘 `0.99`。十进制运算不经过浮点数，按 `mark_price` 文本的小数位数取整；正好处于中点时采用四舍六入五成双规则。无效字段、不大于零的计算结果以及重复的同合约同方向非零持仓会中止整批，尚不取消旧单。例如 entry_price=100、initial_margin=10 时，size=1 得到 value=100、close_price=132.310；size=-2 得到 value=-200、close_price=83.655（mark_price 为三位小数）。
3. 在一个 SQLite 事务内更新 `data.db` 的 `position` 表。仅保存 `contract`、`entry_price`、`value`、`leverage_max`、`unrealised_pnl`、`realised_pnl`、`size`、`initial_margin`、`mark_price`、`close_price`。十进制字段为文本，张数为整数。同合约的多空仓分别保留；来源表不受影响。
4. 分页读取当前 Gate 追踪订单，直到返回空页，再更新本地 `orderslist`。从已提交的 `position` 表读取非零持仓，与当前 Gate 账户返回的所有 `reduce_only=true` 且状态为 1 或 2 的订单逐笔匹配，不依赖本地创建记录。合约、数量、激活价格相同则保留旧单，返回 `skipped`，不发停止或创建请求。价格按精确十进制数值比较（`100` 与 `100.00` 相同），每个持仓最多保留一张符合参数的有效平仓单，每个旧单最多匹配一笔持仓。平仓不增加单独的方向比较字段；`amount=-size` 的正负仍用于正确区分同合约多空持仓。
5. 停止其余未匹配的有效追踪平仓单，包括重复单、旧版本遗留单、手工单以及同一账户其他 API Key 创建但本次列表可见的单。已完成、已取消及开仓单不处理。即使当前没有持仓，也会停止列表中残留的有效追踪平仓单。同一合约同时有多仓和空仓时，各方向分别保留一张。
6. 仅为未匹配的非零持仓创建追踪平仓单。`amount=-size`，`activation_price=close_price`；负 amount 使用 `is_gte=true`，正 amount 使用 `is_gte=false`。固定参数为 `reduce_only=true`、`price_type=3`、`price_offset="1%"`、`pos_margin_mode="cross"`、`position_mode="dual_plus"`、`text="apiv4"`。

本程序创建的平仓单 ID 单独保存在 `managed_close_orders` 表，以 API Key 的 SHA-256 摘要区分记录，不保存密钥原文。该表保留创建记录，但不再用于限制平仓匹配与撤单范围；数据库丢失或换用同一账户的 API Key 后，仍按交易所实际订单消除重复。

每分钟仍重新读取持仓和交易所订单；相同订单省去撤单和重建请求。一次流程成功结束后，每个非零持仓方向仅有一张符合参数的有效追踪平仓单。外部同时下单或网络结果不明时，不能保证交易所始终只有一张；下一轮成功同步会再次清理。每笔成功响应立即保存，返回结果包含 `stopped`、`created`、`skipped` 或 `failed`、合约、订单 ID 和错误。停单失败时不创建新单，创建失败时结束本批，不立即重试。网络异常或创建响应缺少 ID 时无法保证跨轮询幂等，应先核对交易所订单。

`GET /api/orders` 返回缓存持仓、平仓执行结果、精确文本格式的盈亏合计及本次程序运行毫秒数。网页分别显示浮盈浮亏、实盈实亏和在线时长；盈亏显示 4 位小数，悬停查看原始精度。实盈实亏是本次缓存的非零持仓的 `realised_pnl` 合计，并非另查账户全历史流水；size=0 的空持仓已跳过，其盈亏不纳入缓存持仓合计。在线时长在程序重启后归零。

接口参考：[Gate 官方期货 API](https://www.gate.com/docs/developers/apiv4/en/futures/)。
