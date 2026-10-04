# 特洛伊资本

> **仓库约定：以后不要进行本地编译验证。** 修改后使用代码阅读、静态检查、差异检查或已有远端 CI 验证；不要执行本地构建或会触发编译的测试、冒烟脚本。详细约定见 [AGENTS.md](AGENTS.md)。

C++17 / Qt 6 工程。Windows 默认打开独立软件窗口，Linux 和 macOS 默认打开系统浏览器。程序从 Supabase 读取来源 URL、抓取内容并保存到 SQLite，同时提供 Gate 跟踪订单、搜索筛选、手动刷新、Cron 定时抓取和数据库下载。Gate 列表每分钟独立刷新，网页在任务结束时立即同步列表，并每分钟补充同步一次，并隐藏状态码为 5 的订单；来源订单在按钮或定时任务触发后更新，任务运行期间每 5 秒检查完成状态，自动下单结果仅显示最近 10 条；来源抓取成功后自动停止符合条件的旧开仓追踪单并创建新单，具体规则见 [自动追踪订单](docs/trailing-orders.md)。

运行与发布不需要 Python，也不使用 PyInstaller。网页仍使用 HTML / CSS / JavaScript，作为 Qt 资源编译进程序。旧 Python 代码保存在 `archive/python/`，仅供迁移对照，不参与构建。

## 运行发布包

解压后运行：

- Windows：`orders-windows-x64/orders.exe`。包内包含 Qt WebEngine，保留整个解压目录；无需安装 WebView2。
- Linux：`orders-linux-x64/bin/orders` 或 `orders-linux-arm64/bin/orders`。包内包含 Qt 与相关运行库，面向 Ubuntu 24.04 对应架构或兼容环境，需要 glibc 2.39+；浏览器模式需要系统提供 `xdg-open`。
- macOS：按 Intel / Apple Silicon 选择 `orders-macos-x64.tar.gz` / `orders-macos-arm64.tar.gz`，解压后运行 `orders.app`，或执行 `orders.app/Contents/MacOS/orders`。面向 macOS 13+，应用包包含 Qt、SQLite 插件和项目运行库。

启动后在「连接与存储配置」中填写 Supabase 地址、密钥以及 Gate API Key / Secret，点击「保存程序配置」即可，无需创建或打开 `.env`。连接配置立即生效，正在执行的任务使用原配置；更改数据目录需要重启，不会自动搬移已有数据库。密钥不回显，留空保留原值，勾选清除可删除。发布版默认在用户目录 `.orders-dashboard/` 保存数据库和配置。Windows 的 exe、DLL、Qt 插件与 `example.env`、`example.config` 均位于解压后的程序目录内。

```powershell
# Windows 示例
.\orders-windows-x64\orders.exe --cached
.\orders-windows-x64\orders.exe --browser
.\orders-windows-x64\orders.exe --no-browser --port 8090
.\orders-windows-x64\orders.exe --fetch-only
.\orders-windows-x64\orders.exe --list
.\orders-windows-x64\orders.exe "D:\my data\results.db" --cached
```

宿主机直接运行时默认端口为 0，由系统选择空闲端口。Docker / Podman 容器（通过 `/.dockerenv` 或 `/run/.containerenv` 识别）默认监听 `0.0.0.0:8090` 并禁止自动打开浏览器，即使镜像没有设置启动环境变量也使用这些默认值。命令行和环境变量可覆盖默认值。程序打印实际地址。关闭 Windows 主窗口或在服务模式按 Ctrl+C 停止程序；关闭过程取消尚未完成的网络请求。

`--cached` 跳过启动抓取，定时任务仍可执行。`--fetch-only` 抓取来源一次，保存后自动处理开仓追踪单，`--list` 获取 Gate 跟踪订单一次。单次抓取允许位置参数指定数据库路径，只支持 `.db`、`.sqlite`、`.sqlite3`。

启动时立即展示缓存，两个抓取任务分别在后台执行；Linux 和 macOS 无需等待远程抓取完成即可访问页面。`--desktop` 仅支持 Windows，不能与 `--browser`、`--no-browser` 或单次抓取组合使用。

