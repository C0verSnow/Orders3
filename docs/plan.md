测试方法: 使用E:\git\0AAimportant\c\orders3\docs\test\orders2\tests的类似测试方法.针对某些需要本地测试的工程.脚本.工作流

# 订单程序计划：想做、在做、做完、没做

依据：[5.md：大白话说明与 JSON 传递样例](5.md)。生产字段、接口契约与状态迁移以 [4.md](4.md) 为准。完整的十步 JSON 工作流、请求响应样例和存储骨架保留在 5.md，本计划将其整理为目标和可推进的任务。

状态说明：已核实的实现及测试依据列于“做完”。下文“没做”表示尚未确认完成、纳入待办，不断言现有代码完全没有实现；不能把模拟工作流中的成功状态当作项目完成证据。

## 四象限总览

| 想做：目标与交付方向 | 在做：已启动、尚未完成 |
| --- | --- |
| Windows / Linux TUI 自动订单程序；信号接收、开仓、总持仓平仓和重启恢复；原生发布包及 GHCR 镜像。 | 暂无可从 5.md 确认的实施中任务。 |

| 做完：有完成依据 | 没做：待实施或待核实 |
| --- | --- |
| 已有 5.md 流程说明和教学 JSON；已整理本四象限计划；已完成 M04 信号解析与校验、M01 停止接口 ID 转换、M02 严格 JSON 存储结构及 M05 按合约方向去重判定子项。 | 下列 M01–M15 剩余实施与验收任务。核查后按实际进度迁移。 |

## 一、想做

- **跨平台使用**：Windows 使用 `orders3.exe`，Linux 使用 `orders3`，打开后进入可用键盘操作的 TUI。
- **自动订单闭环**：读取 GitHub `size.txt` 信号，先处理旧开仓，再导入合格信号、发布追踪开仓、查询终态、按当前实际持仓安排追踪平仓并归档。
- **可靠恢复**：关键状态存入严格 JSON 格式的 `orderlist.js`，重启后继续处理未完成订单、发布意图及平仓任务。
- **可观察、可确认**：界面展示五类订单分组、调度进度、任务、错误和待核实原因，每次启动确认自动交易。
- **可直接交付**：提供原生可执行发布包和 `ghcr.io/<owner>/orders3:<version>` 容器镜像，附依赖、配置、启动和恢复说明。

## 二、在做

暂无已确认的实施中任务。任务实际启动后，将对应 M 编号条目从“没做”移到这里，并记录当前进度及阻塞原因。

## 三、做完

- [x] 已有 [5.md](5.md)：程序行为、十步教学 JSON 工作流、数据传递、存储变化、计算规则及异常处理说明。完成范围仅限文档，不代表功能已实现。
- [x] 将 5.md 整理为本四象限计划，保留原始说明和规范链接。

### M01 数据模型与接口边界（已完成子项）

- [x] 交易所原始字段遵循自身类型约定；停止接口 `body.id` 为 JSON 整数，适配器做范围校验和无损转换，不经浮点数中转。
  - 实现：[stop_request.hpp](../src/stop_request.hpp) 的 `orders3::make_stop_request` 接收本地字符串 ID，生成 4.md 第 5.3 节的 HTTP 请求描述；本地 ID 不修改。适配器支持范围明确限定为 `1..9223372036854775807`，不宣称这是交易所最大值；允许前导零，拒绝非字符串、零、符号、空白、小数、指数及溢出。错误通过 `StopRequestError::as_json()` 提供 code、field 和 retryable。
  - 验证：2026-09-30，Windows / MinGW g++，参考 `docs/test/orders2/tests` 的离线请求契约和非法输入测试方式，运行 [stop_request.cpp](../checks/stop_request.cpp)。规范请求样例、最小值、超过 double 精确范围的 `9007199254740993`、int64 最大值及序列化往返通过，21 组非法输入全部拒绝。
  - 复现（项目根目录，先确保 `test` 目录存在）：`g++ -std=c++17 -Wall -Wextra -Werror checks/stop_request.cpp -o test/stop_request_check.exe`，再运行 `./test/stop_request_check.exe`。依赖 nlohmann/json。
  - 范围：仅完成停止请求构造与 ID 转换；尚未接入 HTTP 发送、停止后核实或调度流程，未访问网络或交易所，未验证 Linux。

### M02 本地存储与原子提交（已完成子项）

