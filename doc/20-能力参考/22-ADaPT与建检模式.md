# 22 - ADaPT 与建检模式

> 2026-06 联网调研。支撑 dgoal 的按需递归分解（task/blockedBy）与建检循环。来源：kore.ai ADaPT、dev.to build-verify、pub.towardsai self-verification。

## 自适应模式（ADaPT / As-Needed Decomposition）

**核心**：任务分解不是一开始全做完，而是"按需递归分解"。executor 跑一个任务，跑不动（失败）时，planner 才把这个任务**动态分解**成子任务，递归下去。

区别于：
- **Plan-and-Execute**（一次性出完整 plan 再执行）：非自适应，一个子任务失败=整体失败。
- **ADaPT**：只有当 executor 无法完成时才分解，失败驱动递归分解，逐层下沉直到可执行。

### 对 dgoal 的启示

dgoal 的 **blocked + 接续机制 = ADaPT 的按需分解**：
- agent 跑某 task 跑不动 → 标 `blocked`（带 reason）
- 新建子 task（`blockedBy` 指向当前 task）拆解它
- 递归下去深度不限，但数据结构始终是扁平 task + blockedBy 依赖图

**关键启示**：深度不需要在数据模型里固定（不做任意嵌套树），靠 blockedBy 依赖图在运行时涌现分解。这调和了"想要任意深度分解"和"TUI 展示不爆炸"——想要 ADaPT 的能力 + 不想要显式嵌套树的复杂度，blockedBy 依赖图两者兼得。

## 建检模式（Build-Verify / Builder-Checker）

**核心**：写代码的 agent 和验证的 agent 必须分离，不能自己写自己验。两条铁律：

1. "Don't ask the same agent to write code and verify it — that's like having students grade their own exams."
2. 验证是**独立 agent + 独立 context + 明确 FAIL 权限**，没动力放行。

质量是 pipeline 不是 checkpoint——每个 phase 内嵌验证，不是末尾一次性。"enforce in framework not in prompt"（在框架里强制而非靠 prompt 恳求）。

### 对 dgoal 的启示（3 条）

**1. dgoal_check 的独立子进程架构已经做对了**。

建检模式要求"独立验证 agent"。dgoal 的 `dgoal_check` 是独立子进程（零上下文 + 只读工具），物理上拿不到主会话上下文——正是建检模式要求的"独立验证"。补一个 prompt 调优：验证 agent 要有"明确的 FAIL 权限和独立动机"（应当主动 FAIL，不偏袒）。

**2. evidence 形态必须是"可独立复验的"**。

建检模式里 validator 是"读 issue + 验收标准 + 跑测试"，验证**可执行的证据**，不是 agent 说"我做完了"。dgoal 的 task evidence 应是可被 dgoal_check 独立复验的命令/文件/测试结果（如"跑 `npm test auth` 全过"），而非 agent 文字自述（后者 agent 能编，前者 check 能复验）。

**3. check 绑定 phase 完成门 = enforce in framework**。

建检模式反对"靠 prompt 恳求 agent 自检"（软约束可绕）。dgoal 把 check 绑定在 phase 标 completed 的强制触发门上——agent 要标 phase completed 必过 dgoal_check，在工具边界上锁死不可绕过。这正是"enforce in framework not in prompt"。

## 两者结合 = dgoal 的建检循环

- ADaPT 提供"按需分解"（blocked + 接续 task）
- 建检模式提供"独立验证"（dgoal_check 独立子进程）
- 两者结合 = dgoal 的建检循环：推进（建）→ 独立 check（检）→ 过则进 / 不过则回（循环）

详见 `10-架构与运行/10-建检循环与三层结构.md`。