## 配置与数据

`example.env` 列出兼容的环境变量字段；`example.config` 是程序配置示例。日常设置使用程序页面：

| 配置 | 用途 |
| --- | --- |
| `SUPABASE_URL`、`SUPABASE_ANON_KEY` | 来源数据读取 |
| `API_KEY`、`API_SECRET` | Gate 跟踪订单读取 |
| `ORDERS_DATA_DIR` | 两个 SQLite 数据库的保存目录 |
| `ORDERS_CONFIG_PATH` | 程序与定时配置文件路径（启动前通过环境变量指定，页面显示实际位置） |
| `ORDERS_ALLOWED_ORIGIN` | 使用代理或不同访问地址时，允许的网页来源 |

源码目录构建时自动寻找仓库配置，默认使用 `data/data.db` 和根目录 `config`；来源记录保存在 `records`、`orders` 表，Gate 跟踪订单保存在同一数据库的 `orderslist` 表；发布包使用用户目录。`--list` 和普通抓取的位置参数均指定这个共享数据库。可执行文件旁的 `.env` 优先于仓库配置。程序页面保存的 `[environment]` 配置优先于同名环境变量；未保存的字段依次读取环境变量、旧 `.env`。`ORDERS_CONFIG_PATH` 是启动时定位配置文件的变量，不在页面修改。原有 `.env` 和 `config` 继续兼容。