- [x] 实现 `orderlist.js` 严格 JSON 结构：最外层为单对象数组，保留 `schema_version`、`revision`、`last timestamp`。
  - 实现：[storage_schema.hpp](../src/storage_schema.hpp) 提供 `make_empty_store`、`validate_store`、`parse_store`，按照 4.md 第 6 节生成 v1 骨架；版本限定为 1，revision 与 last timestamp 为非负 int64 范围 JSON 整数，初值为 0，五类订单分组与五类恢复集合必须为数组。拒绝旧格式、重复对象键、注释、尾随内容、缺字段和非法类型，不自动用空数据替代输入。
  - 验证：2026-09-30，Windows / MinGW g++，参考 `docs/test/orders2/tests/test_getorder.py` 的离线正常与非法输入测试方式，运行 [storage_schema.cpp](../checks/storage_schema.cpp)。空骨架、含记录数据、int64 最大 revision 与超过 double 精确范围的时间整数无损往返通过，61 组非法文档全部拒绝。
  - 复现（项目根目录，先确保 `test` 目录存在）：`g++ -std=c++17 -Wall -Wextra -Werror checks/storage_schema.cpp -o test/storage_schema_check.exe`，再运行 `./test/storage_schema_check.exe`。依赖 nlohmann/json。
  - 范围：仅完成存储外层结构及内存解析校验；未实现记录内部业务校验、文件读写、原子提交、旧数据迁移或启动接入。现有旧格式 `orderlist.js` 保持原样，不能直接通过 v1 校验；未访问交易所，未验证 Linux。

### M04 信号刷新、批次与延迟处理（已完成子项）

- [x] 解析合约、方向、价格、数量和批次时间，检查信号完整性与重复目标。
  - 实现：[fetchorders.cpp](../src/fetchorders.cpp) 的 `parse_orders` 校验五个必填字段、正价格、非零整数数量和唯一正整数毫秒时间；只接收开仓信号并检查 Side/Size 一致性。同批次重复 Contract + Side 整批报 `DUPLICATE_TARGET`，同合约多空独立。
  - 验证：2026-09-30，Windows / MinGW g++，参考 `docs/test/orders2/tests/test_getorder.py` 的离线样例和非法输入测试方式，运行 [signal_parser.cpp](../checks/signal_parser.cpp)。正常单目标、多空及不同合约通过，38 组无效批次全部拒绝；未访问网络或交易所。
  - 复现（项目根目录，先确保 `test` 目录存在）：`g++ -std=c++17 -Wall -Wextra -Werror checks/signal_parser.cpp -lcurl -o test/signal_parser_check.exe`，再运行 `./test/signal_parser_check.exe`。依赖 libcurl 与 nlohmann/json；Linux 可使用同一命令。
  - 范围：仅完成解析校验，未完成 M04 的停止旧单、批次消费、延迟处理及替代流程；尚未验证 Linux、发布包或 GHCR。

### M05 七天去重（已完成子项）

- [x] 从 detail 的 `data.order.finish_time` 计算，保存原值、单位及转换后的毫秒时间到可持久化记录；满 `604800000` 毫秒才允许同目标新开仓。
  - 实现：[dedupe_time.hpp](../src/dedupe_time.hpp) 的 `with_dedupe_time` 返回保留原记录字段的副本，将字段路径、`raw_value`、单位写入 `dedupe_time_source`，按明确的 seconds 契约转换为 int64 毫秒，不经过浮点数、不猜测单位。缺失、零、未来、非法类型或格式、溢出和不符契约的单位均将 `dedupe_at_ms` 置 null，交由现有去重函数阻断；保留终态和平仓需求，不回退到其他时间字段。
  - 验证：2026-09-30，Windows / MinGW g++，参考 `docs/test/orders2/tests/test_getorder.py` 的离线样例与非法输入测试方式，[dedupe_time.cpp](../checks/dedupe_time.cpp) 的 162 项检查通过，覆盖 success / partial_canceled、原值与单位保存、v1 存储 JSON 序列化往返后去重、七天前与恰满七天、异常输入、前导零及 int64 乘法边界。
  - 复现（项目根目录，先确保 `test` 目录存在）：`g++ -std=c++17 -Wall -Wextra -Werror checks/dedupe_time.cpp -o test/dedupe_time_check.exe`，再运行 `./test/dedupe_time_check.exe`。依赖 nlohmann/json。
  - 范围：完成时间适配、可持久化记录与现有去重判定的离线衔接；调用方须先核实 detail 身份与终态。尚未接入 HTTP 查询、调度及文件原子提交，不代表已经完成磁盘持久化；未访问交易所，未验证 Linux。

