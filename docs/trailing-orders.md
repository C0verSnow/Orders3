# 自动追踪订单

`fetchTrailingOrders(config)` 读取一次 Gate 列表；Scheduler 每 60 秒独立调用，不受来源 Cron 启用开关影响。一次请求尚未结束或正在自动交易时不叠加请求，下次计时继续。`--list` 仍为单次读取；服务模式启动轮询，退出时取消网络请求并等待工作线程。

手动、定时和启动时的来源抓取成功保存后，都调用 `createTrailingOrders(config)`。无参数版本读取 `Config::load()`；使用页面最新配置的业务入口传入 config。函数读取 `orders` 和 `orderslist`，按以下顺序执行：

1. 校验整批参数。`371 Contracts` 转为字符串 `"371"`，`-371 contracts` 转为 `"-371"`；数量必须是非零整数张。`4071.29 USDT` 去单位并保留价格精度。时间戳为毫秒。
2. 同合约、数量同号且 `original_status=4` 的旧单，与来源单的时间差绝对值小于 `604800000` 毫秒时跳过。恰好 7 天不跳过；不按距当前时间判断。
3. 若有待创建订单，先停止列表中全部 `reduce_only=false` 且 `original_status` 为 1 或 2 的订单，包含其他合约；减仓单不会停止。全部来源单都跳过或没有来源单时不停止旧单。
4. 创建剩余订单：`reduce_only=false`；负数量 `is_gte=true`，正数量 `is_gte=false`。固定参数为 `price_type=3`、`price_offset="1%"`、`pos_margin_mode="cross"`、`position_mode="dual_plus"`、`text="apiv4"`。方向以 amount 的正负为准，不由 side 字段反转。

POST 使用完整 `/api/v4/...` 路径和实际发送的 JSON 字节进行 HMAC-SHA512 签名，禁止携带密钥跟随重定向。每次检查 HTTP 状态和业务 code。任意停止失败时不创建新单；任意创建失败时结束本批，不立即重试。此前已确认成功的操作逐项写回订单缓存，不撤销已执行的交易。新单以响应 ID、状态 1 写入本地，下次列表轮询以 Gate 返回状态校准。

重复抓取遵循上述状态 4 去重规则；未完成的开仓追踪单会被停止后重新创建。返回数组包含 `stopped`、`created`、`skipped`、`failed` 及合约、ID、错误等信息。页面每秒读取快照，展示抓取／下单阶段与逐项结果。自动下单不增加网页按钮。

网络中断或返回格式错误可能无法确认交易是否已在 Gate 执行；本批会结束并显示错误。函数不提供跨刷新或跨进程的交易幂等保证。

接口参考：[Gate 官方期货 API](https://www.gate.com/docs/developers/apiv4/en/futures/)。
