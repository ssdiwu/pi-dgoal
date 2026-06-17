# ADR 0003：dgoal_check 单工具承载自检与终审

## 背景

完成审核员（auditor）原是 `loop_complete` 内部自动 spawn 的隔离子进程，agent 不可控。引入 Task Plan 后，agent 执行中也有"自检某 step 是否真完成"的需求。

## 决策

auditor 改名 `dgoal_check`，**一个工具承载两种模式**：
- **阶段性自检**（agent 主动，执行中）：审单个 step 的 evidence 是否站得住，返回结果，goal 不变。
- **终审**（`dgoal_done` 内部调用）：审全 goal + 全 step，通过才关 goal。

审核逻辑只有一份（在 `dgoal_check`），`dgoal_done` 是"声明完成 + 内部触发终审 + 关 goal"的薄壳，终审复用 `dgoal_check`。

`dgoal_done` 内部自动触发终审（α），agent 调 `dgoal_done` 后不感知终审存在：通过则关 goal 发完成信号，不通过则拒绝、goal 保持 active、审报告注入让 agent 继续修。

## 为什么

**单工具两语义**：避免"dgoal_done 内置审核"和"外部审核工具"两套审核逻辑。同时呼应调研结论"iterative auditing dominates exhaustive auditing"——中途多次短审计胜过只在终点审一次。`dgoal_check` 自检模式让 agent 在关键节点早发现跑偏。

**α（done 内部自动终审）**：备选 β（agent 显式先 check 再 done，彻底解耦）会把"先审再完"变成两步显式调用，顺序靠 prompt 约束，agent 可能跳过 check 直接 done。α 保留"完成必审、不可绕过"的硬约束，agent 体验简单。

## 权衡

α 下 `dgoal_done` 内部耦合 `dgoal_check`（终审模式），不是完全解耦。但这正是要的——完成必须经独立审核，这个耦合是安全特性不是缺陷。`dgoal_check` 的自检模式独立可用，与终审职责分层不重叠（自检=step 级，终审=goal 级）。
