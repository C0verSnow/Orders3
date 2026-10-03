# 本地订单数据看板

C++17 / Qt 6 工程。Windows 默认打开独立软件窗口，Linux 默认打开系统浏览器。程序从 Supabase 读取来源 URL、抓取内容并保存到 SQLite，同时提供 Gate 跟踪订单、搜索筛选、手动刷新、Cron 定时抓取和数据库下载。

运行与发布不需要 Python，也不使用 PyInstaller。网页仍使用 HTML / CSS / JavaScript，作为 Qt 资源编译进程序。旧 Python 代码保存在 `archive/python/`，仅供迁移对照，不参与构建。

## 运行发布包

解压后运行：

- Windows：`orders-windows-x64/bin/orders.exe`。包内包含 Qt WebEngine，保留整个解压目录；无需安装 WebView2。
- Linux：`orders-linux-x64/bin/orders`。包内包含 Qt 与相关运行库，面向 Ubuntu 24.04 x64 或兼容环境，需要 glibc 2.39+；浏览器模式需要系统提供 `xdg-open`。

把包内 `bin/.env.example` 复制为同目录的 `bin/.env`，填写 Supabase 和 Gate 配置。环境变量优先于文件。发布版默认在用户目录 `.orders-dashboard/` 保存数据库和定时配置。

```powershell
# Windows 示例
.\bin\orders.exe --cached
.\bin\orders.exe --browser
.\bin\orders.exe --no-browser --port 8090
.\bin\orders.exe --fetch-only
.\bin\orders.exe --list
.\bin\orders.exe "D:\my data\results.db" --cached
```

默认端口为 0，由系统选择空闲端口。程序打印实际地址。关闭 Windows 主窗口或在服务模式按 Ctrl+C 停止程序；关闭过程取消尚未完成的网络请求。

`--cached` 跳过启动抓取，定时任务仍可执行。`--fetch-only` 抓取来源一次，`--list` 获取 Gate 跟踪订单一次。单次抓取允许位置参数指定数据库路径，只支持 `.db`、`.sqlite`、`.sqlite3`。

Windows 启动时立即展示缓存，两个抓取任务分别在后台执行；Linux 保持先抓取再打开浏览器的方式。`--desktop` 仅支持 Windows，不能与 `--browser`、`--no-browser` 或单次抓取组合使用。

## 配置与数据

`.env.example` 列出配置字段：

| 配置 | 用途 |
| --- | --- |
| `SUPABASE_URL`、`SUPABASE_ANON_KEY` | 来源数据读取 |
| `API_KEY`、`API_SECRET` | Gate 跟踪订单读取 |
| `ORDERS_DATA_DIR` | 两个 SQLite 数据库的保存目录 |
| `ORDERS_CONFIG_PATH` | 定时配置文件路径 |
| `ORDERS_ALLOWED_ORIGIN` | 使用代理或不同访问地址时，允许的网页来源 |

源码目录构建时自动寻找仓库配置，默认使用 `data/data.db`、`data/orderslist.db` 和根目录 `config`；发布包使用用户目录。可执行文件旁的 `.env` 优先于仓库配置。

旧的 `record_json` 缓存、当前结构化来源表以及旧跟踪订单表均可读取。旧 `trigger_price` 缓存不会误作激活价格显示，下次成功获取时迁移。订单金额和价格始终保留字符串精度。抓取或数据库写入失败保留之前的快照。数据格式见 [数据库说明](docs/database.md)。

定时配置为 INI：

```ini
[schedule]
enabled = true
cron = */15 * * * *
```

默认每 15 分钟抓取一次。网页可启停、选择周期、编辑 Cron 并立即保存。支持五段数字表达式、通配符、步长、范围和列表，按电脑本地时间执行；星期支持 0 或 7 表示周日。日和星期同时受限时按“任一匹配”执行，不补跑休眠或慢任务期间错过的次数。与手动抓取冲突时跳过；停用不会中断正在执行的任务。保存时保留其他配置段。

