# 自动平仓追踪单

服务启动时（未设置 `--cached`）、每 60 秒的 Gate 更新，以及网页“获取跟踪订单”都会调用 `closePositionOrders(config)`。它与开仓追踪单共用交易锁，任务未结束时不叠加下一轮。来源 Cron 关闭不影响此轮询。`--list` 仍然只读取跟踪订单，不执行平仓下单。

一次执行按以下顺序处理：

1. 签名读取 `/api/v4/futures/usdt/positions`，校验整个持仓数组。
2. 根据 `size` 的方向计算 `close_price`：多仓使用正 `value`，空仓使用负 `value`，公式为 `entry_price * (1 + initial_margin * 3.1 / Value)`。十进制运算不经过浮点数，按 `mark_price` 文本的小数位数取整；正好处于中点时采用 Decimal 默认的四舍六入五成双规则。零持仓保存 `close_price="0"`，不下单。非零持仓的零价值、无效字段及不大于零的计算结果会中止整批，尚不取消旧单。
3. 在一个 SQLite 事务内更新 `data.db` 的 `position` 表。仅保存 `contract`、`entry_price`、`value`、`leverage_max`、`unrealised_pnl`、`realised_pnl`、`size`、`initial_margin`、`mark_price`、`close_price`。十进制字段为文本，张数为整数。同合约的多空仓分别保留；来源表不受影响。
4. 分页读取当前 Gate 追踪订单，直到返回空页，再更新本地 `orderslist`。从已提交的 `position` 表读取非零持仓，与本程序记录过 ID 的 `reduce_only=true` 且状态为 1 或 2 的订单逐笔匹配。合约、数量、激活价格相同则保留旧单，返回 `skipped`，不发停止或创建请求。价格按精确十进制数值比较（`100` 与 `100.00` 相同），每个旧单最多匹配一笔持仓。平仓不增加单独的方向比较字段；`amount=-size` 的正负仍用于正确区分同合约多空持仓。
5. 仅停止未匹配的本程序有效平仓单。已完成、已取消、手工创建以及其他 API Key 记录的订单不会停止。即使当前没有持仓，也会停止本程序残留的有效平仓单。
6. 仅为未匹配的非零持仓创建追踪平仓单。`amount=-size`，`activation_price=close_price`；负 amount 使用 `is_gte=true`，正 amount 使用 `is_gte=false`。固定参数为 `reduce_only=true`、`price_type=3`、`price_offset="1%"`、`pos_margin_mode="cross"`、`position_mode="dual_plus"`、`text="apiv4"`。

本程序创建的平仓单 ID 单独保存在 `managed_close_orders` 表，以 API Key 的 SHA-256 摘要区分记录，不保存密钥原文。重启后仍可识别这些订单；数据库丢失或换用其他 API Key 后不会把未记录的订单认作本程序订单。

每分钟仍重新读取持仓和交易所订单；相同订单省去撤单和重建请求。每笔成功响应立即保存，返回结果包含 `stopped`、`created`、`skipped` 或 `failed`、合约、订单 ID 和错误。停单失败时不创建新单，创建失败时结束本批，不立即重试。网络异常或创建响应缺少 ID 时无法保证跨轮询幂等，应先核对交易所订单。

`GET /api/orders` 返回缓存持仓、平仓执行结果、精确文本格式的盈亏合计及本次程序运行毫秒数。网页分别显示浮盈浮亏、实盈实亏和在线时长；盈亏显示 4 位小数，悬停查看原始精度。实盈实亏是本次持仓接口返回的全部 `realised_pnl` 合计，并非另查账户全历史流水；零持仓记录的盈亏也纳入合计。在线时长在程序重启后归零。

接口参考：[Gate 官方期货 API](https://www.gate.com/docs/developers/apiv4/en/futures/)。
