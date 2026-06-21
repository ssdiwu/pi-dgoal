# 13 - 启动闸门与 TUI 浮层

> `/dgoal` 启动流程与计划浮层。决策依据见 `adr/0002`。

## 启动闸门流程

```
/dgoal <objective>
  ↓
主代理读代码 + 整理 plan（用 dgoal_propose 提交 goal + phases + 可选初始 task）
  ↓
dgoal_propose execute：存参数 + 触发确认 UI
  ↓
弹 ctx.ui.select 确认 UI（默认只列 goal + verification + phases + task 数量；用户可点入口查看 task 明细）：
  ├─ 确认 → 写入 goal（pending→active），发 START prompt 进 loop
  ├─ 拒绝 → 中止，不进 loop
  └─ 输入反馈（ctx.ui.editor）→ 反馈喂回主代理 → 重新整理 → 再弹确认
  ↓
agent_end 检测：主代理本轮是否调了 dgoal_propose？
  ├─ 调了 → 走确认 UI
  └─ 没调 → 兜底（见下，已决）
```

### 为什么是启动闸门（不是纯自主）

纯自主模式（agent 直接进 loop 自建 plan）的失败是 plan 跑偏在 loop 内不可见，用户只能等结束或中途打断才发现——南辕北辙往往体现在步骤拆解里。启动闸门用一次人工确认把这个成本前置付掉。

### 为什么用工具回调（不用文本解析）

steps 是数组结构（id/subject/blockedBy），工具 schema 能强制结构，文本解析保证不了嵌套字段且格式漂移会失败。工具调用本身也是"主代理整理完毕"的信号，兜底简单。`dgoal_propose` 与 `dgoal_done` 对称（提交计划 / 提交完成）。

## TUI 计划浮层（借鉴 rpiv-todo）

照搬 `todo-overlay.ts` 结构，`placement: "aboveEditor"`：

- **注册**：`pi.setWidget("dgoal-plan", factory, { placement: "aboveEditor" })`
- **heading**：`🎯 <objective 首行> (X/Y)`，X/Y 为 phase 完成数。
- **每行**：`├─ [符] phase subject`，符 ○ pending / ◐ in_progress / ✓ done / ⚠ blocked；done 的 phase/task 标题文本带删除线，状态字符和树形符号不带（ADR 0009）。
- **task 默认隐藏**：双可见性轴。跟随 Pi 的 `app.tools.expand`（默认 `Ctrl+O`）展开，看 phase 下 task 细节（含 blockedReason、evidence）；浮层底部同一行固定提示快捷键 + 常用命令说明。
- **A-line i18n 软依赖**：浮层、状态栏、通知、启动闸门确认 UI 等用户可见文案通过 `pi-di18n` bundle 本地化；缺失 `pi-di18n` 时降级为内置中文。模型侧 prompt、tool description、schema description 不在本地化范围，避免改变 agent 行为。
- **done phase 持久显示**：phase 是用户确认过的进度主干，完成后仍持续显示（✓），不因 `agent_start` 或 `/reload` 隐藏；只有整个 goal done / clear 后浮层才消失。
- **10 行折叠**：浮层自身最多渲 10 行（heading + body + 底部 hint），给 Pi core 的 widget 区域留余量，避免触发 `(widget truncated)`；溢出时保留底部 `Ctrl+O 显示/隐藏 task` hint，并用 `+N more` 摘要。
- **空时隐藏**：无 plan 或 goal 不活跃时 `setWidget(key, undefined)`。
- **刷新时机**：`tool_execution_end`（toolName 是 dgoal_plan/dgoal_check）+ `agent_end` 推进 iteration 时。注意 `tool_execution_end` 只读 `getState()`，不 replay（branch stale）。

### 状态栏（现有，保留）

`ctx.ui.setStatus("dgoal", ...)` 显示 goal 级状态：
- `🔁 active #N`（N=iteration）
- `🔁 paused` / `🔁 starting…` / `🔁 rejected ×M`（M=rejectedCount）/ `🔁 done`

## `/dgoal s` 详细查询 Modal（v0.4.2+，视觉编码 v0.5+ 见 ADR 0009）

`/dgoal s`（`status` 单字母别名）调 `ctx.ui.custom()` 弹一个 top-center overlay modal，让用户能按需看完整 plan 状态（goal + 所有 phase + 所有 task）。**与上方持续显示浮层职责正交**——浮层是"持续进度显示"，s 是"按需详细查询"。

决策依据：形态选型 `doc/决策档案/0008-dgoal-s-modal-形态选型.md`（Variant A=top-center overlay + scroll）；视觉编码 `doc/决策档案/0009-tui-visual-encoding-layer-over-status.md`（**层级靠颜色，状态靠字符**，覆盖 ADR 0008 的 emoji+status 色方案）；探索过程：`doc/20-能力参考/25-dgoal-s-modal变体探索参考.md`。

形态：
- **heading 钉顶**：`🎯 <objective 首行> (X/Y) ⏱️ <elapsed>`，accent 色 + bold
- **body 可滚动**（层级靠颜色，状态靠字符）：每 phase 一行（前缀统一状态字符 `○/◐/✓/⚠` + phase 层级基色 text），phase 下 task 缩进（`│    ○/◐/✓/⚠` + task 层级基色 dim）；done 的 phase/task 标题文本带删除线，状态字符和树形符号不带；行内后缀说明（`activeForm` 用 `(...)`、`blockedReason` 用 `[...]`）作为辅助信息弱化显示，不参与删除线
- **底部 hint**：内容超过可见高度时显示 offset 指示 + 滚动键位；短内容 / 空状态只显示 `ESC/Ctrl+C` 关闭提示。
- **滚动**：vim 风格 `j` 下、`k` 上；`↑↓` 方向键、`PgDn/PgUp` 跳 10、`End/G` 跳底、`Home/g` 跳顶、`ESC` 退出
- **overlay 配置**：`anchor: "top-center"`, `width: "100%"`, `maxHeight: "85%"`, `margin: 1`
- **空状态**：没有 active goal 时也弹同一个 top-center modal，显示“当前没有进行中的 dgoal”、`/dgoal <goal>` 引导和 `ESC/Ctrl+C` 关闭提示；非 TUI / custom 不可用时降级为 notify。

**为什么 modal 本次彩色化、持续浮层暂不**：持续浮层彩色化涉及把 `aboveEditor widget` 从 `string[]` 升级为 theme-aware factory，会引入新的 TUI 渲染 bug 面；本次浮层只统一状态字符、结构和 done 删除线，彩色化延后到下一版本（见 `doc/30-路线图/30-项目路线图.md`）。

**为什么不复用 widget**：`setWidget` 走 Pi 的 `MAX_WIDGET_LINES = 10` 限制（参考 `tui.js:1421`），modal 30+ 行 plan 装不下。`ctx.ui.custom()` 没有这个限制，且支持键盘事件 + 滚动 + 自定义 anchor。

## 兜底（已决）

主代理不调 `dgoal_propose`（跑偏没产出 plan）时：降级提示重试 2 次；仍无产出则中止启动（goal 不进 `active`，直接清除），不走“进 loop 自建 plan”的纯自主兜底。详见 `30-路线图` 与 `adr/0002-startup-gate-tool-callback.md`。
