# ADR 0001：Task Plan 的 goal/step 两层分离

## 背景

引入 Task Plan 时，"plan 进 loop 后可不可改"出现直接冲突：既要"启动闸门确认方向"（要稳定性），又要"plan 指导 loop 更好循环"（要适应性）。单层 plan 模型无法同时满足。

## 决策

Task Plan 分离为两层，可变性相反：

- **Goal 层**（用户确认的结构化目标）：启动闸门确认后**冻结**，是整个 loop 的方向契约。
- **Step 层**（执行步骤）：进 loop 后 agent 可用 `dgoal_plan` 增改，completed 不回退（见 ADR 0005）。这是 TUI 浮层显示的部分。

## 为什么

两层分离解开张力：启动闸门确认 goal（方向正确性，用户掌控，解决纯 goal 范式"plan 跑偏不可见"）；loop 内可调 step（执行适应性，agent 掌控，解决纯 plan mode"plan 错了卡死"）；TUI 显示 step 进度，goal 稳定不晃。

## 权衡

备选是单层可变 plan（全可调）或单层冻结 plan（全只读）。单层可变会让用户确认的 plan 被 agent 改得面目全非，削弱启动闸门意义；单层冻结会让执行中发现 plan 错误时卡死或假完成。两层分离的代价是模型和状态机更复杂（goal 与 step 分开存储/恢复），但这是同时满足稳定性和适应性的必要成本。
