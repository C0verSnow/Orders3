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

Windows 可安装独立窗口依赖，然后运行 `python scripts/run.py --desktop`：

```powershell
python -m pip install -e ".[desktop]"
python scripts/run.py --desktop
```

Windows 使用 Microsoft Edge WebView2 Runtime 在软件窗口内显示现有网页，无需单独打开浏览器。启动先显示本地缓存，来源与跟踪订单并行在后台更新；更新期间每秒同步状态，完成后恢复每 15 秒同步。页面提供约 0.74 秒的标志出现与淡出过渡，并尊重系统减少动画设置。Linux 保留先抓取、再打开浏览器的原流程，不启用独立窗口或启动动画，也不需要安装 desktop 依赖。

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

Windows 安装上述 desktop 依赖后，直接运行 `.\build\orders.exe` 即可自动分配空闲端口并打开独立窗口，无需参数。C++ 启动器先显示原生 2D 动画，在 Python 和网页内核初始化期间提供反馈，网页准备好后淡出并显示主界面。关闭主窗口会停止本地服务。启动时默认在后台抓取远程来源；如需只展示缓存，可执行 `.\build\orders.exe --cached`。使用 `.\build\orders.exe --browser` 可打开系统浏览器，`--no-browser` 只运行本地服务。Linux 启动器仍打开系统浏览器。

终端打印本地服务准备时间与独立窗口加载时间，方便区分服务、网页内核和联网耗时。原生动画提供即时反馈，但完整界面的首次启动时间仍受硬件和 WebView2 初始化影响，不保证每次低于 1～2 秒。

也可执行 `cmake -S . -B build` 和 `cmake --build build --config Release`。启动器透传全部参数并返回 Python 的退出码，运行时需要保留本仓库目录结构和 Python 依赖。仅复制可执行文件不能独立运行。

直接启动网页后，点击「Gate 跟踪订单」中的「获取跟踪订单」，即可获取并展示订单，不需要传入命令行参数或填写请求参数。先在根目录 `.env` 配置 `API_KEY`、`API_SECRET`（环境变量优先）。网页启动时自动请求 Gate 最新订单；使用 `--cached` 时只读取已有订单。网页每 15 秒同步本地快照，也可点击按钮手动更新。失败时显示原因并保留上次订单；此按钮独立于 URL 来源抓取和 Cron 定时任务。

`orders::list()` 不接收参数，也不构造 `--list`，直接启动 `scripts/list.py` 获取一次订单；还可执行 `python scripts/list.py`。网页接口 `POST /api/orders/refresh` 直接调用同一 Python 订单获取逻辑，`GET /api/orders` 读取本地快照。默认保存到根目录 `data/orderslist.db` 的 `orders` 表，包含 `id`、`contract`、`amount`、`activation_price`、`reduce_only`、`original_status` 和响应的毫秒 `timestamp`，并在网页独立表格中显示。每次成功获取后事务替换订单快照，并自动迁移旧的 `trigger_price` 列；旧缓存未更新前，激活价格显示为「—」。兼容命令 `build/orders.exe --list` 或 `python scripts/run.py --list` 仍可使用，执行一次后退出；Python 命令可用位置参数指定其他 SQLite 输出路径。

## 自动构建与发布

`.github/workflows/build.yml` 将 Windows 和 Linux 分成两个独立构建任务。普通分支推送、PR 和手动运行只构建验证；推送 `v` 开头的标签时，在两端测试、单文件启动检查和容器检查均通过后，自动推送 GHCR 镜像并创建 GitHub Release。

Release 包含：

- `orders-windows-x64.exe`：Windows x64 单文件，默认独立窗口；需要系统安装 Microsoft Edge WebView2 Runtime。
- `orders-linux-x64`：Linux x64 单文件，默认打开浏览器；以 Ubuntu 22.04 构建，需要 glibc 2.35 或更新版本。下载后先执行 `chmod +x orders-linux-x64`。
- `SHA256SUMS.txt`：两个文件的 SHA-256 校验值。

两端使用 PyInstaller 打包 Python、业务依赖和网页资源，不需要用户另装 Python 或下载源码。系统库保持动态链接，不是完全静态程序。单文件入口直接调用 Python 业务入口；现有 C++ 启动器仍单独检查编译，Windows 明确使用动态 MSVC 运行库（`/MD`）。Release 单文件不包含 C++ 启动器的原生启动动画。

单文件读取可执行文件旁的 `.env`，环境变量优先；不会打包仓库内的 `.env`、密钥或本地数据库。默认数据库和定时配置保存在用户目录 `.orders-dashboard` 中；`ORDERS_DATA_DIR` 可修改两个数据库的保存目录，`ORDERS_CONFIG_PATH` 可指定定时配置文件路径。

将本次改动提交、推送到 GitHub 后，在已包含这些改动的提交上打标签发布：

```powershell
git tag v1.0.0
git push origin v1.0.0
```

镜像位于 `ghcr.io/huan00000/orders3`，版本标签例如 `v1.0.0`；正式版同时更新 `latest`，带 `-` 的预发布标签不更新 `latest`。发布使用 Actions 自带的 `GITHUB_TOKEN`，无需额外配置个人令牌；工作流为 Release 设置 `contents: write`，为 GHCR 设置 `packages: write`。重新运行同一标签会更新对应 Release 附件。

## 容器运行

镜像为 Linux amd64，通过网页使用。PowerShell 示例：

```powershell
docker run -d --name orders-dashboard --restart unless-stopped `
  -p 127.0.0.1:8090:8090 `
  --env-file .env `
  -v orders-dashboard-data:/data `
  ghcr.io/huan00000/orders3:v1.0.0
```

访问 `http://127.0.0.1:8090`。`/data` 卷持久保存来源数据库、跟踪订单数据库和定时配置。镜像默认以普通用户运行，监听 `0.0.0.0:8090`；Docker 将端口映射到主机本机地址。不需要联网抓取时，可在镜像名后追加 `--host 0.0.0.0 --port 8090 --no-browser --cached`。

如果改用其他访问地址或主机端口，例如 `http://127.0.0.1:9090`，同时设置 `-e ORDERS_ALLOWED_ORIGIN=http://127.0.0.1:9090`，以便网页刷新、定时设置等写入请求通过来源校验。私有 GHCR 包拉取前需要登录；是否允许匿名下载由 GitHub Packages 的包可见性决定。

本地构建镜像：`docker build -t orders-dashboard:local .`。

## 验证

```powershell
python scripts/test.py
# 或
.\scripts\test.ps1
```

测试使用本机 HTTP 服务、临时数据库和模拟抓取，无需访问生产来源。
