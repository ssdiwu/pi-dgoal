# Changelog

All notable changes to `pi-dgoal` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.1] - 2026-06-19

### Fixed

- **goal 终结对 TUI 渲染异常容错**：`dgoal_done` 成功后 `finalizeGoal` 调用主程序 TUI（完成浮层、状态栏清空）现用 try/catch 包裹，主程序 TUI 渲染异常（如 `Spacer is not defined`）不再阻断 goal 状态清空——UI 展示失败时 goal 仍正确落 `done` 并清空，避免 goal 卡死无法关闭。

## [0.4.0] - 2026-06-19

### Added

- **`/dgoal` 单字母命令**：用户现在可以用 `/dgoal s`、`/dgoal p`、`/dgoal r`、`/dgoal c` 分别执行查询、停止、继续和清理

### Changed

- **命令提示文案**：Ctrl+O 浮层、状态输出和中英文说明文档同步改为展示全拼 + 单字母快捷形式，英文帮助使用 `[s]tatus` / `[p]ause` / `[r]esume` / `[c]lear`

### Removed

- **移除 `/dgoal stop` 别名**：`stop` 不再映射到 `clear`；请改用 `/dgoal clear` 或 `/dgoal c`

### Fixed

- **TUI 计时器图标渲染**：浮层标题栏的计时器改为显式 emoji 形式 `⏱️`（附带 variation selector），避免部分终端按文本字符样式渲染成黑白字形

## [0.3.0] - 2026-06-18

### Fixed

- **Task ID 编号**：`proposalToPlan()` 中 phase 和 task 各自从 1 编号（原共用计数器导致 phase 抢 ID=1，task 从 2 起步）
- **blockedBy 映射**：proposal 中 `blockedBy` 的 phase 内 1-based 索引现在正确映射到全局 task ID（原直接透传导致引用错位）
- **阶段顺序执行**：system prompt 新增阶段顺序硬约束；`dgoal_plan` 工具侧新增 `enforcePhaseOrder()` 防护，拦截跨 phase 操作
- **TUI goal done 后不消失**：`finalizeGoal()` 现在调用 `planOverlay.dispose()` 清除浮层
- **TUI 最后阶段不显示完成状态**：done 状态下不再隐藏已完成 phase，展示完整最终结果（全 ✓ + N/N）
- **建检子进程空闲超时误判**：`dgoal_check` / auditor 子进程现在在收到任意 `stdout` 数据块时就续命，不再等完整换行 JSON 才重置 watchdog，避免半行流式输出被误杀
- **建检子进程收尸不完整**：超时/中断时改为优先终止 detached process group，避免孙进程继承 pipe 导致 `close` 长时间挂住

### Changed

- **PlanStatus 终态命名统一为 `done`**：task/phase 的终态从 `completed` 统一改为 `done`（与 goal 层 `LoopStatus.done` 一致），涉及类型定义、TUI 图标、system prompt、工具描述、错误消息全链路
- **启动闸门默认展示摘要**：确认 UI 默认展示 goal / verification / phases / task 数量，用户按需展开 task 明细，避免初始对话被细粒度 task 淹没
- **verification 必填**：`dgoal_propose` 的 `verification` 从可选改为必填（工具 schema + `validateProposalInput` 工具层校验），没有可验收完成口的 goal 在工具层直接拒绝，不进入启动闸门确认；空话拦截靠 prompt 引导 + 终审兜底（ADR 0007）

### Added

- **TUI 计时器**：浮层标题栏显示已用时间（如 `⏱️ 2m 34s`）
- **TUI done 延迟消失**：goal 完成后浮层保留最终状态展示 10 秒后自动隐藏（agent 在当前 phase 未完成时直接开始后续 phase 的 task）
- **子进程监督回归测试**：新增 `subprocess-supervision.test.ts`，复现父进程退出但孙进程继承 pipe 的收尸场景

## [0.2.0] - 2025-06

### Added

- **Task Plan 三层内容**：goal（冻结）→ phase（阶段性目标）→ task（按需分解细粒度执行单元），支持 `dgoal_plan` 工具 CRUD
- **建检循环**：phase completed 唯一入口是 `dgoal_check`（独立只读子进程核验），不可绕过
- **启动闸门**：`dgoal_propose` 提交计划 → 用户确认 UI（确认/拒绝/反馈）→ 激活 loop
- **终审审核**：`dgoal_done` 触发独立只读子进程审核，连续 3 次不过自动暂停
- **计划浮层**：TUI aboveEditor widget 展示 plan 状态（phase 默认可见，task 可展开）
- **启动背景固化**：`/dgoal` 启动前自动从前文讨论提取结构化背景（目标范围/关键约束/验收标准），注入后续每轮 system prompt

### Changed

- 重命名 `pi-dloop` → `pi-dgoal`
- README 改为英文 facade 风格入口，中文文档移至 `README-zh.md`
- 建立完整设计文档体系（`doc/10-架构与运行/`、ADR 0001–0006）

### Fixed

- 完成后正确交回模型回复用户（不再自断续跑）
- 清理旧 dloop 残留引用

## [0.1.1] - 2025-05

### Added

- 启动前自动固化前文背景（summarizeContext 子进程）
- 模型错误自动重试（上限 3 次）
- 审核报告净化（去除噪音）

### Fixed

- 背景固化输入改用总量上限（原按消息数截断可能超限）
- 避免 loop context 在用户消息中完整展开（改用预览 + system prompt 注入双轨）
- 防止 Dloop 背景固化误导（明确标注为参考证据而非新指令）
- 删除审核进行中的残留通知，补审核通过结果通知

## [0.1.0] - 2025-05

### Added

- 初始版本：轻量目标循环扩展（`/dloop` 命令）
- 独立完成审核（in-process session 版，后重构为子进程）
- 审核器改为官方 CLI 子进程方式，纯只读
- 中文提示统一
