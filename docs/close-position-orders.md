> 迁移说明：本文保留旧业务规则作为基线。当前实现已改为 Node.js/TypeScript；函数映射和两位精度阻断见 [业务对照](business-parity.md)。旧 C++ 文件名仅供 Git 历史查阅，旧 UI 展示位数以新两位规则为准。

# 自动平仓追踪单

> 收益口径核查见 [平多仓收益分析（issue #12）](close-profit-analysis.md)。下文记录现有代码行为；close_price 是追踪单激活价，不能当作实际成交价或三倍净利润保证。

服务启动时（未设置 `--cached`）、每 60 秒的 Gate 更新，以及网页“获取跟踪订单”都会调用 `closePositionOrders(config)`。它与开仓追踪单共用交易锁，任务未结束时不叠加下一轮。来源 Cron 关闭不影响此轮询。`--list` 仍然只读取跟踪订单，不执行平仓下单。

一次执行按以下顺序处理：

1. 签名读取 `/api/v4/futures/usdt/positions`，校验整个持仓数组。
2. 先同步真实成交历史（规则见 [入仓历史与开仓限制](position-entry-history.md)），校验 `size` 是有效整数张数，跳过 `size=0`。按合约读取 Gate `/api/v4/futures/usdt/contracts/{contract}`，取得真实 `quanto_multiplier` 和 `order_price_round`；同次抓取同合约只请求一次，不使用固定值或缺省值。每笔持仓独立使用自己的 `entry_price`、`size` 和入仓历史中固定保存的 `initial_margin`（旧持仓首次读取时初始化）：
   - 多仓：`close_price = entry_price + 3.1 × initial_margin / (abs(size) × quanto_multiplier)`。
   - 空仓：`close_price = entry_price - 3.1 × initial_margin / (abs(size) × quanto_multiplier)`。
   - `value = size × quanto_multiplier × entry_price`，保留方向符号。
   - 全部使用精确十进制运算，最后取最近的 `order_price_round` 整数倍；中点取偶数倍，步长 0.5 等非十进制幂也支持。无效参数、非正结果、重复合约方向会在撤单前中止整批。步长舍入会让毛收益略偏离目标。
   - 在原始目标价上，多仓乘 `1.01`，空仓乘 `0.99`，然后统一对齐真实价格步长，五成双舍入。`close_price` 保存这个调整后的激活价。
   - 例如 entry_price=100、size=2、乘数=0.1、固定 initial_margin=1、步长=0.5 时，多仓原始目标=115.5，调整并舍入后=116.5；size=-2 时空仓原始目标=84.5，调整并舍入后=83.5。
3. 在一个 SQLite 事务内更新 `data.db` 的 `position` 表。保存原有十个字段以及 `quanto_multiplier`、`order_price_round`；旧表通过增加两列兼容。十进制字段为文本，张数为整数。同合约的多空仓分别保留；来源表不受影响；入仓历史的固定保证金按上面的规则保存。
4. 分页读取当前 Gate 追踪订单，直到返回空页，再更新本地 `orderslist`。从已提交的 `position` 表读取非零持仓，与当前 Gate 账户返回的所有 `reduce_only=true` 且状态为 1 或 2 的订单逐笔匹配，不依赖本地创建记录。合约、数量、激活价格相同则保留旧单，返回 `skipped`，不发停止或创建请求。价格按精确十进制数值比较（`100` 与 `100.00` 相同），每个持仓最多保留一张符合参数的有效平仓单，每个旧单最多匹配一笔持仓。平仓不增加单独的方向比较字段；`amount=-size` 的正负仍用于正确区分同合约多空持仓。
5. 仅停止其余未匹配且 `original_status=1` 的追踪平仓单，包括重复单、旧版本遗留单、手工单以及同一账户其他 API Key 创建但本次列表可见的单。状态 2、已完成、已取消及开仓单不取消。即使当前没有持仓，也只停止列表中残留的状态 1 追踪平仓单。同一合约同时有多仓和空仓时，各方向分别保留一张。
6. 仅为未匹配的非零持仓创建追踪平仓单。`amount=-size`，`activation_price=close_price`；负 amount 使用 `is_gte=true`，正 amount 使用 `is_gte=false`。固定参数为 `reduce_only=true`、`price_type=3`、`price_offset="1%"`、`pos_margin_mode="cross"`、`position_mode="dual_plus"`、`text="apiv4"`。

不再创建、读取或维护 `managed_close_orders` 表，也不再保存专属平仓 ID。旧数据库若已有这张表，原样保留且不访问，避免升级时删数据；其他业务表不受影响。平仓匹配、去重和撤单使用交易所实际列表。

每分钟仍重新读取持仓和交易所订单；相同订单省去撤单和重建请求。一次流程成功结束后，每个非零持仓方向保留或补建一张符合参数的有效追踪平仓单。状态 2 的旧单即使参数不匹配或重复也不取消，因此可能与新单同时存在。外部同时下单或网络结果不明时，不能保证交易所始终只有一张；下一轮成功同步只清理未匹配的状态 1 订单。每笔成功响应立即保存，返回结果包含 `stopped`、`created`、`skipped` 或 `failed`、合约、订单 ID 和错误。停单失败时不创建新单，创建失败时结束本批，不立即重试。网络异常或创建响应缺少 ID 时无法保证跨轮询幂等，应先核对交易所订单。

`GET /api/orders` 返回缓存持仓、平仓执行结果、精确文本格式的盈亏合计及本次程序运行毫秒数。网页分别显示浮盈浮亏、实盈实亏和在线时长；盈亏显示 4 位小数，悬停查看原始精度。实盈实亏是本次缓存的非零持仓的 `realised_pnl` 合计，并非另查账户全历史流水；size=0 的空持仓已跳过，其盈亏不纳入缓存持仓合计。在线时长在程序重启后归零。

接口参考：[Gate 官方期货 API](https://www.gate.com/docs/developers/apiv4/en/futures/)。

公式目标是该持仓 `initial_margin` 的 3.1 倍毛收益，不扣手续费、资金费及滑点，也不使用账户总保证金。保证金取自真实入仓或加仓确认后保存的持仓保证金观察值，首次升级的旧持仓用首次读取值初始化。普通行情、纯减仓、保证金或杠杆调整不覆盖它；只有新的真实入仓或加仓成交才更新。详细兼容及历史补抓规则见 [入仓历史](position-entry-history.md)。

`activation_price=close_price` 按 Gate 定义是激活追踪的价格，`price_type=3` 使用标记价格，激活价已按多仓 1.01、空仓 0.99 近似补偿，激活后仍按原有 1% 回撤触发；它不是成交限价，也不能保证最终成交的毛收益或净收益达到 3.1 倍。接口定义见 [Gate 官方期货文档](https://www.gate.com/docs/developers/apiv4/en/futures/)。

补偿只是近似：多仓 `1.01 × 0.99 = 0.9999`，空仓 `0.99 × 1.01 = 0.9999`，再加上价格步长舍入和滑点，不保证精确抵消回撤。固定保证金只消除保证金随行情变化引起的漂移；真实持仓均价或数量变化仍可能改变目标价。
