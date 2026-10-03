# 第三方组件

当前程序使用 Qt 6 Core、Network、Sql、Concurrent 和 HTTP Server；Windows 另外使用 Qt Widgets 和 Qt WebEngine。SQLite 由 Qt SQL 插件提供。Linux 发布包还包含所依赖的 Ubuntu 动态库。

Qt 各模块的授权不同。Qt HTTP Server 提供 GPLv3 或商业授权；其他模块及 WebEngine 包含各自的授权和第三方声明。发布与修改时按所选授权保留对应文本。项目自身的授权不在本次重构中变更。

参考：

- [Qt 授权说明](https://doc.qt.io/qt-6/licensing.html)
- [Qt HTTP Server](https://doc.qt.io/qt-6/qthttpserver-index.html)
- [Qt WebEngine 第三方声明](https://doc.qt.io/qt-6/qtwebengine-licensing.html)
- [Windows 部署](https://doc.qt.io/qt-6/windows-deployment.html)

CI 收集 Qt 安装目录中可用的授权文件；Linux 包附带系统通用授权和相关包的 copyright 文件。安装 Qt 的 CI 辅助工具与应用运行时分离，发布包不含 Python 应用或解释器。
