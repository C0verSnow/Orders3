# 验证记录

## 分类

| 检查 | 当前证据 |
| --- | --- |
| 旧源码与 Node 业务对照 | 已完成代码审查，见 business-parity.md |
| 差异与发布依赖 | 已完成 git diff --check；当前入口无 Qt/CMake |
| 本地编译、构建、类型检查 | 尚未执行，用户禁止本地编译验证 |
| 回归测试、浏览器、发布包 | 由 PR #32 最新远端 Actions 核实；未取得成功结果前不写通过 |
| Release / Container Package | 需要成功 workflow_dispatch 预发布及实际文件/digest 证据 |
| 实盘/真实手机 | 需要后续受控运行与真机验证；无实盘试单 |

## UI 静态审查

| Before | After | Why |
| --- | --- | --- |
| 原生 Web 与 Qt 桥接 | React 组件与受保护 API | 页面和交易职责分开 |
| 原有深浅主题覆盖分散 | 全局 CSS Tokens，持久化 light/dark/system | 统一表单、弹窗、表格和状态 |
| 窄屏表格信息拥挤 | 抽屉导航、布局重组、表格横滑、完整详情 | 保留业务字段和操作入口 |
| 页面可能直接依赖旧进度表现 | 真实请求 active 与任务事件；断线明确提示缓存 | 避免把动画误认为成交完成 |
| 交易刷新反馈较弱 | 刷新前说明真实交易影响，服务端结果反馈 | 用户知道刷新会操作真实账户 |

使用 apple-design、emil-design-eng、mobile-native 和 vercel:react-best-practices。按钮按下反馈使用 transform；仅能力匹配设备启用 hover；reduced-motion 关闭位移和旋转；输入移动端 16px，使用 dvh 与 safe-area，不禁止页面缩放。静态审查不能证明真机触感或所有 WCAG 2.2 AA 要求都已验收。
