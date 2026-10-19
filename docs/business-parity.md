# 业务迁移与验证边界

| 业务 | 旧基线 | 新实现 | 代码对照结果 |
| --- | --- | --- | --- |
| 来源抓取 | fetchSourceRecords / parseSupabaseOrders | exchange/supabase、source-parser | 直接 orders，短页继续，总数变动/重复页失败，显式 null 空订单，全部校验后事务保存 |
| 合约参数 | contractParameters | Gate.contract | 真实合约名、乘数、tick，新增最小/最大张数边界 |
| 开仓 | createTrailingOrders | trading.openOrders/reconcile | 保留有符号量/价格匹配；状态 1 可停，2 保留；reduce_only=false；原固定参数 |
| 持仓同步 | 旧平仓保护功能已取消 | positions.syncPositions | 每分钟及手动读取持仓和订单；不计算保护价、不生成/修改/停止保护单；已有 Gate 保护单由用户管理 |
| 成交历史 | syncEntryHistory | entry-history.syncEntries | 七天完整回看分页、独立成交身份去重、最新方向保存观察保证金、原子水位 |
| 7 天限制 | hasRecentEntry | Storage.recentEntry | 同合约同方向含 7 天边界；最多 100 条；加仓重新计时 |
| 保证金 | fixedEntryMargin | Storage.fixedMargin/history | 只在真实新入仓/加仓更新；旧仓初始化；行情不覆盖 |
| 定时 | Cron、Scheduler | scheduler | 本地时区，日/周 OR，周日 0/7，不补跑，Gate 每分钟独立运行 |
| 凭证 | Config、loadGateCredentials | config、credentials | 配置优先级、清除、本地优先、逐字段内存备用、失败重试及过期请求隔离 |
| 存储/日志 | storage、request_log | database、request-log | 事务、旧模式、目录预算、下载一致快照、脱敏轮换 |
| UI/API | web、Qt Server | React、Fastify | 列表、搜索排序详情、设置、Cron、活动、结果、下载；新增令牌会话保护 |

## 有意保留与安全变化

- 不把 side 文本当作反转数量方向的指令，不把提交成功当作真实入仓，不把激活价格说成成交价。
- 旧精度与新两位要求冲突时，不修改策略后下单：保留原值并禁止交易。超出两位的合法低价合约会被明确阻断；需用户后续确认业务规则才能启用这类场景。
- 原 C++ 未保证跨刷新幂等；新实现用持久化意图防止未知交易自动重发，并在开仓前先读真实 Gate 列表。人工核查仍不可省略；外部账户操作也可能改变交易状态。
- 原自动部署拉 latest，现改用已验证 SHA 对应镜像 digest，避免并发发布部署错版本。
- Windows 原生 Qt 窗口改为系统浏览器；macOS 可从源码/容器运行，本 issue 明确要求发布的产物为 Windows exe 和 Linux 两种 deb，不再发布 Qt macOS 包。

## 验证

源代码和原业务文档已逐项对照。`tests/node` 包含精度、签名固定向量、真实成交方向、7 天边界、旧库、预算回滚、部分 null、短页/总数、未知 POST、状态 2 保留、手工保护单保留、会话/Origin、凭证与脱敏回归。它们只使用测试夹具，不对真实账户操作。

构建、类型检查、测试、浏览器、exe/deb/容器启动必须以本 PR 最新提交的远端 Actions 结果为准。仅写好测试不代表通过。手机安全区、键盘和真实触感仍需要设备验证；CI 屏幕尺寸检查不能替代真机。真实 Gate 权限、限流和成交效果需要部署后的受控验收，CI 不做实盘试单。
