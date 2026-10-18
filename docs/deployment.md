# 部署与发布

## 版本与产物

远端 Build and release 先执行静态、类型、业务、安全、既有宿主机脚本和浏览器回归；原生 Windows / Linux AMD64 / ARM64 Runner 各自构建 Node SEA。Windows 去掉原 Node 签名后注入单文件 exe；Linux 制作 deb、dpkg 安装后实际启动 `/usr/bin/orders3`。未配置发布代码签名证书，Windows 下载可能显示未识别发布者；不要伪称已签名。

两个原生 Linux Runner 分别构建和启动 Docker 镜像，验证架构、React 页面、认证 API、随机端口启动脚本，成功后按 digest 推送，最终合并双架构 manifest。没有 QEMU 或旧 Qt 构建。所有步骤必须通过才创建 Release。

触发方式：`v1.2.3` 标签正式发布；mian 自动生成预发布；feature 分支手动 workflow_dispatch 的 publish_preview=true 生成预发布，不更新 latest、不部署。预发布 tag 为 `build-运行ID-重跑次数`，deb 使用有效 Debian 版本 `1.0.0+build.ID.attempt`，tag 源提交为同一个 GITHUB_SHA。exe `--version`、OCI revision、Release 说明和 container-image.txt 均记录该提交。

Release 资产：`orders-windows-x64.exe`、`orders3_版本_amd64.deb`、`orders3_版本_arm64.deb`、SHA256SUMS.txt、container-image.txt。Actions artifact 可用于 PR 审查，只有实际 Release 和 GHCR digest 出现才算发布完成。

## 运行

生产容器默认 UID/GID 1000，`/data` 为持久卷。升级旧 root 卷前先备份，停服务并修正权限；不会自动 chmod 全盘或删除旧库。不要给容器挂 Docker socket。默认映射回环端口，公开访问需 TLS 反向代理和强登录令牌；允许 Origin 必须与浏览器地址及保留的 Host 一致。

`ORDERS_ACCESS_TOKEN` 是工作台登录凭证，至少 32 个无空格字符，不是 Gate API Key。启动前注入即可；不设置时每次启动自动生成并在私有控制台日志显示。不要放进前端构建变量、URL 查询或 CI artifact。自动浏览器使用 fragment 登录后马上清除；页面不持久化令牌。

`--cached` 仍启用周期任务；首次迁移且不希望自动开仓时，先在 config 的 schedule.enabled=false，并在配置 Gate 前检查已有设置。每分钟持仓保护与来源开关独立，配置有效 Gate 凭证后可能按旧策略调整平仓保护单。

工作台通过 /api/settings 保存连接；机器身份凭证用启动环境。切换数据目录需重启及人工搬迁。不同时运行旧进程或另一个实例；数据目录进程锁不跨多个不同目录或多个账户客户端提供账户级交易锁。

## 自动 SSH 部署

mian 的 Release 与双架构镜像都成功后，沿用 Tailscale + scripts/deploy-ssh.sh，上传唯一根 start-docker.sh 并运行。使用 AUTH_KEY、DEPLOY_HOST、DEPLOY_USER、DEPLOY_PORT、DEPLOY_SSH_KEY、DEPLOY_KNOWN_HOSTS，部署到验证过的不可变 digest。需要远端 Bash、curl、Docker、Tailscale 和部署专用 SSH 公钥。

GHCR 包需允许远端读取；公开源码不代表包自动公开。拉取失败保留旧容器；替换时有短暂中断；失败不会假报成功，没有自动回滚。生产 secrets 不传入 PR 验证。权限、Runner 或 Registry 阻断需在仓库 Settings 修复，不能绕过检查发布。
