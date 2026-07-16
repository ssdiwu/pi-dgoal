# pi-dgoal

[English](./README.md) | 中文

Pi 扩展：让计划保障强度匹配工作本身。**Task Plan** 是 agent 处理日常多步任务的轻量默认；用户显式启动 dgoal 后，可选择带独立审核的 **Phase Plan** 或 **Goal Plan**，为更重要的交付冻结完成契约。

> **v0.7.3 是破坏性升级**（ADR 0038）：公共工具从旧五工具改为八个两词工具；Task Plan 成为日常默认；Phase Plan / Goal Plan 仍需显式 dgoal 激活。旧持久态不迁移。

## 选择合适的 Plan

| Plan | 适用场景 | 谁能启动 | 独立审核 |
|---|---|---|---|
| **Task Plan** | 明确多步工作需要可见进度，但不值得走完整仪式 | agent 可按需主动建立 | 无 |
| **Phase Plan** | 目标需要冻结完成契约和一次最终独立核验 | 用户显式 `/dgoal` 或明确要求使用 dgoal | `goal_check` |
| **Goal Plan** | 每个交付阶段和最终结果都需要独立验证 | 同上 | `phase_check` + `goal_check` |

### 先从 Task Plan 开始

Task Plan 是日常结构化执行入口：agent 可以把普通请求转成可见、带证据的 task 列表，并持续推进直到关闭。它跳过提案预审、确认 UI 与 auditor 开销，适合实现、调试、文档、迁移等明确的多步工作。

它不是每条消息都要走的仪式：讨论、解释、能力问答和单步回答不建计划。AI 不得自行升级到 Phase Plan / Goal Plan；若用户需要冻结验收契约或独立审核，只能建议用户启动 `/dgoal`。

### 有意识地升级保障

Phase Plan 为整个目标增加一次最终独立审核；Goal Plan 则在**每个 phase**和最终完成时各做一次独立审核。二者都必须由用户通过 `/dgoal` 显式选择，保障强度不会变成隐藏的流程负担。

## 安装

```bash
pi install npm:pi-dgoal
```

开发目录直接加载：

```bash
pi -e ./index.ts
```

## 用法

### 普通任务：Task Plan

用户正常提出明确多步任务即可。agent 认为值得跟踪时调用 `task_plan`，随后用 `plan_create` / `plan_update` 推进。再次调用 `task_plan` 会原子替换 objective 与全部 task。

```text
task_plan
→ plan_create / plan_update(task)
→ plan_update(goal, done)
```

Task Plan 不经过启动审核、用户确认或独立 auditor，也不扩大宿主 agent 的工具权限。

### 显式 dgoal：Phase Plan / Goal Plan

```text
/dgoal <明确目标>
```

也可以在空闲会话中明确说“请使用 dgoal 完成这个目标”。两种入口都进入同一启动闸门：agent 先读相关代码/文档，推荐 Phase Plan 或 Goal Plan，提交冻结验收条件，经过 proposal 语义预审，再由用户确认。

```text
Phase Plan
phase_plan → plan_update(phase, done) × N
→ goal_check → plan_update(goal, done)

Goal Plan
goal_plan → [phase_check → plan_update(phase, done)] × N
→ goal_check → plan_update(goal, done)
```

`check` 只写审核结果；它不会把 phase 或 goal 标为完成。只有 `plan_update` 能改完成状态和浮层显示。任何计划写操作都会增加 revision，使旧 approval 自动失效；若审核运行期间 revision 已变化，本轮结果会被丢弃并要求重审。

### 命令

```text
/dgoal <objective>   启动 Phase/Goal Plan 选择与确认
/dgoal               承接前文启动
/dgoal status | s    查看完整 Plan
/dgoal pause  | p    暂停
/dgoal resume | r    恢复
/dgoal clear  | c    清除
/dgoal help   | h    查看说明
```

## 八个工具

| 工具 | 职责 |
|---|---|
| `task_plan` | 直接建立或整份替换 Task Plan |
| `phase_plan` | 显式启动 Phase Plan；冻结 goal 验收契约并进入确认 UI |
| `goal_plan` | 显式启动 Goal Plan；冻结 phase + goal 验收契约并进入确认 UI |
| `plan_create` | 只新增 task；不能新增 phase |
| `plan_read` | 读取 Plan、goal、phase 或 task；纯读（Task Plan 隐藏 phase） |
| `plan_update` | 唯一 agent 执行状态写工具：task / phase / goal 更新、完成与主动暂停 |
| `phase_check` | Goal Plan 的 phase 独立审核；只写 CheckRecord |
| `goal_check` | Phase/Goal Plan 的整体独立审核；只写 CheckRecord |

工具名遵循“两词原则”，不带 `dgoal_` 前缀；`dgoal` 只保留为产品名与用户命令。

phase 与 task 使用独立 ID namespace：二者都从 `1` 开始；task ID 在整个 Plan 内保持唯一，使 `blockedBy` 可引用同 phase 或更早 phase 的 task。类型化工具入口可区分 phase `#1` 与 task `#1`；`nextId` 只分配 task。已有持久 Plan 保留原编号。

