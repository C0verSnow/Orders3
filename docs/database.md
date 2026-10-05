# SQLite 数据格式

来源记录和 Gate 跟踪订单共用 `data/data.db`。`records` 保存 Supabase orders 表的完整记录，`orders` 保存直接提取的订单字段，`orderslist` 保存 Gate 跟踪订单。两种刷新分别在事务中更新自己的表，不会清空另一种数据；下载数据库也包含这三张表。

`records` 保存来源记录：`position` 表示顺序，`url`、`created_at`、`status_code`、`error`、`data` 为独立列。文本内容直接存入 `data`；结构化内容以 JSON 字符串保存，由 `data_format` 区分。`extra_json` 保留额外字段，`present_fields` 区分缺失字段和空值。

`orders` 通过 `record_position` 关联来源，每条 Supabase 订单对应一条 `records` 和一条 `orders`，`order_index` 为 0（旧缓存仍保留来源内的订单顺序）；业务列为 `contract`、`activation_price`、`side`、`amount`、`timestamp`。字段名称与 `orderslist` 一致，并保留来源订单的 `side`；不再保存 `value`。价格和数量以文本保留精度及单位，`timestamp` 与 `orderslist` 一样为整数时间戳（毫秒），缺失或无效时为 NULL。`core/order_parser.cpp` 中的 `parseSupabaseOrders()` 校验 orders 表记录并保护数字精度；`parseOrderRecord()` 直接提取业务字段。旧 `parseOrders()` 仅用于兼容旧文本缓存。`id`、`value` 等原始字段保存在 `records.extra_json`，不作为自动下单参数。读取旧缓存时转换为新字段，下次成功抓取会重建为新表结构。

```sql
SELECT r.url, o.contract, o.activation_price, o.side, o.amount, o.timestamp
FROM orders AS o
JOIN records AS r ON r.position = o.record_position
ORDER BY o.record_position, o.order_index;
```

HTTP `/api/data` 返回来源记录、订单行、更新时间和刷新错误。旧版 `record_json` 数据库仍可读取；刷新后通过 SQLite 事务更新为当前表结构，失败时回滚。数据库下载通过 `/api/download` 生成一致快照。

`orderslist` 由 `fetchTrailingOrders()` 获取数据，`Dashboard::refreshOrders()` 调用 `saveTrailingOrders()` 保存，`readTrailingOrders()` 读取。字段为 `id`（主键）、`contract`、`amount`、`activation_price`、`reduce_only`、`original_status`、`timestamp`。价格和数量以文本保留精度，`reduce_only` 为 0 或 1。HTTP `/api/orders` 返回这张表的数据。成功刷新会替换整张 `orderslist` 表的数据，失败则保留之前的内容。

```sql
SELECT * FROM orderslist ORDER BY id;
```
