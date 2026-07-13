# ADR 0029：语义预审可观测 idle timeout 与技术/语义分离

> Status：已实现。

`dgoal_propose` 启动前语义预审此前用 30s 总时长超时，在 provider 排队或流式延迟时被误杀；且超时、网络异常与技术失败统一伪装成“请将人工体验移入 userReviewItems”的语义打回，误导 agent 反复改计划（真实样例：连续 5 次精确卡 30s，计划内容无关）。

## 决策

### 1. idle timeout 取代总时长超时

预审以流式接收当前会话模型响应（`streamSimple`），默认 60s **idle timeout**：无任何有效流事件才超时，收到任意事件（text/thinking/toolcall/done/error）重置计时器。慢但活跃的响应不被误杀。

可通过 `pi-dgoal.json` 的 `proposalSemanticReviewIdleTimeoutSeconds`（正整数秒，1..3600，非法值回退默认 60s 并告警）配置；项目级优先于全局。

### 2. 技术失败与语义打回分离

预审终态拆为四类：

- `approved` / `rewritten`：语义通过或改写，写入 `pendingProposal`。
- `rejected`：语义打回，`isError:false`，带 criterion 级可修正意见；agent 据此重提。
- `technical_error`：认证、idle timeout、网络、非终止响应、JSON 解析等基础设施失败，`isError:true`，明确提示“这不是计划内容问题；可稍后重试 /dgoal，或检查模型/网络可用性”。

不再把技术失败伪装成语义打回，避免误导 agent 改计划。

### 3. 可观测过程

预审过程通过工具 `onUpdate` 输出活性状态（认证中/接收评审结果/校验评审 JSON）与空闲倒计时，类比 `dgoal_check` 的建检活性。半截 JSON 不作为改写建议采用；只有完整解析并通过迁移映射校验的最终结果才写入 `pendingProposal`。

## 边界

预审与 `dgoal_check` / `dgoal_done` 的隔离建检共享“有事件续命、无进展才超时”的计时理念，但预审：

- 不启动隔离 Pi 子进程；
- 不授予 `read/bash` 等工具；
- 不走 phase/goal 审核候选链；
- 不认 `<APPROVED>` / `<REJECTED>` 标记；
- 不做部分审核报告续审；
- 不写建检反馈、Goal Repair 或审核用量账本。

候选回退先作为适配器支持的能力位置保留，不在没有真实预审多模型需求时启用。本轮只证明“预审要可观测、要按活性超时”，未证明“预审也需要专用候选链”。