## 完成守卫

- **Task Plan**：全部 task 必须带可复验 evidence 并进入 done；blocked task 不算完成。
- **Phase Plan**：phase 的 task 全部 done 后才可更新 phase done；blocked 表示尚未完成。所有 phase done、当前 revision 的 `goal_check` approved 后才可完成 goal。
- **Goal Plan**：phase 还必须有当前 revision 的 `phase_check` approved；goal 同样需要 `goal_check` approved。
- check 结果为 `approved | rejected | audit_error`。rejected 让 agent 修复并重审；audit_error 会安全暂停。

## 启动语义与边界

Phase/Goal Plan 的 proposal 采用“轻提案、硬执行”（ADR 0037）：

- 代码校验结构、状态、Plan 类型和显式授权；
- 当前会话模型判断计划是否可自主闭环，把主观体验迁移到 `userReviewItems`，真实人工 blocker 才拒绝；
- 真实动作权限由宿主工具和执行边界决定，不靠 proposal 关键词猜测；
- 独立审核器只核用户确认的冻结条件，不在执行中扩张完成门。

隐式 proposal、`implicitFinalOnlyStart`、`implicitFinalOnlyBudget`、bounded/unbounded runtime budget 与 verification policy 已删除。仍保留固定技术熔断：用户中断、模型错误、连续无进展、审核器错误与审核 timeout。agent 需要用户决策时用：

```text
plan_update(target=goal, status=paused, reason="具体 blocker")
```

## TUI

- **持续显示浮层**：Task Plan 默认列 task；Phase/Goal Plan 默认列 phase；heading 保留聚合进度，并按当前终端显示宽度裁切目标标题。
- **`Ctrl+O`**：展开 Phase/Goal Plan 的未完成 phase task。
- **`/dgoal s` Modal**：查看完整可见 Plan；Task Plan 不显示内部隐藏 phase。
- **状态栏**：显示 starting / active / paused / done。

状态机与持久化不依赖 TUI 渲染成功。`setWidget`、Modal、status 或 notify 抛错只能降级展示，不能阻断完成或恢复。

## 独立审核

`phase_check` / `goal_check` 运行 fresh context 的隔离 Pi 子进程，可使用受限核验工具。默认继承当前会话模型，也可配置最多 3 个有序候选：

```json
{
  "phaseAuditorModels": null,
  "goalAuditorModels": null,
  "proposalSemanticReviewIdleTimeoutSeconds": 60
}
```

配置位置：全局 `~/.pi/agent/pi-dgoal.json`，或受信任项目 `.pi/pi-dgoal.json`。候选格式为 `provider/model[:thinking]`。业务 rejected 不切换模型；只有网络、协议、timeout、零输出等技术异常才换候选，全部耗尽后暂停。

旧单值 `phaseAuditorModel`、`goalAuditorModel`、`auditorModel` 仍作配置兼容。历史配置中的 `implicitFinalOnlyStart` / `implicitFinalOnlyBudget` 已无效，可以删除。

## 持久化

当前 Plan 使用 `dgoal-plan-v1` custom entry。旧 `dgoal-state` 与 `dgoal-goal-vnext` 不读取、不迁移；升级后需要重新建立活动 Plan。一个 Pi session 同时只维护一个当前 Plan。

## 设计边界

- 不做多目标池、后台 daemon、定时任务或跨 session 调度。
- 不自动执行 Git commit、回滚、push 或发布。
- 不替代项目自己的测试命令；审核器会独立复验已有证据。
- Phase/Goal Plan 运行中不新增 phase，只能新增 task。
- 用户体验与视觉确认放 `userReviewItems`，不伪装成机器完成门。

## 测试

```bash
npm test                    # Bun 单元与集成测试
npm run test:rpc            # RPC 加载与工具注册
npm run test:context        # context 注入测试
npm run test:smoke:runtime  # smoke 运行时选择逻辑
npm run test:smoke          # 真实模型隔离 smoke（消耗 token）
```

真实 TUI 的启动确认、Modal、浮层和交互仍建议人工 smoke，不作为机器完成门。

## 项目结构

```text
pi-dgoal/
├── index.ts
├── src/
│   ├── plan/          # 数据结构与纯 helper
│   ├── runtime/       # 三档 Plan、启动闸门、工具与生命周期
│   ├── startup/       # 扩展事件注册与默认 guidance
│   ├── audit/         # 独立审核协议与检查点
│   ├── isolated-pi/   # 隔离 Pi 子进程
│   └── tui/           # 状态 Modal 与展示纯函数
├── test/
└── doc/
```

架构入口见 [`doc/README.md`](./doc/README.md)，术语权威见 [`doc/术语表.md`](./doc/术语表.md)，核心决策见 [ADR 0038](./doc/决策档案/0038-三档Plan与八工具职责分离.md) 与 [ADR 0039](./doc/决策档案/0039-Phase与Task使用独立ID命名空间.md)。

## 协议

MIT
