# ADR 0006：建检循环心智模型 + 三层结构 + 双可见性轴

> 本 ADR 是 dgoal 的基本盘决策，统领架构。细化了 ADR 0001 的结构（goal/step 两层 → goal/phase/task 三层内容）、ADR 0003 的 check 触发（绑定 phase 完成门）、ADR 0005 的术语（step → task）。

## 背景

507-grill 拷问 18-24 连续推进，引入三个相互关联的演进：goal/step 两层不够（要 phase 显式化）；可见性要把用户和 AI 分开（task 太细会淹没 TUI）；check 的颗粒度要和结构对齐。最后用"建检循环"这一第一性原理收口全部逻辑。

## 决策

### 1. 建检循环是基本盘（心智模型，不建模）

**定义**：dgoal 定义了 goal，定义了完成后要 check——不通过则继续干活，通过则结束。

两个粒度，统一用 `dgoal_check`：
- 阶段建检（小建检）：phase 标 completed 时触发。
- 终审（大建检）：最后一个 phase 标 completed 时升级为审全 goal（即 `dgoal_done` 内部走的 check）。

建检循环是心智模型，不新增状态/字段——两实例各有承载（phase 状态 / goal 的 rejected）。

### 2. 三层内容：goal / phase / task

- **Goal**：全局目标，确认后冻结（继承 ADR 0001 的"goal 层冻结"精神）。
- **Phase**：阶段性目标，状态由其下 task 聚合。
- **Task**：按需递归分解（ADaPT）的细粒度执行单元，`blockedBy` 依赖图表达分解关系，深度不限。

取代 ADR 0001 的"goal + 扁平 step 两层"。术语 step → task。

### 3. 双可见性轴（用户可见 vs AI 可见）

| 层级 | 用户可见（TUI） | AI 可见（context） |
|---|---|---|
| Goal | 可见（heading） | 可见 |
| Phase | 可见（默认） | 可见 |
| Task | **默认隐藏**，Ctrl+O 展开 | 可见 |

用户轴避免 TUI 被海量细 task 淹没（当前 10 行折叠预算）。AI 轴保证 AI 知道每步服务哪个 phase/goal，避免局部最优全局无用。

### 4. phase 由 task 聚合

phase 状态是其下 task 状态的派生（有 in_progress→in_progress；全终态→completed；有 blocked 无 in_progress→blocked）。agent 不能直接标 phase completed，只能标 task。**phase completed 的唯一入口是 dgoal_check**（阶段建检门）。空 phase（未拆 task）允许直接标 blocked。

### 5. check 绑定 phase 完成门

`dgoal_check` 不是"agent 想自检就调"的独立工具（修订 ADR 0003），而是 phase 标 completed 的强制触发门：
- dgoal_plan 只能标 task（本地快操作）。
- 标 phase completed 必须走 dgoal_check（spawn 独立子进程审计，重操作）。
- 最后一个 phase 的 check = 终审。

颗粒度对齐：task 级不 check（太细），phase 级阶段建检，goal 级终审。

## 为什么

**建检循环**统一了 dgoal 的核心逻辑，让"为什么 phase 要 check""为什么终审要独立""为什么不过要重回"有单一解释。它是第一性原理，不是实现细节。

**三层 + 双可见性**：两层（goal/step）无法表达"阶段性目标显式化"（拷问 18）+ "细粒度执行不淹没 TUI"（拷问 21）+ "AI 看全层避免局部最优"（拷问 18/21）三个诉求。三层内容 + 把可见性拆成用户/AI 两轴，同时满足。

**blockedBy 涌现分解（ADaPT）**：调研证明按需递归分解不需要预定义层级，blockedBy 依赖图就够，且深度不限、TUI 按拓扑折叠可控。比固定三层嵌套（拷问 19 的选 3）灵活且不爆炸状态机。

**phase 聚合 + check 门**：建检模式的核心是"enforce in framework not in prompt"（在框架里强制而非靠 prompt 恳求）+ "不让学生判卷"。phase 由 task 聚合（agent 不能虚报 phase 完成）+ phase completed 必过 dgoal_check（独立审计不可绕），在工具边界上锁死了建检的不可绕过性。

## 权衡

**建检循环备选是显式建模（check_round 历史）**：重复存储 check 结果与状态机，违反 DRY，无第三个需要独立建模的实例。作为心智模型 + 术语更有价值。

**三层结构备选**：
- 两层（goal/task）：丢"阶段性目标显式化"，启动闸门确认时层次不直白。
- 任意嵌套树（拷问 19 选 3）：TUI 有限行数展示不下，状态机爆炸（父完成语义模糊）。
三层 + blockedBy 涌现分解兼顾：结构可控 + 深度不限 + TUI 可展示。

**双可见性备选是单可见性**：要么 task 全显（淹没 TUI），要么 task 全隐（用户无法查细节）。双可见性 + Ctrl+O 按需展开是唯一兼顾项。

**check 绑定 phase 备选是 agent 主动调 check**：软约束可绕。绑定 phase 完成门是硬约束，落实建检模式。

## 代价

三层内容比两层多一个 phase 实体 + 聚合逻辑。Ctrl+O 展开需要 TUI 交互。但这些都是明确诉求（阶段显式化 + 细节可查）的必要成本，且有调研证据（ADaPT / 建检模式）支撑，非假设性设计。
