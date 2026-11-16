# 31 - Plannotator 计划审阅扩展参考

> 调研对象：[`@plannotator/pi-extension`](https://www.npmjs.com/package/@plannotator/pi-extension) `0.24.1`（registry 查询于 2026-07-20）；源码范围为 [`backnotprop/plannotator/apps/pi-extension`](https://github.com/backnotprop/plannotator/tree/main/apps/pi-extension)。本文件只记录其已核实机制与对 pi-dgoal 的边界判断，不决定实现排期。

## 1. 总体判断

**Plannotator 可作为 dgoal 的可选浏览器审阅界面参考，但不能成为 Plan 状态、完成证据或独立审核的底座。**

它解决的是“人如何在浏览器中审阅、批注并批准 Agent 写出的 Markdown 计划”；dgoal 解决的是“会话内 Plan 如何持久化、按证据推进、独立建检并可靠收口”。两者的确认交互相邻，但状态与完成语义不同。

## 2. 已核实机制

### 2.1 文件型计划与浏览器审批

Plannotator 使用 `idle → planning → executing` 三态。planning 中 Agent 将计划写入 cwd 内的 `.md` / `.mdx` 文件，调用 `plannotator_submit_plan` 后打开浏览器 UI；用户可批准、带批注拒绝或带备注批准。计划再次提交时，UI 展示 Plan Diff。

- 依据：`apps/pi-extension/index.ts`、`tool-scope.ts`、`README.md`。
- 状态以 Pi `appendEntry("plannotator", ...)` 持久化，执行期每轮从磁盘重读计划文件。

### 2.2 进度与完成语义

执行进度来自 Markdown checklist 与 Agent 回复中的 `[DONE:n]` 标记；当 checklist 全部完成时，扩展将执行期收束。

这只是 Agent 自述与文件清单投影，不包含独立复验、证据字段或 revision（修订版本）失效。

- 依据：`apps/pi-extension/index.ts` 的 `turn_end` 进度跟踪及 `checklistItems.every((t) => t.completed)` 收束分支。

### 2.3 规划期的工具边界

planning 中 `write` / `edit` 被 `tool_call` 拦截，只允许 cwd 内 `.md` / `.mdx`；但 `bash` 不被硬拦截，破坏性命令禁令依赖 system prompt（系统提示）。

- 依据：`tool-scope.ts::isPlanWritePathAllowed` 与 `index.ts` 的 planning `tool_call` handler。

### 2.4 Phase 配置直接覆盖系统提示

全局或项目 `plannotator.json` 可按 `planning` / `executing` phase 配置模型、thinking、active tools 和 `systemPrompt` 模板。配置了 `systemPrompt` 时，`before_agent_start` 返回渲染后的文本作为 `systemPrompt`，即直接覆盖该 handler 看见的当前提示，而不是附加到其后。

- 依据：`config.ts`、内置 `plannotator.json`、`index.ts::before_agent_start`。
- 因此与同样在该事件注入上下文的扩展共同启用时，最终提示会受加载顺序影响。

### 2.5 无交互降级

`plannotator_submit_plan` 在没有 UI 或浏览器 HTML 时会自动转入 executing。

- 依据：`index.ts` 中 `if (!ctx.hasUI || !hasPlanBrowserHtml())` 分支。
- 这适合其“计划模式可在非交互环境继续”的产品目标，但不等于用户已确认计划。

### 2.6 可复用审阅事件

它公开 `plannotator:request` 与 `plannotator:review-result` 事件；其他扩展可请求 plan review，并异步接收浏览器审批或批注结果。

- 依据：`README.md` 的 Shared Plannotator event API、`plannotator-events.ts`。

## 3. 与 pi-dgoal 的关系

### 3.1 同思路

- 都有显式计划确认和会话持久化。
- 都让计划修订可回到用户复核。
- Plannotator 的 Plan Diff 可以帮助人理解一次 dgoal proposal 修订到底改了什么。

### 3.2 设计冲突：明确不借

1. **不以 Markdown 文件替代 dgoal Plan。** dgoal 的 goal / phase / task、Description、dependency、evidence 与 CheckRecord 是结构化状态；Markdown 只能是展示或导出，不能成为事实源。
2. **不以 checklist / `[DONE:n]` 替代完成守卫。** dgoal 必须保持 task evidence、Plan revision 使旧批准失效、check / update 分离及 fresh-context 独立审核。
3. **不让无 UI 自动通过 dgoal 启动闸门。** Phase / Goal Plan 的确认是显式用户授权；无交互只能保留 pending 或按 dgoal 自身失败/恢复语义处理。
4. **不采用 phase prompt 覆盖作为 dgoal 的状态控制。** dgoal 需要在 Pi 基础提示上追加运行中 Plan 上下文；覆盖会丢失宿主或其他扩展的提示，并引入加载顺序耦合。
5. **不把浏览器审阅变成自动完成门。** 视觉体验、用户批注和代码审阅适合 `userReviewItems` 或启动确认，不替代 `phase_check` / `goal_check`。

### 3.3 候选：有真实需求后再评估

1. **浏览器 proposal 审阅适配器**：将 dgoal 的 pending proposal 渲染为只读审阅页，接受批注后转为现有 feedback；确认后仍由 dgoal 自己激活 Plan。
2. **proposal 修订 Diff**：按 dgoal 的结构化 plan revision 做可视化差异，不落 Markdown 计划文件。
3. **用户代码复核入口**：借用其代码批注 UI 产出 `userReviewItems` 反馈；不得让其影响独立审核结论。

候选实现前需要有真实的 TUI 确认/反馈摩擦证据，并验证：浏览器渲染或事件失败不影响 dgoal 的 pending 状态、持久化与恢复。

## 4. 外部一手来源

- npm registry 元数据：`https://registry.npmjs.org/@plannotator/pi-extension`
- npm 包说明：`https://www.npmjs.com/package/@plannotator/pi-extension`
- 官方源码：`https://github.com/backnotprop/plannotator/tree/main/apps/pi-extension`
- `index.ts`：`https://github.com/backnotprop/plannotator/blob/main/apps/pi-extension/index.ts`
- `tool-scope.ts`：`https://github.com/backnotprop/plannotator/blob/main/apps/pi-extension/tool-scope.ts`
- 内置配置：`https://github.com/backnotprop/plannotator/blob/main/apps/pi-extension/plannotator.json`