旧的 `record_json` 缓存、当前结构化来源表以及 `orderslist` 跟踪订单表均可读取。`orderslist` 中旧 `trigger_price` 缓存不会误作激活价格显示，下次成功获取时迁移。原独立的 `orderslist.db` 不再读写。订单金额和价格始终保留字符串精度。抓取或数据库写入失败保留之前的快照。数据格式见 [数据库说明](docs/database.md)。

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
web/                模块化网页脚本和共享样式，编译嵌入程序
tests/cpp/          C++ 回归测试
scripts/            CMake 构建、打包和 CI 运行检查
docs/               架构、数据格式、第三方组件说明
archive/python/     原实现及原测试，供历史对照
```

来源订单和 Gate 跟踪订单合并在同一订单工作台，提供统一更新入口，并保留各自的单独更新按钮。统一更新顺序执行来源抓取与 Gate 刷新，避免交易锁冲突。前端按配置、定时、启动动画和公共 UI 拆分模块；Gate 签名及响应解析归入基础层。架构与接口见 [工程说明](docs/architecture.md)。格式规则为 `.editorconfig` 和 `.clang-format`。

## 执行状态与前端检查

“掌握订单执行流程”使用真实 HTTP 请求遥测：来源读取、Gate 获取和交易提交共用执行图；只有服务端报告正在请求时连线才流动。请求结束停止流动并显示完成／失败反馈；短于轮询间隔的请求通过执行事件记录反馈，不伪造进度。状态每 600 毫秒读取 `/api/activity`，实际同步延迟包含网络往返和浏览器调度。连接失败或 3 秒超时停止动画并自动重连。没有演示或暂停开关，系统减少动态效果设置仍受尊重。

使用 Node.js 22+，无需安装依赖或构建网页：

```sh
npm run check
npm test
```

以上仅检查网页语法、模块引用、DOM ID、资源注册及纯 JavaScript 状态逻辑，不触发 C++ 编译。C++ 请求生命周期、线程隔离和有界事件记录测试由远端 CI 执行。

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

`.github/workflows/build.yml` 在 Windows x64、Linux x64 / ARM64 和 macOS Intel / Apple Silicon 编译 C++、执行测试并组装运行库。所有推送和 PR 都上传 Actions 构建附件：Windows 下载为 `orders-windows-x64.zip`，Linux 下载为 `orders-linux-x64.zip`，各自包含同名目录，不再嵌套第二层压缩包。Linux ARM64 附件为 `orders-linux-arm64.zip`；macOS 附件 ZIP 内包含同名 `.tar.gz`，解开 tar 包后保留执行权限与应用包结构。Linux 构建附件 ZIP 解压后需要在程序目录执行 `chmod +x bin/orders`；Release 的 `.tar.gz` 保留可执行权限。每次推送 `master`（或在 `master` 手动运行工作流）在所有平台及容器检查通过后，自动创建 `build-<运行 ID>-<重跑次数>` 预发布版本；`v*` 标签继续发布对应版本，带 `-` 的版本标签标记为预发布。PR 和其他分支只做检查。发布内容：

- `orders-windows-x64.zip`
- `orders-linux-x64.tar.gz`
- `orders-linux-arm64.tar.gz`
- `orders-macos-x64.tar.gz`
- `orders-macos-arm64.tar.gz`
- `SHA256SUMS.txt`
- `container-image.txt`：GHCR 镜像标签与不可变 digest，Release 说明也附有拉取命令
- GHCR 容器镜像，与 Release 使用相同的版本标签，并附加 `sha-<提交短哈希>` 标签

程序下载位于 [Releases](https://github.com/huan00000/orders3/releases)，容器镜像位于 [Packages](https://github.com/huan00000/orders3/packages)。`master` 发布更新镜像的 `master`、`latest` 标签；不带 `-` 的正式 `v*` 版本也更新 `latest`。自动构建的 Release 标记为预发布，不取代正式 Release 的 Latest 标记。

程序动态链接 Qt 和项目核心库 `orders_core`；Windows 使用动态 MSVC 运行库（`/MD`）。Windows 的 `scripts/package-windows.ps1` 同时扫描 exe 和 `orders_core.dll`，收集 Qt SQL / Concurrent、SQLite 插件及 WebEngine 资源，并从 MSVC 官方 Redist 目录复制 x64 运行库到 exe 旁。打包阶段检查必要文件，CI 解压实际 ZIP 后清除 Qt 开发环境和开发工具 PATH，再检查网页与接口，避免构建机上的 DLL 掩盖漏打包。Linux 发布包将 `liborders_core.so` 放在 `lib` 目录，并打包 Qt 插件与递归依赖，保留系统 glibc 依赖。包内包含多个文件，不能只复制 exe 或裸程序。

容器 CI 在启动后轮询 HTTP 就绪状态，处理端口映射建立期间的连接拒绝或重置；容器提前退出或始终未就绪会失败并输出容器日志。`master` 或 `v*` 标签通过检查后才推送 GHCR，镜像推送成功后才发布 Release。

## 容器

Docker 使用 Ubuntu 多阶段 C++ 构建，运行阶段直接启动原生程序。GHCR 镜像同时提供 `linux/amd64` 和 `linux/arm64`，Docker 自动选择对应架构；CI 分别启动两种架构的镜像检查网页和接口。

```powershell
docker run -d --name orders-dashboard --restart unless-stopped `
  -p 127.0.0.1:8090:8090 --env-file .env `
  -v orders-dashboard-data:/data ghcr.io/huan00000/orders3:v0.2.0
```

访问 `http://127.0.0.1:8090`。`/data` 保存数据库与程序配置。不需要启动抓取时，在镜像名后追加 `--cached`。使用不同访问地址时设置相应的 `ORDERS_ALLOWED_ORIGIN`。

### macOS / Linux：自动更新并启动容器

在 **macOS 或 Linux 宿主机终端、仓库根目录** 运行自动随机端口映射脚本，需要安装 Bash、curl，并能访问运行中的 Docker 引擎。macOS 可使用 OrbStack 或 Docker Desktop 提供 Docker 环境；OrbStack 不是项目依赖。Linux 可直接使用 Docker Engine，支持 x64 和 ARM64。

```sh
bash scripts/start-docker.sh
# 跳过启动抓取：
# bash scripts/start-docker.sh --cached
```

脚本在 49152–65535 中随机选择端口，让 Docker 创建 `127.0.0.1:随机端口:随机端口` 映射，并让程序监听 `0.0.0.0:随机端口`。Docker 确认端口可绑定后启动服务，端口占用时最多换端口重试 15 次；网页就绪后输出可在宿主机直接访问的「本地看板」链接。容器在后台运行，退出终端后仍可访问。脚本同时设置 `ORDERS_PORT`，容器健康检查使用相同端口。

