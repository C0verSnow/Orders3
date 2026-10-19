# SQLite 数据兼容

Node 使用内置 `node:sqlite`（无第三方原生扩展）。旧库直接打开，schema 升级在事务中增加列和表。请先备份并停止旧进程；不要让旧程序与新程序共享运行中的数据目录。

| 表 | 用途与迁移 |
| --- | --- |
| records | 兼容旧 record_json 与结构化 extra_json/present_fields。保留缺失/null、原始数字和额外字段 |
| orders | 来源成功刷新后事务重建；结构化字段为两位字符串，新增 raw_activation_price/raw_amount。旧 symbol/price/size/orders_time 读取时映射 |
| orderslist | 保留 id/contract/amount/activation_price/reduce_only/original_status/timestamp；新增原始价格/数量。旧 trigger_price 仅作为旧字段，不冒充激活价；下次完整刷新替换 |
| position | 保留旧字段并补合约乘数和 tick；同合约多空分别保存；展示/业务结果两位字符串，size 仍按 INTEGER 保存以兼容旧库 |
| raw_positions | 对应当前持仓的完整上游原始记录，保留实际精度 |
| position_entry_history | 原 owner:trade_id 去重、UTC 毫秒、方向、原始固定保证金；最多 100 条 |
| position_entry_seen | 独立保留七天成交身份；展示历史裁剪后仍去重，允许补入水位前的迟到成交 |
| position_entry_sync | 每个 Key SHA256 摘要的进度，与历史同事务提交 |
| position_entry_margin | 按 owner/合约/方向保留最新真实入仓固定保证金；历史清理不清此表 |
| snapshots | sources、trailing、positions 各自成功保存时间；旧 orders 字段保留兼容，不代表完整快照 |
| trade_intents | 写前 pending，响应与缓存确认后 confirmed，失败 unknown；新增 owner 原Key指纹、request_id、review_evidence。人工核查必须恢复原凭证并提供依据；旧无身份记录不在线解除 |

旧 managed_close_orders 和其他无关表不主动删除。来源事务只替换 records/orders；Gate 更新只替换 orderslist；持仓更新只替换 position/raw_positions。任何事务失败回滚；来源网络/字段失败不进入保存。历史分页失败不推进水位，失败不新开仓。

固定保证金不在行情变化、纯减仓、杠杆/保证金调整时覆盖。新真实入仓、加仓、反手新方向更新固定值；旧持仓首次读取初始化，不伪造历史或重设 7 天时间。保留原始保证金用于内部计算，只有结果/API 规范化为两位。

每次 BEGIN IMMEDIATE 后，统计同目录 SQLite 文件（扩展名或文件头），含旧库 WAL 已提交页的最终主文件需求，设置向下取整 max_page_count，合计预算 450,000,000 字节。超限仍可读和下载，写入拒绝。目录级进程租约防止多个新服务在额度检查间并发写入；外部直接写库不在保证范围内。

下载使用 `VACUUM INTO`，包含已提交 WAL 内容，不直接复制正在使用的主文件。临时快照、日志轮换、WAL/SHM 不计主文件预算，需预留额外磁盘空间。