## 工程目录

```text
src/
  app/              命令行入口、本地 HTTP API、资源分发
  core/             配置、Cron 规则、订单文本解析
  infrastructure/   HTTP 客户端、SQLite 连接和事务
  services/         抓取业务、刷新状态和定时调度
  ui/               Windows 原生窗口与启动动画
web/                现有看板资源，编译嵌入程序
tests/cpp/          C++ 回归测试
scripts/            CMake 构建、打包和 CI 运行检查
docs/               架构、数据格式、第三方组件说明
archive/python/     原实现及原测试，供历史对照
```

架构与接口见 [工程说明](docs/architecture.md)。格式规则为 `.editorconfig` 和 `.clang-format`。

## 构建与测试

以下命令供开发者或 CI 使用；本次迁移没有在本地执行编译或运行验证。

依赖：C++17 编译器、CMake 3.24+、Qt 6.4+ 的 Core / Network / Sql / Concurrent / HttpServer；测试需要 Qt Test。Windows 窗口另外需要 Widgets / WebEngineWidgets；推荐使用 MSVC 2022 和 Qt 6.8.3。

```powershell
# Windows：QtPrefix 指向 Qt 的 msvc2022_64 安装目录
.\scripts\build.ps1 -QtPrefix C:\Qt\6.8.3\msvc2022_64
.\scripts\test.ps1
```

Linux（Ubuntu 24.04）：

```sh
sudo apt-get install cmake ninja-build g++ qt6-base-dev qt6-httpserver-dev qt6-websockets-dev libqt6sql6-sqlite
cmake --preset release
cmake --build --preset release
ctest --preset release
./build/release/orders --cached
```

CMake 是唯一构建入口。测试覆盖 Cron、字符串精度、事务回滚、旧数据库读取及迁移；CI 额外检查发布包脱离源码目录后的网页、接口、来源校验和配置持久化。

## CI 与发布

`.github/workflows/build.yml` 在 Windows 和 Linux 编译 C++、执行测试并组装运行库。普通推送和 PR 上传构建附件；`v*` 标签在两端及容器检查通过后发布：

- `orders-windows-x64.zip`
- `orders-linux-x64.tar.gz`
- `SHA256SUMS.txt`
- 原有 GHCR 容器镜像

程序动态链接 Qt 和项目核心库 `orders_core`；Windows 使用动态 MSVC 运行库（`/MD`）。Windows 的 `scripts/package-windows.ps1` 同时扫描 exe 和 `orders_core.dll`，收集 Qt SQL / Concurrent、SQLite 插件及 WebEngine 资源，并从 MSVC 官方 Redist 目录复制 x64 运行库到 exe 旁。打包阶段检查必要文件，CI 解压实际 ZIP 后清除 Qt 开发环境和开发工具 PATH，再检查网页与接口，避免构建机上的 DLL 掩盖漏打包。Linux 发布包将 `liborders_core.so` 放在 `lib` 目录，并打包 Qt 插件与递归依赖，保留系统 glibc 依赖。包内包含多个文件，不能只复制 exe 或裸程序。

容器 CI 在启动后轮询 HTTP 就绪状态，处理端口映射建立期间的连接拒绝或重置；容器提前退出或始终未就绪会失败并输出容器日志。`v*` 标签通过检查后才推送 GHCR。

## 容器

Docker 使用 Ubuntu 多阶段 C++ 构建，运行阶段直接启动原生程序。

```powershell
docker run -d --name orders-dashboard --restart unless-stopped `
  -p 127.0.0.1:8090:8090 --env-file .env `
  -v orders-dashboard-data:/data ghcr.io/huan00000/orders3:v0.2.0
```

访问 `http://127.0.0.1:8090`。`/data` 保存两个数据库与定时配置。不需要启动抓取时，在镜像名后追加 `--host 0.0.0.0 --port 8090 --no-browser --cached`。使用不同访问地址时设置相应的 `ORDERS_ALLOWED_ORIGIN`。
