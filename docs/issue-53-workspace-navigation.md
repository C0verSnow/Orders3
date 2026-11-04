# Issue #53：恢复 Workspace 导航点击样式

## 恢复的行为

点击 Workspace 左侧七个页面入口，立即切换页面，图标和文字始终可见，不再变成蓝色加载圆环或绿色成功对勾。选中项的蓝色标记、悬停与键盘焦点的共享滑块、手机菜单关闭方式均沿用现有实现。

改动只在导航的 Button 调用处显式传入 `status="idle"`，使用共享按钮已有的受控状态。共享按钮、其他本地操作、保存、刷新、下载及交易逻辑均保持不变，没有新增依赖。

## 原因与历史核对

已读取 GitHub [issue #53 的正文与截图](https://github.com/C0verSnow/Orders3/issues/53)，并核对本仓库 Git 历史及 GitHub 上的[修改前共享按钮](https://github.com/C0verSnow/Orders3/blob/974c9e7/apps/web/src/components/ui.tsx)。导航自身在 #51 中没有改动；共享 Button 在没有传入 status 时新增自动加载和成功反馈，导致导航也隐藏了图标文字。

本次为熟悉组件的局部恢复，直接使用项目已有接口，没有实现陌生功能，没有检索或借鉴其他开源项目，也没有复制外部代码。

## 验证

沿用已有 GitHub Actions 的 `scripts/check-browser.mjs`，调用新增的 `scripts/check-navigation.mjs`。检查真实生产界面和已有缓存服务，覆盖：

- 1440px 桌面、390px 手机，中英界面、明暗主题。
- 七个导航项的鼠标点击和键盘 Enter；当前页标记、页面标题与手机菜单关闭。
- 点击后所有导航项持续 idle、无忙碌状态、文字可见且不变、没有加载或成功播报；等待后也不会出现延迟成功反馈。
- 上传八张 `issue-53-navigation-*.png`，供检查恢复后的外观。原有共享滑块、设置保存与刷新反馈检查继续运行。

先提交回归，再修复。回归提交 `f2053c3` 在[远端 41785013923](https://github.com/C0verSnow/Orders3/actions/runs/41785013923/job/126425058534) 的 `node scripts/check-browser.mjs` 中复现：点击导航后实际为 `feedback=pending`、`aria-busy=true`、状态文字“正在处理…”，与预期持续 idle 不符。既有刷新回归在此之前已通过。修复后的完整远端结果完成后补充在这里。

本地仅做代码阅读与 `git diff --check`，未进行本地编译、构建、类型检查、测试或启动服务。
