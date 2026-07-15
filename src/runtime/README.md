# runtime

工具实现、审计编排、prompt 构建与 TUI 渲染的承载层。管理 dgoal 工具（dgoal_propose/dgoal_plan/dgoal_check/dgoal_done/dgoal_pause）、命令处理、审计子进程编排、启动闸门逻辑与持久化。

`src/plan/`、`src/audit/`、`src/isolated-pi/`、`src/tui/` 已按真实职责迁出。可变会话状态归 `src/goal-runtime/state.ts` 单例；Pi 注册与事件订阅归 `src/startup/index.ts`。本模块被 startup 导入工具定义和事件处理函数（见 ADR 0024/0025）。

## 自然语言显式启动

冷会话中，若 Goal Runtime 已记录当前真实用户明确要求使用/启动 dgoal 的一次性授权，`dgoal_propose` 不设置 `implicit` 即可提交普通显式 proposal；只有结构校验和语义预审成功后才消费授权并创建 pending goal，失败不留半启动状态。该路径支持完整策略与计划内外部动作，但不扩张 `implicit=true` 的权限（ADR 0036/0037）。

## 轻提案、硬执行

`validateProposalInput` 只校验非空字段、层级、策略/预算组合等确定性不变量，不再用命令名、文件扩展名或 `API response JSON` 等 evidence 词形作语义硬门。当前会话 LLM 是 proposal 的唯一语义判断层：保留独立验收条件、迁移非阻塞用户复核、拒绝仍缺用户专属输入的真实 blocker；隐式 proposal 若只需显示计划补足授权，则返回 `requiresExplicitConfirmation` 并降级为普通 pending goal。已识别的高风险动作仍由 startup 注册的 `tool_call` preflight 拦截。

新隐式/自然语言启动只在结构与语义均成功后写 goal + pendingProposal；显式 `/dgoal` 已有 pending goal 的重提语义保持不变。`dgoal_done` auditor 在当前 tool result 与 `status=done` 之前运行，prompt 明确禁止要求后置结果预先存在；`final_only` 审核投影显式携带 `progressCompleted`。

## 语义预审可观测性

`dgoal_propose` 的启动前语义预审以流式接收当前会话模型响应，默认 60s idle timeout（无有效流事件才超时，收到任意事件重置；可通过 `pi-dgoal.json` 的 `proposalSemanticReviewIdleTimeoutSeconds` 配置）。预审过程通过工具 `onUpdate` 输出活性状态（认证中/接收评审结果/校验评审 JSON）与空闲倒计时。终态拆为 `approved` / `rewritten` / `rejected`（语义，`isError:false`）与 `technical_error`（基础设施失败，`isError:true`）。这与 `dgoal_check` / `dgoal_done` 的隔离建检共享“有事件续命、无进展才超时”的计时理念，但预审不启动子进程、不授予工具、不走审核候选链、不认 APPROVED/REJECTED 标记。

持续显示浮层在 goal 激活与 session 重同步时按 `setWidget` 能力确保初始化，不依赖宿主可能缺失的 `hasUI` / `mode` 标记；渲染异常仍只降级展示，不影响业务状态。

隔离建检区分模型和工具两种静默：模型思考/报告阶段保持 180s idle timeout；Pi 的 `tool_execution_*` 事件表明审核器正在跑内置工具时，窗口扩展到 1800s。`bash` 运行全量测试期间不会持续产生 child 事件，这个区分避免把正常的长验证误杀为 `auditor_error`。