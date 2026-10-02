# 本地抓取数据看板

`1.cpp` 启动 `1.py`，读取数据库中的 URL 并抓取内容，写入 `data.db`，然后启动本地 HTTP 服务并自动打开网页。前端文件位于 `web/`：HTML 页面、CSS 样式、SVG 标志和 JavaScript 数据展示逻辑。

## 启动（PowerShell）

在本目录运行：

```powershell
python -m pip install -r requirements.txt
g++ -std=c++17 -O2 1.cpp -o orders.exe
.\orders.exe
```

也可直接运行 `python 1.py`。默认网页为 `http://127.0.0.1:8080`；程序运行期间保持终端打开，用 Ctrl+C 停止服务。服务仅监听本机。

```powershell
.\orders.exe --port 8090          # 更换本地端口
.\orders.exe --cached            # 直接展示已保存数据，不在启动时抓取
.\orders.exe --no-browser        # 启动服务但不自动打开浏览器
.\orders.exe --fetch-only        # 仅抓取并导出，完成后退出
.\orders.exe "D:\my data\results.db" --port 8090  # 自定义数据输出路径
```

页面以表格展示来源、状态、交易对、方向、价格、数量、金额、订单时间、来源创建时间和抓取内容。每个订单一行，无订单或抓取失败的来源也保留一行；窄屏可横向滚动。支持成功/失败计数、搜索与筛选、完整原始记录展开、SQLite 数据库导出和手动重新抓取。每 15 秒读取本地数据库；重新访问远程来源需要点击「重新抓取」。导出按钮直接下载 `data.db`（SQLite 数据库）。SQLite 使用 Python 标准库，无需安装额外依赖。

数据库按字段存入两张表：

- `records`：`position` 保存来源顺序，`url`、`created_at`、`status_code`、`error`、`data` 为独立列。文本内容直接存入 `data`；结构化内容以 JSON 保存，由 `data_format` 区分。`extra_json` 保留额外来源字段，`present_fields` 区分缺失字段和空值。
- `orders`：每条订单通过 `record_position` 关联来源，`order_index` 保存同一来源内的订单顺序；`symbol`、`price`、`side`、`size`、`value`、`orders_time` 为独立列。价格、数量、金额保留原始精度和单位，订单时间保留原始时间戳文本。

网页通过 `/api/data` 同时读取来源记录及 `orders` 表中的订单字段。旧版 `record_json` 数据库仍可读取，下次抓取保存时会写成新表结构。

查询订单示例：

```sql
SELECT r.url, o.symbol, o.price, o.side, o.size, o.value, o.orders_time
FROM orders AS o
JOIN records AS r ON r.position = o.record_position
ORDER BY o.record_position, o.order_index;
```

启动时远程读取失败会保留已有数据并在页面显示错误；单个 URL 抓取失败也会在页面显示。端口被占用时提示使用 `--port`。项目根目录的 `.env` 文件会自动加载，可在其中配置 `SUPABASE_URL`、`SUPABASE_ANON_KEY`；已有环境变量优先。`PYTHON` 环境变量指定 C++ 启动的 Python 解释器（填写可执行文件路径）。

## 验证

```powershell
python -m unittest discover -s test -p "test_*.py"
```
