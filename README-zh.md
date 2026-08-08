# pi-dgoal

[English](./README.md) | 中文

Pi 扩展：每个 session Goal 只维护**一份 Work List**，并只增加当前工作真正需要的保障。普通任务可保持软清单；持续执行与独立建检是附着在同一清单上的正交、单向升级。

> **v0.8.1 是破坏性版本**（ADR 0051）：公共接口改为九个新工具；持久化切换到 `dgoal-work-v1` 与 `dgoal-plan-history-v1`；v0.8.1 之前的活动状态明确不迁移。

## 选择合适的保障

| 模式 | 适用场景 | 自动续跑 | 独立建检 |
|---|---|---:|---|
| **软性 Work List** | 普通多步工作值得跨 turn 跟踪 | 无 | 无 |
| **Execution Plan** | agent 必须 Until Done（持续执行） | 有 | 无 |
| **Goal Check Plan** | 最终结果需要独立终审 | 有 | `goal_check` |
| **Staged Check Plan** | 真实串行 Phase 与最终结果都需要独立建检 | 有 | `phase_check` + `goal_check` |

结构与保障彼此正交：Work List 可以完全平铺，也可以包含可选的真实 Phase。Phase 只代表真实串行边界，不再有隐藏 Phase。Plan Contract 只允许 `execution → goal_check → staged_check` 单向升级，并保持既有 ID、终态和证据。

讨论、解释、能力问答和单步回答不建清单。带独立建检的 Profile 必须由用户通过 `/dgoal` 或同等明确的祈使句授权；agent 不得静默增加保障。

### 与 dteam 组合

