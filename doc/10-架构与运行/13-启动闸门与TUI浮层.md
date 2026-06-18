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
弹 ctx.ui.select 确认 UI（title 内直接列出 goal + verification + phases + task 明细）：
  ├─ 确认 → 写入 goal（pending→active），发 START prompt 进 loop
  ├─ 拒绝 → 中止，不进 loop
  └─ 输入反馈（ctx.ui.editor）→ 反馈喂回主代理 → 重新整理 → 再弹确认
  ↓
agent_end 检测：主代理本轮是否调了 dgoal_propose？
  ├─ 调了 → 走确认 UI
  └─ 没调 → 兜底（见下，待定）
```

### 为什么是启动闸门（不是纯自主）

纯自主模式（agent 直接进 loop 自建 plan）的失败是 plan 跑偏在 loop 内不可见，用户只能等结束或中途打断才发现——南辕北辙往往体现在步骤拆解里。启动闸门用一次人工确认把这个成本前置付掉。

### 为什么用工具回调（不用文本解析）

steps 是数组结构（id/subject/blockedBy），工具 schema 能强制结构，文本解析保证不了嵌套字段且格式漂移会失败。工具调用本身也是"主代理整理完毕"的信号，兜底简单。`dgoal_propose` 与 `dgoal_done` 对称（提交计划 / 提交完成）。

## TUI 计划浮层（借鉴 rpiv-todo）

照搬 `todo-overlay.ts` 结构，`placement: "aboveEditor"`：

- **注册**：`pi.setWidget("dgoal-plan", factory, { placement: "aboveEditor" })`
- **heading**：`🎯 <objective 首行> (X/Y)`，X/Y 为 phase 完成数。
- **每行**：`├─ [符] phase subject`，符 ○ pending / ◐ in_progress / ✓ completed / ⚠ blocked。
- **task 默认隐藏**：双可见性轴。跟随 Pi 的 `app.tools.expand`（默认 `Ctrl+O`）展开，看 phase 下 task 细节（含 blockedReason、evidence）；浮层底部同一行固定提示快捷键 + 常用命令说明。
- **A-line i18n 软依赖**：浮层、状态栏、通知、启动闸门确认 UI 等用户可见文案通过 `pi-di18n` bundle 本地化；缺失 `pi-di18n` 时降级为内置中文。模型侧 prompt、tool description、schema description 不在本地化范围，避免改变 agent 行为。
- **completed phase 持久显示**：phase 是用户确认过的进度主干，完成后仍持续显示（✓），不因 `agent_start` 或 `/reload` 隐藏；只有整个 goal done / clear 后浮层才消失。
- **12 行折叠**：completed 先掉、in_progress/pending 最后留。溢出时 `+N more` 摘要。
- **空时隐藏**：无 plan 或 goal 不活跃时 `setWidget(key, undefined)`。
- **刷新时机**：`tool_execution_end`（toolName 是 dgoal_plan/dgoal_check）+ `agent_end` 推进 iteration 时。注意 `tool_execution_end` 只读 `getState()`，不 replay（branch stale）。

### 状态栏（现有，保留）

`ctx.ui.setStatus("dgoal", ...)` 显示 goal 级状态：
- `🔁 active #N`（N=iteration）
- `🔁 paused` / `🔁 starting…` / `🔁 rejected ×M`（M=rejectedCount）/ `🔁 done`

## 兜底（待定，拷问剩余项 25）

主代理不调 `dgoal_propose`（跑偏没产出 plan）时的处理，三种候选：降级提示 / 直接进 loop 让 agent 自建 / 报错中止。见 `30-路线图`。
