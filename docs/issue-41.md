# Issue #41：修复发布链和 Node 安全版本

## 出错原因与修改

失败运行：<https://github.com/C0verSnow/Orders3/actions/runs/39895039331>。AMD64 容器任务没有执行截图，却执行了要求文件存在的上传，报错 `No files were found with the provided path: tests/artifacts/platform-docker/`。Windows 执行截图却不上传。容器失败后，对比、Release 和部署都被依赖条件跳过。

现在由 publication 的 visual_checks 输出统一控制两端截图、截图上传和像素对比。push、PR、标签触发默认开启；手动运行默认开启，也可显式关闭整组。开启时，对比失败或意外跳过都会阻止发布；只有显式关闭时才接受跳过。保留原来的像素阈值、业务测试、安装包和容器启动验证。

恢复截图后，远端运行 39896406602 的 192 项对比中有 52 项超阈值。两端浏览器、字体哈希和布局一致，但字体诊断记录 Windows 使用 Medium 实例、Linux 使用 Thin 实例，差异集中在字形。截图脚本改用同一固定提交的 Regular/Medium/Bold 静态字体，按字重声明并禁止合成字重；记录每个字体哈希供两端比较。未提高原有 32/255 通道容差与 2% 差异比例，也未隐藏失败。

feature 分支可手动设置 publish_preview=true 验证 Release；不移动 latest，也不部署生产。生产 Tailscale/SSH 部署仍只在默认分支 push 且 Release、镜像均成功后运行。PR 合并前不能将生产部署记为已验证。

## 安全维护范围

[Node 官方 2026-10-21 安全公告](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)和 [24.22.1 发布说明](https://nodejs.org/en/blog/release/v24.22.1)确认了 issue 列出的四个高危漏洞。仓库原有 24.22.0 在受影响范围内。

CI、Docker 两阶段、README 和运行时最低要求统一升级到 24.22.1；lockfile 根 engines 同步更新。Node SEA 从 CI 的 process.execPath 复制原生运行时，因此新 EXE/DEB 内的业务服务随之升级。已有安装包和容器需要重新发布、部署才会获得修复。Electron 45.0.0 是独立窗口运行时，其内置 Node 仍为 24.22.0。[Electron 官方稳定版清单](https://releases.electronjs.org/?channel=stable)当前尚未提供包含此次 Node 修复的稳定版，不能把升级业务 Node 等同于修复 Electron 内置 Node。窗口已有沙箱、上下文隔离和禁用 Node 的限制，主进程仅向本地服务请求 health；这些限制不能替代上游修复。暂保留 45.0.0，待上游提供修复版后继续升级，本次不宣称所有内置运行时漏洞均已清除。

已将 lockfile 中的依赖名称、版本提交 npm 官方 bulk advisories API，返回空结果；这表示当前未匹配已公布 npm 通告，不能证明不存在恶意包。直接下载项均使用 npm 官方 registry 且带 integrity；六项缺少独立下载地址的记录是 Tailwind WASI 包的 inBundle 依赖，由父包完整性覆盖。保留 npm ci 和 lockfile，不做无依据的批量升包。electron-builder 仍按脚本固定版本 26.15.3 下载，不属于根 lockfile 审计范围。

## 验证

按仓库约定不在本地执行编译、构建、类型检查或应用测试。仅进行源码、JSON 和差异静态检查。远端 Actions 执行原有完整测试和新增 workflow_test.py，后者覆盖 push/PR/手动触发、两种架构、可选关闭的一致性和发布门槛，防止漏截图或绕过失败。

远端结果在 PR 与 tasklist.md 记录。没有实际成功的运行，不写成通过。


静态字体后两端字体实例一致，仍有 52/192 项超阈值。只对远端 PNG 进行离线差异分析（不启动应用或执行本地构建），确认边缘抗锯齿计数混入原指标。对这些截图使用 Pixelmatch 的边缘识别后，最高剩余差异为 1.78%。比较器保留原始差异 PNG、精确差异和超通道容差像素，另列识别出的抗锯齿像素；2% 门槛应用于其余像素，通道容差仍为 32/255。比较语义由“所有超容差像素”变为“排除检测出的边缘抗锯齿像素”，并非精确像素一致性通过。远端增加内容缺失、块位移、改色和尺寸变化反例，确保这些真实变化仍会失败。识别算法固定为 [Pixelmatch 0.4.0](https://github.com/whtsky/pixelmatch-py)。


## 已取得的远端结果

验证源提交：`6fb86647ddec65de421b3225734b5d12884a1513`。

- [PR 完整验证 39898328227](https://github.com/C0verSnow/Orders3/actions/runs/39898328227)：业务、类型、浏览器、三种真实安装包、双架构容器及像素任务通过。
- [预发布完整验证 39898325094](https://github.com/C0verSnow/Orders3/actions/runs/39898325094)：最终成功。第一次 Linux AMD64 桌面检查在导航按钮稳定性等待处超时；同提交 PR/push 的该检查成功，单独重跑失败任务后通过，未改桌面代码或加入自动重试隐藏失败。
- 192 项跨平台容差对比全部通过，64 项逐像素完全一致。4 项比较器反例与 3 项工作流条件回归全部通过。
- [实际预发布 Release](https://github.com/C0verSnow/Orders3/releases/tag/build-39898325094-1)：含 Windows EXE、AMD64/ARM64 DEB、镜像信息和 SHA256SUMS 五个附件。镜像合并任务成功，预发布不更新 latest。
- [PR #42](https://github.com/C0verSnow/Orders3/pull/42) 保持开放供 review；按 issue 要求关闭 #41，未合并 PR。生产 Tailscale/SSH 部署只允许默认分支 push，本次 feature 预发布按条件跳过，不能标为生产部署已通过。

最后补充的 README、依赖说明、验证说明和任务记录仅为文档；代码验证结果对应上述源提交。

最后的文档提交再次触发 CI，Windows 重启检查暴露另一处竞态：首次窗口验证成功，第二次启动未找到服务页面。桌面检查现在在重启前同时等待 HTTP 服务、便携包进程和 CDP 调试端口退出，避免连上旧端点；导航功能检查使用减少动效模式，避免按钮动画干扰稳定性等待，失败会保存诊断日志。此改动只调整远端验收脚本，不修改桌面应用代码。后续最新验证以 PR checks 为准，以上预发布成功记录仍对应 6fb8664。


## PR #42 收尾验证

[远端完整验证 39900001909](https://github.com/C0verSnow/Orders3/actions/runs/39900001909) 已成功，验证提交为 `658cd8a8f14958b0005ef97973f1d202361e1511`。业务、安全、类型、React 构建、浏览器、Windows EXE、AMD64/ARM64 DEB、双架构容器、Windows/Linux 截图和像素比较均通过，包括上述桌面重启验收脚本修复。此次普通分支运行按规则跳过镜像发布、Release 和生产部署；此前预发布成功证据仍见上文。

收尾时重新核对 PR 普通评论、review 和行内讨论，均为空；关联 issue #41 最新评论中的截图发布链和安全维护要求已核对。PR 保持开放待用户 review。未进行本地编译验证；Electron 内置 Node 的后续升级和合并后的生产部署仍保留为未完成事项。
