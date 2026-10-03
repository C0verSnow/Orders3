# 本地订单数据看板

从 Supabase 读取来源 URL，抓取内容并写入 SQLite，再通过本机网页展示订单、搜索筛选、刷新和数据库下载。支持 Python 3.10+；C++17 启动器为可选入口。

## 安装与启动

在仓库根目录运行（PowerShell）：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e .
.\.venv\Scripts\python.exe -m orders_dashboard --cached
```

默认由系统自动分配空闲端口，并自动打开浏览器；实际地址会显示在终端中，例如 `http://127.0.0.1:53124`。无需传入端口参数；`--port 8090` 可手动指定端口，`--port 0` 表示自动分配。`--cached` 展示已有缓存；去掉该参数会在启动时抓取远程来源。Ctrl+C 停止服务。

无需安装本项目时，可先 `python -m pip install -r requirements.txt`，再执行 `python scripts/run.py --cached`。

```powershell
python scripts/run.py --port 8090 --no-browser
python scripts/run.py --fetch-only
python scripts/run.py "D:\my data\results.db" --cached
```

可用输出后缀为 `.db`、`.sqlite`、`.sqlite3`。程序只持久化 SQLite；网页下载按钮直接下载数据库，不生成 `data.json`。HTTP API 和数据库中的结构化字段仍使用 JSON 编码。

## 目录与职责

```text
src/orders_dashboard/
  config.py       环境配置、默认数据路径和输出校验
  fetcher.py      来源分页读取与 HTTP 抓取
  parser.py       订单文本解析
  storage.py      SQLite 原子写入与旧数据库读取
  dashboard.py    刷新并发控制和数据快照
  server.py       本地 API 与静态资源白名单
  cli.py          参数解析与启动流程
  web/            HTML、CSS、JavaScript、SVG
native/
  launcher.cpp    程序入口，只调用统一启动接口
  launcher.hpp    启动接口 orders::launch 声明
  main.cpp        集中实现参数调度、Python 进程调用及功能函数
  main.hpp        功能接口 orders::frequency / orders::list 声明
scripts/          启动、构建与测试脚本
tests/            自动化回归测试
docs/             数据格式、迁移说明及旧文档
data/             本地运行数据（不纳入版本控制）
build/            C++ 构建产物（不纳入版本控制）
```

Python 包同时提供 `orders-dashboard` 命令和 `python -m orders_dashboard` 入口；网页资源会随安装包分发。

## 配置与数据

启动时自动读取项目根目录的 `.env` 文件，其中配置 `SUPABASE_URL`、`SUPABASE_ANON_KEY`；已有环境变量优先于 `.env`。`ORDERS_DATA_DIR` 可指定缓存目录。配置格式参考 `.env.example`。

源码运行默认使用仓库的 `data/data.db`；普通安装包默认使用用户目录下的 `.orders-dashboard/data.db`。命令行输出路径优先于环境配置。旧数据库结构可直接读取，下次抓取会写入当前表结构。抓取失败时保留已有数据库。

字段和 SQL 查询示例见 [数据库说明](docs/database.md)，目录变更见 [迁移说明](docs/migration.md)。

## Cron 定时抓取

根目录 `config` 保存用户的定时设置（INI 格式，不纳入版本控制）；模板为 `config.example`。没有配置文件时默认启用每 15 分钟抓取一次。可先执行 `Copy-Item config.example config`，然后编辑：

```ini
[schedule]
enabled = true
cron = */15 * * * *
```

表达式包含五段：分、时、日、月、星期，按运行服务的电脑本地时间执行。支持通配符、步长、范围和列表，例如 `0 9 * * 1-5` 表示工作日 09:00。网页中的「定时抓取」支持启停、常用周期、自定义 Cron、保存及执行倒计时。JS 调用 `/api/schedule` 保存配置并立即更新后台调度；表单编辑期间，轮询不会覆盖未保存内容。直接编辑文件后需重启。

服务持续运行时，定时抓取与手动抓取共用并发锁；遇到正在抓取会跳过该次任务，慢任务或系统休眠期间错过的次数不补跑。停用定时任务不会中断已开始的抓取。`--cached` 只跳过启动时抓取，仍会按 Cron 执行；`--fetch-only` 只执行一次。任务状态通过 `/api/data` 同步到网页，网页每 15 秒轮询，倒计时每秒更新。抓取失败保留已有数据库。

## 可选 C++ 启动器

```powershell
.\scripts\build.ps1
$env:PYTHON = (Resolve-Path .\.venv\Scripts\python.exe).Path
.\build\orders.exe
```

直接运行 `.\build\orders.exe` 即可自动分配空闲端口、启动网页并打开浏览器，无需参数。启动时默认抓取远程来源；如需直接展示缓存，可执行 `.\build\orders.exe --cached`。

也可执行 `cmake -S . -B build` 和 `cmake --build build --config Release`。启动器透传全部参数并返回 Python 的退出码，运行时需要保留本仓库目录结构和 Python 依赖。仅复制可执行文件不能独立运行。

直接启动网页后，点击「Gate 跟踪订单」中的「获取跟踪订单」，即可获取并展示订单，不需要传入命令行参数或填写请求参数。先在根目录 `.env` 配置 `API_KEY`、`API_SECRET`（环境变量优先）。网页启动时读取已有订单，每 15 秒同步本地快照；点击按钮才请求 Gate 最新数据。失败时显示原因并保留上次订单；此按钮独立于 URL 来源抓取和 Cron 定时任务。

`orders::list()` 不接收参数，也不构造 `--list`，直接启动 `scripts/list.py` 获取一次订单；还可执行 `python scripts/list.py`。网页接口 `POST /api/orders/refresh` 直接调用同一 Python 订单获取逻辑，`GET /api/orders` 读取本地快照。默认保存到根目录 `data/orderslist.db` 的 `orders` 表，包含 `id`、`contract`、`amount`、`trigger_price`、`reduce_only`、`original_status` 和响应的毫秒 `timestamp`，并在网页独立表格中显示。每次成功获取后事务替换订单快照。兼容命令 `build/orders.exe --list` 或 `python scripts/run.py --list` 仍可使用，执行一次后退出；Python 命令可用位置参数指定其他 SQLite 输出路径。

## 验证

```powershell
python scripts/test.py
# 或
.\scripts\test.ps1
```

测试使用本机 HTTP 服务、临时数据库和模拟抓取，无需访问生产来源。