[`dteam`](https://github.com/ssdiwu/pi-dteam) 仍是可选的模型分级路由与 fresh context（新上下文）执行层，可在任意 Work List / Plan Contract 内使用。主代理始终负责范围、证据综合、冲突裁决和最终状态写入。

## 安装

```bash
pi install npm:pi-dgoal
```

开发目录直接加载：

```bash
pi -e ./index.ts
```

## 用法

### 普通任务：软性 Work List

值得跟踪时，agent 调用 `work_list`，再用 `work_create` / `work_update` 推进 Work Item。

```text
work_list
→ work_create / work_update(item)
→ 全部 Work Item 终结，全部真实 Phase 显式 done
→ 自动收口 + 用户可见完成总结
```

软清单跨 turn 持久化，但不启动 continuation（自动续跑）、no-progress 计数或 auditor（独立审核）。保持 soft 时，Work Item 的 Description 与 evidence 可省略。全部 Work Item 进入 `done` / `abandoned` 且真实 Phase 已显式完成后，当前 Goal 会原子清除，并返回结构化完成信号。

### 持续工作：Execution Plan

`execution_plan` 直接建立或把同一 Work List 升级为 Until Done（持续执行）合同。计划态 Work Item 必须有 Description；`done` 必须有可复验证据；声明 deliverable 后还必须逐项提供 `deliverableEvidence`。

```text
execution_plan
→ work_create / work_update(item)
→ 用 work_update(phase, done) 显式关闭每个真实 Phase
→ work_update(goal, done)：summary + verification
```

Execution Plan 有固定的模型错误与结构化 no-progress 熔断，但不启用独立建检。

### 显式 dgoal：Goal Check / Staged Check

```text
/dgoal <明确目标>
```

也可明确说“请使用 dgoal 完成这个目标”。agent 读取相关代码与文档，选择 Goal Check 或 Staged Check，提交可独立复验的验收条件，通过语义预审后等待用户确认。提案被拒或确认 UI 失败都不得改变当前 Work List。

```text
Goal Check Plan
goal_plan → work_update(item/phase) → goal_check → work_update(goal, done)

Staged Check Plan
staged_plan
→ [work_update(item) → phase_check → work_update(phase, done)] × N
→ goal_check → work_update(goal, done)
```

`check` 只记录 `CheckRecord`，不会把 Phase / Goal 标为完成。只有 `work_update` 能写完成状态；相关 revision、Goal 或 session 分支变化后，迟到审核结果会被丢弃。

Staged Check 中，只要仍有未完成 Phase，非终态工作就必须进入已确认的 Phase 主干。全部 Phase 显式 done 后，`work_create` 可以新增 goal-level 根 follow-up，而不重开或改写 done Phase；这些工作必须在下一次 `goal_check` 前终结，并可跨 session reload 恢复。

## 九个工具

| 工具 | 职责 |
|---|---|
| `work_list` | 创建或原子重写当前软性 Work List |
| `execution_plan` | 创建或升级为 Until Done 的 Execution Plan |
| `goal_plan` | 提交只有 goal 独立终审的 Goal Check Plan proposal |
| `staged_plan` | 提交 Phase + goal 均独立建检的 Staged Check Plan proposal |
| `work_create` | 新增 Work Item；当前 Profile 允许时也可新增真实 Phase |
| `work_read` | 读取完整 Goal、Work List、Phase、Work Item、交付物/证据详情或 session Plan Run History |
| `work_update` | Work Item / Phase / Goal 状态与完成的唯一 agent 写入口 |
| `phase_check` | 独立检查当前 Staged Check Phase；只记录结论 |
| `goal_check` | 独立检查完整 Goal；只记录结论 |

工具名遵循“两词原则”，不带 `dgoal_` 前缀；`dgoal` 保留为产品名与用户命令。

Work Item ID 在整份 Work List 内唯一；Phase ID 使用独立命名空间，二者都从 `1` 开始。`blockedBy` 只引用 Work Item ID，不能成环，也不能让较早 Phase 依赖未来 Phase。

Goal 与真实 Phase 的 Description 必填；进入任意 Plan Contract 后，Work Item Description 也必填。Description 说明目的与方法，是执行指导，不是额外验收门。硬完成条件进入 `acceptanceCriteria`；主观复核进入 `userReviewItems`。

## 完成与状态守卫

- `done` 不回退；`abandoned`、`blocked` 与 agent 主动 `paused` 必须说明原因。
- 真实 Phase 不会因成员耗尽自动完成；必须显式调用 `work_update(target=phase,status=done)`。
- Goal Check / Staged Check 的 Goal 完成要求当前 Work List revision 的 `goal_check` approved。
- Staged Check Phase 完成前，必须有当前 Phase local revision 的 `phase_check` approved。
- 业务 rejected 保持 active 供修复；`audit_error` 安全暂停。
- 任何收口都按 done → null tombstone → 清 continuation / proposal / 活性计数 / check snapshot / 授权 → UI 后效的顺序执行。返回的 `dgoal 完成信号` 带 summary 与 verification，不再静默关闭。

## 命令

```text
/dgoal <objective>       启动 Goal Check / Staged Check 选择与确认
/dgoal                   承接前文进入启动闸门
/dgoal status | s        查看当前 Work List 与 session History
/dgoal pause  | p        暂停 active Plan Contract
/dgoal resume | r        恢复 paused Plan Contract
/dgoal clear  | c        清除当前 Goal / Work List
/dgoal history clear     二次确认后清空当前 session 的 Plan Run History
/dgoal help   | h        查看当前行为说明
```

软性 Work List 不进入 Plan pause 状态。固定 continuation 熔断只在 Plan Contract active 时工作。no-progress 只观察结构化工具活动与持久状态变化，不解析 assistant 文本或 shell 命令字符串。

## TUI

- **持续浮层**：显示当前 Profile、聚合进度、真实 Phase 与当前 Work Item。
- **`Ctrl+O`**：展开 Work Item 与当前审核活性。
- **`/dgoal s` Modal**：同时浏览当前 Work List 与 Plan Run History；详情展示 Description、状态、依赖、证据、原因、deliverable 与适用 check。
- **fail-soft（失败降级）**：widget、Modal、status 或 notify 异常只能影响展示，不能阻断持久化、完成或恢复。

完成 Phase 在 TUI 与 History 中保持可见；进入执行 prompt 时只保留标题行，避免旧细节持续膨胀上下文。

## 独立建检

`phase_check` / `goal_check` 使用 fresh context（新上下文）与受限只读/核验工具运行隔离 Pi 子进程。默认继承当前 session 模型，也可配置最多 3 个有序候选：

```json
{
  "phaseAuditorModels": null,
  "goalAuditorModels": null,
  "proposalSemanticReviewIdleTimeoutSeconds": 60
}
```

配置位置：全局 `~/.pi/agent/pi-dgoal.json`，或受信任项目 `.pi/pi-dgoal.json`。候选格式为 `provider/model[:thinking]`。业务 rejected 不切换模型；只有技术失败才回退，候选耗尽后安全暂停。旧单模型配置键继续兼容。

## 持久化与 History

- `dgoal-work-v1` 保存唯一当前 Goal、Work List、可选 Plan Contract 与 pending proposal。
- `dgoal-plan-history-v1` 保存当前 session 分支的 append-only（只追加）Plan Run History。
- History 保留结构化完成证据与 check 结论，但删除 auditor 原始报告、feedback、thinking、transcript 和 mutation log；只读且不能 resume。
- v0.8.1 之前的活动状态明确忽略、不迁移。升级后需重新建立当前 Work List。
- `session_tree` / `session_compact` 只恢复严格校验后的结构化状态。压缩后，Pi 未自行 retry 时 active Plan Contract 会恢复 continuation；软性 Work List 不会。

## 设计边界

- 每个 session 只有一个当前 Goal / Work List；不做多目标池、daemon、定时器或跨 session 后台执行。
- 不自动执行 Git commit、rollback、push、publish 或部署。
- 项目测试仍是权威；dgoal 不替代目标项目测试。
- 视觉与体验检查放入 `userReviewItems`，不伪装为机器完成门。
- Staged Check 的 Phase 主干确认后冻结；其他 Profile 只在仍属真实串行边界时新增 Phase。

## 测试

```bash
npm test                    # Bun 单元与集成测试
npm run test:rpc            # RPC 加载与九工具注册
npm run test:context        # context 与验收 prompt 测试
npm run test:smoke:runtime  # 确定性 smoke runtime 逻辑
npm run test:smoke:cleanup  # auditor 子进程清理 smoke
npm run test:smoke          # 真实模型隔离 smoke（消耗 token）
```

真实 TUI 的启动确认、Modal、浮层与交互仍需人工复核；自动测试通过不等于人工 TUI 已验收。

## 项目结构

```text
pi-dgoal/
├── index.ts
├── src/
│   ├── work-list/     # Work List 数据模型、校验与 reducer
│   ├── runtime/       # 九工具、生命周期、启动闸门、持久化、prompt 与 TUI 组合
│   ├── startup/       # 扩展事件注册与默认 guidance
│   ├── goal-runtime/  # session Goal、Plan Contract、continuation、History 与审核活性
│   ├── audit/         # 独立审核协议与 checkpoint
│   ├── isolated-pi/   # 隔离 Pi 子进程
│   └── tui/           # 无状态滚动、宽度、耗时与文本样式 helper
├── test/
└── doc/
```

架构入口见 [`doc/README.md`](./doc/README.md)、[`doc/术语表.md`](./doc/术语表.md)、[ADR 0051](./doc/决策档案/0051-单一工作清单与计划保障正交.md) 与 [v0.8.1 实施方案](./doc/40-版本实施方案/44-v0.8.1-单一工作清单与计划保障实施方案.md)。

## 协议

MIT