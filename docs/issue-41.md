# Issue #41：修复发布链和 Node 安全版本

## 出错原因与修改

失败运行：<https://github.com/C0verSnow/Orders3/actions/runs/39895039331>。AMD64 容器任务没有执行截图，却执行了要求文件存在的上传，报错 `No files were found with the provided path: tests/artifacts/platform-docker/`。Windows 执行截图却不上传。容器失败后，对比、Release 和部署都被依赖条件跳过。

现在由 publication 的 visual_checks 输出统一控制两端截图、截图上传和像素对比。push、PR、标签触发默认开启；手动运行默认开启，也可显式关闭整组。开启时，对比失败或意外跳过都会阻止发布；只有显式关闭时才接受跳过。保留原来的像素阈值、业务测试、安装包和容器启动验证。

feature 分支可手动设置 publish_preview=true 验证 Release；不移动 latest，也不部署生产。生产 Tailscale/SSH 部署仍只在默认分支 push 且 Release、镜像均成功后运行。PR 合并前不能将生产部署记为已验证。

## 安全维护范围

[Node 官方 2026-10-21 安全公告](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)和 [24.22.1 发布说明](https://nodejs.org/en/blog/release/v24.22.1)确认了 issue 列出的四个高危漏洞。仓库原有 24.22.0 在受影响范围内。

CI、Docker 两阶段、README 和运行时最低要求统一升级到 24.22.1；lockfile 根 engines 同步更新。Node SEA 从 CI 的 process.execPath 复制原生运行时，因此新 EXE/DEB 内的业务服务随之升级。已有安装包和容器需要重新发布、部署才会获得修复。Electron 45.0.0 是独立窗口运行时，不能把升级业务 Node 等同于升级 Electron；窗口已有沙箱、上下文隔离和禁用 Node 的限制，本次未更改 Electron 版本。

已将 lockfile 中的依赖名称、版本提交 npm 官方 bulk advisories API，返回空结果；这表示当前未匹配已公布 npm 通告，不能证明不存在恶意包。直接下载项均使用 npm 官方 registry 且带 integrity；六项缺少独立下载地址的记录是 Tailwind WASI 包的 inBundle 依赖，由父包完整性覆盖。保留 npm ci 和 lockfile，不做无依据的批量升包。electron-builder 仍按脚本固定版本 26.15.3 下载，不属于根 lockfile 审计范围。

## 验证

按仓库约定不在本地执行编译、构建、类型检查或应用测试。仅进行源码、JSON 和差异静态检查。远端 Actions 执行原有完整测试和新增 workflow_test.py，后者覆盖 push/PR/手动触发、两种架构、可选关闭的一致性和发布门槛，防止漏截图或绕过失败。

远端结果在 PR 与 tasklist.md 记录。没有实际成功的运行，不写成通过。
