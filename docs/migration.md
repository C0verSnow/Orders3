# issue #31 迁移记录

## 审查基线

迁移基准为本分支父提交。仓库内没有 `.agents`、`AGENTS.md` 或子目录代理规则；遵守上级 `E:/git/AGENTS.md`。原 `package.json` 仅提供网页检查、纯 JavaScript 测试和 Supabase 导出，没有 React 或 Node 服务。旧前端是 `web/` 原生模块，Qt HttpServer 分发 qrc 资源；Windows 使用 WebEngine。旧 `src/` 包含配置、Cron、解析、HTTP/HMAC、SQLite、Dashboard、调度、遥测和原生窗口。审查了 README、现有业务文档、服务头文件与实现、数据库模式、现有测试和发布脚本。

## 迁移映射

| 原实现 | 新实现 | 必须保留的行为 |
| --- | --- | --- |
| core/config、Dashboard 配置 | server/config | INI environment > 进程环境 > .env；空输入保留，显式清除；Infisical 仅内存备用 |
| core/cron、scheduler | server/scheduler | 五段数字 Cron，本地时间，日/周 OR；不补跑；每分钟独立 Gate 更新 |
| fetcher 来源分页、order_parser | server/exchange、services | Supabase orders 分页完整后事务替换；显式空订单清理；失败保留旧快照 |
| gate_api、http_client | server/exchange、security | 完整路径、查询和真实 body 的 HMAC-SHA512；拒绝重定向；超时；不反射上游正文 |
| createTrailingOrders | server/services/trading | 按有符号数量/价格匹配；状态 1 可停，状态 2 保留；实际成交 7 天限制；每次写成功立即持久化 |
| closePositionOrders | server/services/trading | 固定保证金 3.1 倍毛收益；多 1.01 / 空 0.99；真实 tick 五成双；平仓按方向各保留一单 |
| storage | server/database | 原 records/orders/orderslist/position/history/margin/sync；事务；100 条历史；450 MB 数据库预算 |
| request_log、activity | server/services | 脱敏请求 JSONL；10 MB × 5；最近 64 个真实事件；无虚假进度 |
| web、ui、server | apps/web、server/api | React 工作台、列表、详情、设置、Cron、数据库下载、活动与错误；同源保护与服务端会话 |
| CMake、Qt 打包 | scripts、Actions、Docker | Node 服务、React 静态资源；原生两架构容器；Windows exe、两架构 deb |

## 精度边界与风险

业务输出统一 Decimal ROUND_HALF_UP 两位字符串；合约乘数、tick、原始输入和固定保证金保留原始精度，避免中间舍入。不能把 0.00001 的合约乘数四舍五入成零。旧公式在 tick 上使用 HALF_EVEN，仍先保留这一计算行为；若所得执行价格不能以两位小数无损表达，禁止整批交易并报告精度冲突。来源价格舍入改变交易意图时同样禁止提交，原值留在 records。数量须为整数张；API/页面可显示 2.00，发给交易所前仍校验整数语义。

旧系统无法保证跨轮询幂等。新实现记录每笔意图和未知状态，未知 POST 禁止自动重发；必须先查交易所列表并人工确认。这是安全增强。不要用真实账户做 CI 下单测试。

## 验证分类

- 已完成代码审查：上述功能基线与行为映射。
- 尚未执行：本地编译、构建及触发编译的测试，按用户约定禁止执行。
- 需要后续运行验证：React 视觉/可访问性、旧库迁移、Node SEA exe/deb、容器、交易所真实权限和协议。
- 发布完成以远端 Actions 成功且对应 SHA 的 Release/Package 实际存在为准；不能用脚本存在代替发布成功。
