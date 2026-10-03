# SQLite 数据格式

`records` 保存来源记录：`position` 表示顺序，`url`、`created_at`、`status_code`、`error`、`data` 为独立列。文本内容直接存入 `data`；结构化内容以 JSON 字符串保存，由 `data_format` 区分。`extra_json` 保留额外字段，`present_fields` 区分缺失字段和空值。

`orders` 通过 `record_position` 关联来源，`order_index` 保存来源内的订单顺序；`symbol`、`price`、`side`、`size`、`value`、`orders_time` 为独立列。价格、数量和金额以文本保留精度及单位，订单时间保留原始值。

```sql
SELECT r.url, o.symbol, o.price, o.side, o.size, o.value, o.orders_time
FROM orders AS o
JOIN records AS r ON r.position = o.record_position
ORDER BY o.record_position, o.order_index;
```

HTTP `/api/data` 返回来源记录、订单行、更新时间和刷新错误。旧版 `record_json` 数据库仍可读取；刷新后通过 SQLite 事务更新为当前表结构，失败时回滚。数据库下载通过 `/api/download` 生成一致快照。