默认容器名为 `orders-dashboard`，数据卷为 `orders-dashboard-data`。每次执行先拉取 `ghcr.io/huan00000/orders3:latest` 最新镜像；拉取成功后，自动强制停止并删除同名旧容器，再创建新容器，更新期间服务会短暂中断。拉取失败时保留旧容器；删除容器不会删除命名数据卷，原有数据库和配置继续使用。可用 `ORDERS_CONTAINER_NAME=orders-random bash scripts/start-docker.sh` 指定其他名称。镜像和数据卷可分别通过 `ORDERS_IMAGE`、`ORDERS_VOLUME_NAME` 指定；自定义镜像时拉取的是指定标签或 digest，不会自动改为 `latest`。若页面此前保存了 `ORDERS_ALLOWED_ORIGIN`，请清除该旧值，让程序按当前随机端口校验来源。

这段映射逻辑必须在 Docker 宿主机上执行，容器内的 `./orders` 无法自行给 Docker 添加宿主机映射。脚本只绑定宿主机 `127.0.0.1`；远程 Linux 服务器可使用 SSH 隧道访问，例如 `ssh -L 8090:127.0.0.1:脚本输出的端口 用户@服务器`，然后在本机打开 `http://127.0.0.1:8090/`。以下是固定 8090 端口的手动方式：

在宿主机终端创建并进入容器（使用包含本次改动的新镜像）：

```sh
docker run -it --name orders-manual \
  -p 127.0.0.1:8090:8090 \
  -v orders-dashboard-data:/data \
  --entrypoint /bin/sh ghcr.io/huan00000/orders3:latest
```

进入后直接运行：

```sh
./orders
```

在宿主机浏览器打开 `http://127.0.0.1:8090`，首次使用在页面填写连接配置。容器工作目录默认为 `/opt/orders/bin`，镜像通过 `ORDERS_HOST=0.0.0.0`、`ORDERS_PORT=8090`、`ORDERS_NO_BROWSER=1` 提供服务默认值。命令行 `--host` / `--port` 优先于环境变量；`--browser` 可以覆盖禁止自动打开浏览器的环境默认值，`--no-browser` 始终禁止打开浏览器。这些启动变量从进程环境读取，需要在启动前设置，不由页面或旧 `.env` 文件读取。宿主机直接运行发布包时仍默认仅监听本机、自动分配端口并打开浏览器。

如果旧镜像输出 `http://127.0.0.1:36497/` 等随机端口，而创建容器时映射的是 `8090:8090`，宿主机无法通过这个链接访问容器。停止程序后，旧镜像可用以下命令显式固定监听地址和端口（可执行文件使用绝对路径，不受当前目录影响）：

```sh
/opt/orders/bin/orders --host 0.0.0.0 --port 8090 --no-browser
```

然后在宿主机打开 `http://127.0.0.1:8090/`。新代码需要重新构建镜像才会生效，已有容器和旧的 `latest` 镜像不会自动获得修改。若要继续使用 36497，必须同时指定 `--port 36497` 并在创建容器时使用 `-p 127.0.0.1:36497:36497`。

若创建时提示 `orders-manual` 名称已被占用，已有且已停止的容器可以通过 `docker start -ai orders-manual` 重新进入。需要更换镜像或端口映射时，先退出并停止旧容器，再执行 `docker rm orders-manual`，然后重新创建；命名卷中的数据保留。

`-p` 必须在创建容器时设置；`EXPOSE` 和程序本身都不会创建 宿主机的端口映射。此前通过 OrbStack 临时终端创建且没有映射端口的容器，需要重新创建并配置 `127.0.0.1:8090:8090`。如果已有容器使用 8090，请先停止对应服务或改用其他宿主机端口，同时设置匹配的 `ORDERS_ALLOWED_ORIGIN`。正常自动启动的容器已经运行服务，无需再执行第二个 `./orders`。

已有手动容器可在停止程序、退出终端后通过 `docker start -ai orders-manual` 再次进入，随后执行 `./orders`。
