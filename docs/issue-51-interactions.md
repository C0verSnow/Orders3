# Issue #51：界面交互与平仓乘数

## 本次行为

- 所有共用按钮点击后文字淡出，可见外形在 300ms 内缩成圆形，显示加载环。保留原点击区域，避免导航、表格和工具栏跳动。异步操作必须实际成功，且加载至少 1.2 秒，才显示绿色及绘制对勾；1 秒后恢复。请求失败显示红色错误，原有错误说明保留。普通导航和本地操作即时执行，动画不会延迟操作。
- checkbox 使用原生表单输入实现 JellyToggle，350ms 内先拉长再回弹，灰色切换绿色；保留 Space、标签点击、disabled、required 和 FormData 行为。
- 七个主要页面的标题、卡片、设置分类及内容使用统一 Stagger，350ms 入场、90ms 间隔，最多延迟 540ms。已有列表继续使用 MotionList。轮询更新不会重播整页入场；减少动态效果模式关闭位移、形变和开关动画。
- 对照评论图片，主题与快捷周期使用分组设置行及原生 radio 分段选择；切换计划开关只改草稿，点击保存才持久化。选“自定义”清空 Cron，填写后保存；不会因切换选项直接启动交易。
- 设置表单在宽屏左右排、窄屏上下排；不符合字段约束时显示就地错误并关联 aria-describedby，改正后清除。人工核对由原生 prompt/confirm 改为页内依据输入与必须勾选的确认，保留服务端核对及交易阻断约束。

## 平仓乘数

进入「系统设置 → 平仓参数」填写大于零的十进制文本，默认 3.1；服务端沿用项目十进制范围校验，不转成 JavaScript 浮点数。

```text
设置表单 → POST /api/settings { close_multiplier: "2.75" }
  → Configuration.update：校验后一次写入配置
  → [trading] close_multiplier = "2.75"
  → 下一轮 Dashboard.maintainPositions → closeOrders → closePrice
```

原公式的固定 3.1 换为配置乘数，其余不变：

```text
目标价 = 入场价 + 固定保证金 × 平仓乘数 ÷ (带方向持仓张数 × 合约乘数)
激活价 = 目标价 × (空仓 0.99 / 多仓 1.01)，随后按 Gate 步长对齐
```

保存不会立即交易。下一轮十分钟持仓维护会按新值核对未激活的平仓单；已激活订单继续保留。数量、固定保证金、未知请求阻断和只减仓规则不变。旧配置缺失此项时默认为 3.1；非法配置在启动时直接报错。修改配置文件需重启，设置页保存无需重启。计划和凭证设置互相保留。

## GitHub 检索与设计参考

2026-11-04 已在 GitHub 检索并比较以下项目，读取 Switch 源码、依赖清单及近期 Issue/PR。没有直接复制代码，没有增加依赖。

| 项目 | 活跃度与许可 | 实现与依赖 | 已知问题与本次取舍 |
| --- | --- | --- | --- |
| [Radix Primitives](https://github.com/radix-ui/primitives) | 19,466 stars，最近推送 2026-10-14，MIT；近期 Issue 有评论，表单修复 PR 有维护记录 | Switch 拆分受控状态、触发器、thumb 与表单 input；依赖 compose-refs/context/primitive/use-controllable-state/use-size | [#4266](https://github.com/radix-ui/primitives/issues/4266) 报告受控 Tabs 重复触发；[#4242](https://github.com/radix-ui/primitives/pull/4242) 讨论表单重复校验。本项目直接保留原生 checkbox/radio 语义，避免引入整套状态封装 |
| [Motion](https://github.com/motiondivision/motion) | 34,866 stars，最近推送 2026-11-03，MIT；近期 Issue 有评论且维护者合并 PR | 声明式时间线、错开延迟和 reduced-motion；React 包依赖 motion-dom、motion-utils、tslib | [#4031](https://github.com/motiondivision/motion/pull/4031) 修复 Suspense 重挂载重播初始值；[#4044](https://github.com/motiondivision/motion/issues/4044) 报告动画完成回调问题。本项目沿用既有 Web Animations API，只在页面/分组切换时执行并清理动画 |

## 验证

本地只做代码阅读和 git diff --check；未执行本地编译、构建、类型编译、测试或冒烟。使用仓库既有 GitHub Actions：

- tests/node/issue-51.test.ts：旧配置兼容、API 非法值不落盘、独立持久化与重启、多空精确计算、下一轮撤旧建新与重复维护不重复下单。
- scripts/check-settings.mjs：桌面与手机、中英、明暗；真实 API 保存、失败提示、按钮周期与圆形、键盘开关、分段选项、字段错误与刷新后的配置。
- 原有完整测试、构建、浏览器、Windows/Linux 包、Docker 双架构和截图对比继续由远端 CI 执行。浏览器步骤上限由 5 分钟调整为 8 分钟，容纳新增手机与交互覆盖。

远端执行结果待补充。PR 等待用户 review，不合并或部署生产。