- [x] 按合约和方向分别去重，成功开仓及部分成交后取消的历史进入去重，确认零成交取消不进入。
  - 实现：[open_dedupe.hpp](../src/open_dedupe.hpp) 的 `check_open_dedupe` 读取已标准化的开仓历史，按 `Contract` 与 `position_side` 匹配；`success` 和 `partial_canceled` 在七天内返回 skipped / DEDUPE_7D，恰满 `604800000` 毫秒放行，`canceled_no_fill` 不参与。缺失、零、未来或非法时间返回 deferred / FINISH_TIME_INVALID，未知终态返回 deferred / EXECUTION_INCOMPLETE；多条历史中的待核实优先，不受记录顺序影响。函数只读，不删除历史或修改平仓需求。
  - 验证：2026-09-30，Windows / MinGW g++，参考 `docs/test/orders2/tests/test_getorder.py` 的离线正常与非法输入测试方式，运行 [open_dedupe.cpp](../checks/open_dedupe.cpp)。41 项判定及 5 项非法输入测试通过，覆盖两类成交终态、零成交取消、七天前后边界、多空和合约隔离、多条历史、异常时间、int64 边界及输入不变性。
  - 复现（项目根目录，先确保 `test` 目录存在）：`g++ -std=c++17 -Wall -Wextra -Werror checks/open_dedupe.cpp -o test/open_dedupe_check.exe`，再运行 `./test/open_dedupe_check.exe`。依赖 nlohmann/json。
  - 范围：仅完成独立去重判定，输入终态须由调用方先核实；尚未接入信号刷新、发布前检查、detail 时间转换与来源持久化、平仓调度或存盘。其余 M05 子项保留待办；未访问网络或交易所，未验证 Linux。

### M09 平仓计算与请求校验（已完成子项）

- [x] 多仓 `V_adjusted=V`，空仓 `V_adjusted=-V`，保留 V 原符号；`target_raw=E×(1+3.1×M/V_adjusted)`，多仓再乘 1.01，空仓再乘 0.99。
  - 实现：[close_formula.hpp](../src/close_formula.hpp) 的 `calculate_close_formula` 复用同一持仓快照校验，使用十进制字符串整数运算计算精确有理数，不经过浮点数、不取 V 的绝对值。返回原快照、保留精度的 `value_adjusted` 及 `target_raw` / `target` 的分子分母；分母为正，分数不要求约分，循环小数也不截断。非正结果抛出字段为 target_raw 的 `CloseSnapshotError`，输入保持不变。
  - 验证：2026-09-30，Windows / MinGW g++，参考 `docs/test/orders2/tests/test_getorder.py` 的离线样例与非法输入测试方式，[close_formula.cpp](../checks/close_formula.cpp) 的 418 项检查通过，覆盖多空与 V 正负的四种组合、独立整数公式对照、零保证金、非正结果、十进制尾零、超过 double 精确范围的大数、400 位小数及非法输入；原有 close_snapshot 的 153 项检查回归通过。规范样例得到精确结果：多仓 104.131、空仓 95.931。
  - 复现（项目根目录，先确保 `test` 目录存在）：`g++ -std=c++17 -Wall -Wextra -Werror checks/close_formula.cpp -o test/close_formula_check.exe`，再运行 `./test/close_formula_check.exe`。依赖 nlohmann/json，无新增第三方依赖。
  - 范围：仅完成公式计算与原始结果正值校验；精确分数是内部计算值，不能直接当作 HTTP 激活价或生产持久化字段。调用方须先核实持仓身份和模式；来源 trigger_price 校验、ROUND_HALF_UP、取整后正值校验、请求接入与任务持久化仍待实现。未访问交易所，未验证 Linux。

