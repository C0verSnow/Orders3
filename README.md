# 本地订单数据看板

从 Supabase 读取来源 URL，抓取内容并写入 SQLite，再通过本机网页展示订单、搜索筛选、刷新和数据库下载。支持 Python 3.10+；C++17 启动器为可选入口。

## 安装与启动

在仓库根目录运行（PowerShell）：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e .
.\.venv\Scripts\python.exe -m orders_dashboard --cached
```

默认地址为 `http://127.0.0.1:8080`。`--cached` 展示已有缓存；去掉该参数会在启动时抓取远程来源。Ctrl+C 停止服务。

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
native/           可选 C++ 启动器
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

## 可选 C++ 启动器

```powershell
.\scripts\build.ps1
$env:PYTHON = (Resolve-Path .\.venv\Scripts\python.exe).Path
.\build\orders.exe --cached
```

也可执行 `cmake -S . -B build` 和 `cmake --build build --config Release`。启动器透传全部参数并返回 Python 的退出码，运行时需要保留本仓库目录结构和 Python 依赖。仅复制可执行文件不能独立运行。

## 验证

```powershell
python scripts/test.py
# 或
.\scripts\test.ps1
```

测试使用本机 HTTP 服务、临时数据库和模拟抓取，无需访问生产来源。
