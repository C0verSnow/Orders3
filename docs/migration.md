# 目录迁移说明

此次迁移保留原有页面及 SQLite 表结构，拆分 Python 模块并统一安装、构建和验证入口。

| 原位置 | 新位置或命令 |
| --- | --- |
| `1.py` | `src/orders_dashboard/`；`python scripts/run.py` |
| `1.cpp` | `native/launcher.cpp`（程序入口）和 `native/main.cpp`（函数实现） |
| `1.md` | `docs/legacy-guide.md`（保留原文供参考） |
| `web/` | `src/orders_dashboard/web/` |
| `test/` | `tests/` |
| 根目录 `data.db` | `data/data.db`（已有数据原样迁移） |
| 根目录 `orders.exe` | 旧文件归档到 `build/legacy-orders.exe`，新入口重新构建到 `build/orders.exe` |
| `data.json` | 删除旧产物；输出路径校验拒绝 JSON 后缀 |

旧文档中的数字文件名和旧命令已失效，日常使用以 README 为准。历史截图迁入 `tests/artifacts/` 并忽略；缓存、虚拟环境、构建文件和数据库不纳入版本控制。

`native/launcher.cpp` 只定义程序入口并调用 `orders::launch()`；参数调度、Python 进程调用及 `orders::frequency()`、`orders::list()` 的实现统一放在 `native/main.cpp`。`launcher.hpp` 声明启动接口，`main.hpp` 声明功能接口，所有接口位于 `orders` 命名空间。CMake 和 `scripts/build.ps1` 都同时编译两个 `.cpp` 文件；直接使用编译器时也需包含两者。

网页保持 `/api/data`、`/api/refresh`、`/api/download` 接口；网页脚本无 `data.json` 路径、下载或文件生成逻辑。下载接口提供 SQLite 文件。