- [x] 平仓 `amount=-S`、`reduce_only=true`，按方向配置请求；追踪 `price_offset="1%"` 与公式乘数独立。
  - 实现：[close_request.hpp](../src/close_request.hpp) 的 `make_close_request` 复用同一持仓快照校验，以字符串增删负号生成 amount，不经过浮点数；平多 is_gte=true、平空 is_gte=false，固定 reduce_only=true、price_type=3、price_offset="1%"、cross / dual_plus 和 text=apiv4。激活价须为正十进制字符串，保留尾零及精度，返回 4.md 第 5.2 节的 HTTP 请求描述。
  - 验证：2026-09-30，Windows / MinGW g++，参考 `docs/test/orders2/tests/test_getorder.py` 的离线样例与非法输入测试方式，[close_request.cpp](../checks/close_request.cpp) 的 124 项检查通过，覆盖规范多空请求、超出 double 精确范围及极小数量、尾零保留、JSON 往返、方向不符、零数量、非法价格、缺失快照字段与输入不变性；原有 close_snapshot 的 153 项检查回归通过。
  - 复现（项目根目录，先确保 `test` 目录存在）：`g++ -std=c++17 -Wall -Wextra -Werror checks/close_request.cpp -o test/close_request_check.exe`，再运行 `./test/close_request_check.exe`。依赖 nlohmann/json。
  - 范围：仅完成平仓请求构造及边界校验；调用方须先唯一匹配持仓身份和账户模式，并完成来源价格校验、公式计算和取整。本函数接收已计算激活价，不证明公式已实现；尚未接入发布意图、HTTP 发送、调度或存盘，未访问交易所，未验证 Linux。

- [x] 使用同一持仓快照中的 E（entry_price）、V（value）、M（initial_margin）、S（size）；要求 E>0、V≠0、M≥0、S≠0 且方向正确。
  - 实现：[close_snapshot.hpp](../src/close_snapshot.hpp) 的 `validate_close_snapshot` 从单个已标准化 Position 对象读取四个十进制字符串，返回保留原始字符、精度和 V 符号的快照；逐位判断正负及零值，不经过浮点数。LONG 要求 S>0，SHORT 要求 S<0；缺字段、非字符串、非法十进制格式及不满足约束的值抛出携带字段名的 `CloseSnapshotError`，输入保持不变。
  - 验证：2026-09-30，Windows / MinGW g++，参考 `docs/test/orders2/tests/test_getorder.py` 的离线正常与非法输入测试方式，[close_snapshot.cpp](../checks/close_snapshot.cpp) 的 153 项检查通过，覆盖多空方向、正负 V、零保证金、负零、缺字段、非法类型与格式、超出 double 精确范围及极小十进制数、尾零保留、JSON 往返及输入不变性。
  - 复现（项目根目录，先确保 `test` 目录存在）：`g++ -std=c++17 -Wall -Wextra -Werror checks/close_snapshot.cpp -o test/close_snapshot_check.exe`，再运行 `./test/close_snapshot_check.exe`。依赖 nlohmann/json。
  - 范围：仅完成标准化快照的独立校验；调用方须先唯一匹配合约、方向和账户模式，并将交易所原始数值无损标准化。未接入持仓查询、公式计算、任务调度或存盘；S=0 返回校验错误，不据此自动完成任务。未访问交易所，未验证 Linux。

## 四、没做

以下任务均待实施或核实。建议按 M01–M10 建立核心流程，结合 M11–M13 完善恢复与交互，再完成 M14–M15 交付验收。

### M01 数据模型与接口边界

- [ ] 区分本地 request / response、交易所 HTTP 请求响应及持久化记录；只发送 HTTP 描述中的 body，`body=null` 表示不发送请求体。
- [ ] 本地订单 ID、价格、金额和数量使用字符串，时间使用 UTC 毫秒整数，未知值用 `null`；初始 `last timestamp=0` 表示尚未消费批次。
- 停止接口 ID 转换子项已移至“三、做完”的 M01 条目。
- [ ] 明确 `batch_id`、`record_id`、`request_id`、`intent_id`、`task_id` 与交易所订单 ID 的关联；按 `target_key=合约:方向` 串行修改。
- [ ] 沿用单账户、USDT、`cross`、`dual_plus` 范围；教学字段 `steps`、`pass_to_next`、`store_effect` 不直接进入生产协议。

### M02 本地存储与原子提交

- 严格 JSON 存储结构子项已移至“三、做完”的 M02 条目。
- [ ] 保存五类分组：`raw orders`、`pending open orders`、`finished open orders`、`pending close orders`、`finished close orders`。
- [ ] 保存 `batches`、`publish_intents`、`close_tasks`、`terminal_history`、`workflow_runs`。
- [ ] 记录转组时保持唯一归属；平仓结束后保留开仓历史，供七天去重和来源追溯。
- [ ] 每次可靠提交检查并更新 `revision`；交易所 ID、意图状态、订单转组等关联变更一起保存。
- [ ] 文件损坏不以空文件覆盖；存盘失败停止后续改变交易所状态的请求，恢复后先对账。恢复依据是存储文件，日志不能替代。

