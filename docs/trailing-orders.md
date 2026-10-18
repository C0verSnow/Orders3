> 迁移说明：本文保留旧业务规则作为基线。当前实现已改为 Node.js/TypeScript；函数映射和两位精度阻断见 [业务对照](business-parity.md)。旧 C++ 文件名仅供 Git 历史查阅，旧 UI 展示位数以新两位规则为准。

# 自动追踪订单

`fetchTrailingOrders(config)` 读取一次 Gate 列表；服务模式下 Scheduler 每 60 秒独立调用持仓与平仓更新流程，不受来源 Cron 启用开关影响，具体见 [自动平仓追踪单](close-position-orders.md)。一次请求尚未结束或正在自动交易时不叠加请求，下次计时继续。`--list` 仍为单次读取；退出时取消网络请求并等待工作线程。

手动、定时和启动时的来源抓取成功保存后，都调用 `createTrailingOrders(config)`。无参数版本读取 `Config::load()`；使用页面最新配置的业务入口传入 config。函数读取 `orders` 和 `orderslist`，按以下顺序执行：

1. 校验整批参数。`371 Contracts` 转为字符串 `"371"`，`-371 contracts` 转为 `"-371"`；数量必须是非零整数张。`4071.29 USDT` 去单位并保留价格精度。时间戳为毫秒。
2. 与 `reduce_only=false` 且状态为 1 或 2 的有效开仓单逐笔匹配。合约、方向、数量、激活价格相同则保留，返回 `skipped`。方向由数量正负表示，价格按精确十进制值比较，每个旧单最多匹配一笔来源单。
3. 有待创建订单时，先读取真实成交历史并原子保存；读取失败就暂停本批，不停止或提交订单。历史来自实际成交，不再比较旧订单和来源单的 timestamp 差值。
4. 仅停止未匹配且状态为 1 的旧开仓单；状态 2、平仓单、已完成订单和匹配成功的开仓单保留。来源为空时只清理状态 1，不创建。

5. 每一笔实际提交前再次同步成交历史，查询最近 7 天同合约、同方向的实际入仓记录（含边界），命中就跳过。允许的未匹配订单才创建：`reduce_only=false`；负数量 `is_gte=true`，正数量 `is_gte=false`。固定参数为 `price_type=3`、`price_offset="1%"`、`pos_margin_mode="cross"`、`position_mode="dual_plus"`、`text="apiv4"`。方向以 amount 的正负为准，不由 side 字段反转。

POST 使用完整 `/api/v4/...` 路径和实际发送的 JSON 字节进行 HMAC-SHA512 签名，禁止携带密钥跟随重定向。每次检查 HTTP 状态和业务 code。任意停止失败时不创建新单；任意创建失败时结束本批，不立即重试。此前已确认成功的操作逐项写回订单缓存，不撤销已执行的交易。新单以响应 ID、状态 1 写入本地，下次列表轮询以 Gate 返回状态校准。

重复抓取遵循 [真实入仓历史规则](position-entry-history.md) 与有效单参数匹配规则；参数不变的有效开仓单继续保留。开仓仍按来源 Cron 配置抓取，不改为固定每分钟执行。返回数组包含 `stopped`、`created`、`skipped`、`failed` 及合约、ID、错误等信息。页面每秒读取快照，展示抓取／下单阶段与逐项结果。自动下单不增加网页按钮。

网络中断或返回格式错误可能无法确认交易是否已在 Gate 执行；本批会结束并显示错误。函数不提供跨刷新或跨进程的交易幂等保证。

接口参考：[Gate 官方期货 API](https://www.gate.com/docs/developers/apiv4/en/futures/)。
