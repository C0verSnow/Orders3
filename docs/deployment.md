# 部署与发布

## 版本与产物

远端 Build and release 先执行静态、类型、业务、安全、既有宿主机脚本和浏览器回归；原生 Windows / Linux AMD64 / ARM64 Runner 各自构建 Node SEA。Windows 去掉原 Node 签名后注入单文件 exe；Linux 制作 deb、dpkg 安装后实际启动 `/usr/bin/orders3`。未配置发布代码签名证书，Windows 下载可能显示未识别发布者；不要伪称已签名。

两个原生 Linux Runner 分别构建和启动 Docker 镜像，验证架构、React 页面、认证 API、随机端口启动脚本，成功后按 digest 推送，最终合并双架构 manifest。没有 QEMU 或旧 Qt 构建。所有步骤必须通过才创建 Release。

触发方式：`v1.2.3` 标签正式发布；默认分支 main 自动生成预发布；feature 分支手动 workflow_dispatch 的 publish_preview=true 生成预发布，不更新 latest、不部署。预发布 tag 为 `build-运行ID-重跑次数`，deb 使用有效 Debian 版本 `1.0.0+build.ID.attempt`，tag 源提交为同一个 GITHUB_SHA。exe `--version`、OCI revision、Release 说明和 container-image_v-1.0.0.txt 均记录该提交。

所有新 Release 附件均带 `v-版本`，下面以正式版 `1.0.0` 为例；实际版本来自标签，自动预发布为 `1.0.0-build.运行ID.重试号`。五个文件使用相同版本，校验清单按新文件名生成并在上传前验证，上传使用明确文件清单，避免混入旧文件。DEB 内部版本规则保持有效，安装命令仍为 `orders3`；旧 Release 附件保留原名。

Release 资产：`orders-windows-x64_v-1.0.0.exe`、`orders3_v-1.0.0_amd64.deb`、`orders3_v-1.0.0_arm64.deb`、SHA256SUMS_v-1.0.0.txt、container-image_v-1.0.0.txt。Actions artifact 可用于 PR 审查，只有实际 Release 和 GHCR digest 出现才算发布完成。

## 运行

生产容器默认 UID/GID 1000，`/data` 为持久卷。升级旧 root 卷前先备份，停服务并修正权限；不会自动 chmod 全盘或删除旧库。不要给容器挂 Docker socket。默认映射回环端口，公开访问需 TLS 反向代理和强登录令牌；允许 Origin 必须与浏览器地址及保留的 Host 一致。

`ORDERS_ACCESS_TOKEN` 是工作台登录凭证，至少 32 个无空格字符，不是 Gate API Key。启动前注入即可；不设置时每次启动自动生成并在私有控制台日志显示。不要放进前端构建变量、URL 查询或 CI artifact。自动浏览器使用 fragment 登录后马上清除；页面不持久化令牌。

`--cached` 仍启用周期任务；自动开仓由独立的 `[opening] enabled=true` 授权，默认关闭；`[schedule]` 仅管理预测抓取。首次升级先检查这两项配置。每分钟持仓和订单同步与来源开关独立，仅读取 Gate 数据。自动保护单功能已取消，已有保护单由用户自行管理。

工作台通过 /api/settings 保存连接；机器身份凭证用启动环境。切换数据目录需重启及人工搬迁。不同时运行旧进程或另一个实例；数据目录进程锁不跨多个不同目录或多个账户客户端提供账户级交易锁。

## 自动 SSH 部署

默认分支的 Release 与双架构镜像都成功后，沿用 Tailscale + scripts/deploy-ssh.sh，上传唯一根 start-docker.sh 并运行。使用 AUTH_KEY、DEPLOY_HOST、DEPLOY_USER、DEPLOY_PORT、DEPLOY_SSH_KEY、DEPLOY_KNOWN_HOSTS，部署到验证过的不可变 digest。需要远端 Bash、curl、Docker、Tailscale 和部署专用 SSH 公钥。

## PR #34 的发布与凭证修正

默认分支已由 mian 改名 main。工作流读取 GitHub 的 repository.default_branch，默认分支发布 latest 和同名分支标签；正式版本也可更新 latest。feature 预发布不移动 latest，PR 不发布或部署。已有 latest 不会因改名自动变化，需等用户 review、合并后成功运行发布流程。

按用户更正，main 已通过带 `[skip ci]` 的提交回退到旧部署分支快照，保留 tasklist 执行记录。本 PR 保留完整 Node/React 方案及报告修复供审阅，没有合并 main，也没有触发生产部署。

SSH 镜像参数接受严格校验的 GHCR `@sha256:<64位小写hex>`，手动兼容 `:latest`。根 start-docker.sh 默认用 Docker --env-file 传入远端当前目录的 .env；其他位置可指定 ORDERS_ENV_FILE。显式指定文件不存在时，在替换容器前报错。文件内容不会作为 Bash 执行，也不会在日志打印。

Infisical Universal Auth 获取函数原已在 services/credentials.ts 中实现；这次补齐宿主机 env-file 到容器的接线。机器认证字段见 example.env，应在远端独立配置并设置权限 600；SSH 脚本不从仓库或 CI 上传它。交易任务持有连接租约，期间拒绝保存设置，Infisical 备用字段更新在任务结束后生效。

GHCR 包需允许远端读取；公开源码不代表包自动公开。拉取失败保留旧容器；替换时有短暂中断；失败不会假报成功，没有自动回滚。生产 secrets 不传入 PR 验证。权限、Runner 或 Registry 阻断需在仓库 Settings 修复，不能绕过检查发布。