### M03 启动与独立调度

- [ ] 启动加载并校验存储，恢复待处理订单、任务及未决发布意图；每次启动在 TUI 确认自动交易。
- [ ] 信号刷新与每 60 秒的状态查询分别调度；信号下载失败不停止已有订单查询。
- [ ] 状态调度同时恢复延迟信号和未完成平仓安排，不必等待新信号。
- [ ] 同一目标串行处理，某目标待核实不无限阻塞其他目标。

### M04 信号刷新、批次与延迟处理

- [ ] 每轮先停止并核实旧待开仓委托，再下载 GitHub `size.txt`；重复批次或下载失败不撤销已经发生的停止操作。
- 信号解析与校验子项已移至“三、做完”的 M04 条目，其余子项如下。
- [ ] 原子保存新批次的接收、跳过、延迟决定及 `last timestamp`；全部被去重也消费批次，相同批次不重复导入，旧批次不倒序处理。
- [ ] 旧单未核实等原因导致的信号保留在 raw 组，记录 deferred 及原因，只阻断对应目标的新开仓。
- [ ] 延迟信号恢复前检查是否已被新批次替代，重新执行去重和发布前校验。
- [ ] 新批次只替代确认尚未发送的旧 raw 信号，归档原因；已有 prepared 意图须核实未发送并阻止后续发送。dispatching / unknown 保留并先对账，替代与发送串行。

### M05 七天去重

- 按合约和方向分别去重子项已移至“三、做完”的 M05 条目。
- detail 时间转换与来源记录子项已移至“三、做完”的 M05 条目；文件可靠提交仍由 M02 待办覆盖。
- [ ] 时间缺失、为零或在未来时保留已确认历史和平仓需求，阻断同目标新开仓；平仓证据和计算字段齐全时继续安排。

### M06 开仓意图与发布

- [ ] 合格信号先保存 raw 记录，再通过 `open.publish(input.record_id)` 读取数据并生成请求。
- [ ] Size 正数开多、负数开空，amount 保留正负号；发布前检查数量限制、账户模式等条件。
- [ ] 保存确切请求及稳定关联，依次可靠提交 prepared、dispatching 后才发送。
- [ ] 收到可靠 ID 后原子保存 acknowledged、交易所 ID，并转入待开仓组；创建成功不等于成交成功。
- [ ] detail 暂时失败继续查询原 ID，不重新创建；`request_id` 和 `text="apiv4"` 不作为交易所幂等凭据。

### M07 开仓查询、成交证据与归档

- [ ] detail 状态 1 / 2 继续等待，状态 3 部分成交继续查询至结束，暂不发布平仓。
- [ ] 校验成功终态、身份及模式，保存 `trigger_price`、时间来源和历史，生成待平仓需求；没有独立证据的单笔成交量仍记 `null`。
- [ ] 状态 5 区分 canceled_no_fill 与 partial_canceled；后者启动去重并安排平仓。
- [ ] 取消单成交不明时保留待核实，不把已有持仓当作本单成交证据；证据充分性按具体操作判断。

### M08 平仓安排与旧单撤换

- [ ] 由新的、已结束且有成交的开仓来源触发 `close.plan`，建立任务并关联来源；价格或保证金变化不单独触发重排。
- [ ] 查询并唯一匹配实际 Position、方向和模式，以当前该方向总持仓安排平仓，不仅处理本次新增数量。
- [ ] 有旧平仓时先停止、核实，再重新查询剩余仓位；结果不明停在 `reconciling_previous`，不发布替代单。
- [ ] 合并来源、覆盖来源及被替代任务的关联；S=0 时核实仓位变化原因后结束任务，不计算或创建零数量单。

### M09 平仓计算与请求校验

- 同一持仓快照字段校验子项已移至“三、做完”的 M09 条目。
- 多空精确公式计算子项已移至“三、做完”的 M09 条目。
- [ ] 取全部覆盖来源 `trigger_price` 的最大小数位数，包含字符串尾零，使用 `ROUND_HALF_UP`；原始结果及取整后价格均须为正。
- [ ] trigger_price 缺失或非正时保留任务与阻塞原因，不用原信号价替代；按规范不额外调整价格步长。
- 平仓数量、方向和追踪请求配置子项已移至“三、做完”的 M09 条目。
- [ ] 用原文样例核对：多仓激活价 `104.13`、amount `-10`；对应空仓激活价 `95.93`、amount `10`。实际生产计算以 4.md 为准。

### M10 平仓发布、查询与完成

- [ ] 发送前分配稳定的平仓 `record_id`，关联任务、发布意图及确切请求，依次保存 prepared、dispatching。
- [ ] 可靠回执后，在同一次提交中创建带交易所 ID 的待平仓记录，更新意图和任务为 acknowledged / active。
- [ ] 查询使用平仓 ID；核实 detail 成功状态及任务关联后归档并完成任务，同时查询 Position 记录当前持仓。
- [ ] 发布后 covered_quantity 固定；后来新增仓位不修改原单覆盖数量，也不因账户仍有仓位直接否定原单成功。
- [ ] 精确已平量和剩余量须有可归因证据；保存订单状态、前后仓位及必要成交来源，不能排除其他操作影响时仍记 `null`，不直接填覆盖量或零。

### M11 创建结果不明与重启对账

- [ ] 发送后超时、无可靠回执或 dispatching 时崩溃，按 unknown 恢复，禁止直接重发创建请求。
- [ ] 通过 list 找候选、detail 确认、Position 核对；只有唯一且证据一致才能找回交易所 ID，第一页未找到或仓位未变不能证明未发送。
- [ ] 找回后沿用原 record_id、意图及任务完成关联，避免重复下单。
- [ ] unknown 响应保留错误、意图和 reconcile 下一步；`retryable=false` 只禁止直接重发创建，仍可继续只读核实。

### M12 平仓拒绝、取消与后续恢复

- [ ] 旧平仓已停、新发布被明确拒绝时，任务保留或恢复 required，保存错误，下一轮状态调度恢复原 task_id。
- [ ] 重试重新查询持仓、计算和验证，保留旧意图，为新尝试记录新意图；仍按 prepared、dispatching 顺序可靠提交。
- [ ] 条件不足保留原因，结果不明先对账；已成功发布、后来取消的平仓单核实后归档，未满足需求记 `canceled_unfulfilled`，不自动补发。
- [ ] `canceled_unfulfilled` 只有后续新的合格开仓来源才可再次触发总持仓平仓安排。

### M13 TUI 操作与退出

- [ ] 展示五类订单、任务、调度进度、错误及待核实原因，界面刷新不影响后台调度。
- [ ] 每次启动确认自动交易；无交互终端或未确认时不得自动开始，容器同样适用。
- [ ] 退出保存进度并恢复终端显示；界面和说明明确退出不代表交易所委托已撤销。

### M14 原生发布包与 GHCR 镜像

- [ ] 构建 Windows、Linux 可执行发布包，附必要依赖、配置示例、启动说明、支持的系统版本和 CPU 架构。
- [ ] 构建 Linux 容器镜像并发布 GHCR，提供真实版本地址及摘要；原生发布包提供获取位置和校验值。
- [ ] 说明 `docker run -it` 交互运行方式，Windows 使用镜像需要 Linux 容器环境。
- [ ] 挂载持久数据目录并设置 storage_path；配置和密钥运行时提供，不放进镜像；避免本机与容器同时操作同一恢复文件。

### M15 模拟验收与完成依据

- [ ] 使用模拟接口和测试数据验证信号 → 开仓 → 终态 → 总持仓平仓 → 归档的完整链路及关键原子提交。
- [ ] 覆盖重复/旧批次、七天边界、延迟信号替代、多空区分、部分成交取消、时间或价格缺失等分支。
- [ ] 覆盖发布超时、重启对账、旧平仓停止不明、明确拒绝重试、取消不自动补发、存盘失败与文件损坏等分支。
- [ ] 分别在 Windows、Linux、容器验证界面操作、启动确认、状态刷新和重启恢复。
- [ ] 验证从 GHCR 拉取镜像、重建容器后恢复挂载数据；记录实际测试结果、发布位置、版本与校验信息作为完成依据。

任务维护规则：准备实施的具体事项列入“没做”，实际启动后移入“在做”，满足验收条件并补充依据后移入“做完”；新的目标先列入“想做”，再拆分为任务。各任务保留 M 编号便于追踪。
