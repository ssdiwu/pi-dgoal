# Task Plan 设计底稿 — 507-grill 拷问过程（已归档）

> **已归档**：本文件是 507-grill 拷问过程记录（拷问 1-25）。稳定决策已迁入 `adr/0001-0006`，术语已入 `术语表.md`，正式架构文档在 `10-架构与运行/`。本文件保留为历史追溯，不再维护。阅读顺序：先读 `术语表.md` 和 `10-架构与运行/`，本文件仅作决策过程参考。

---

# Task Plan 设计底稿

> 状态：设计底稿（507-grill 拷问进行中）。本文件是 `/dgoal` 引入 Task Plan 的设计依据，不是最终规范。拷问收敛后，稳定决策迁入 `doc/adr/`，术语进 `doc/术语表.md`。

## 1. 背景：为什么要 Task Plan

dgoal 当前让 agent 围绕一个 `objective`（目标）持续跑到 `loop_complete`。代码现状三个摩擦点（带证据）：

- **只有"第几轮"没有"第几步"**：`formatStatus`（index.ts:1113）只输出 `🔁 active #3`，`iteration` 是循环轮数。用户看到"跑了 3 轮"，不是"计划 5 步完成 3 步"。目标整体推进到哪不可见。
- **Goal 只有 objective 文本，没有"打算怎么做"**：`LoopGoal`（index.ts:20-30）字段是 `id/objective/status/iteration/contextSummary`，无结构化计划。`loop_complete` 回溯时缺稳定对象说明"这次本来打算怎么做"。
- **没有 widget，只有一行 status bar**：全程 `ctx.ui.setStatus`，看不到计划推进。

## 2. 范式定位（基于联网调研）

三类范式对比（2026-06 调研）：

| 范式 | 解决 | 何时停 | 状态归属 |
|---|---|---|---|
| Plan Mode | "怎么做"——读代码、拆步骤、产出可审查计划 | 人点"接受"才停 | 磁盘 markdown 文件 |
| Agentic Loop | "自动多步执行" | 模型自己决定停 | 无持久状态，全在 transcript |
| Goal Mode | "何时允许停"——绑定可验证完成契约 | LLM 评估 Stop hook 契约 | 持久 goal 对象 + 状态机 |

**关键洞察（Cursor forum）**："Plans help the agent know **what to do**; Goal Mode defines **when the agent is allowed to stop**." Plan 不是自主完成契约。

**dgoal 已是 goal 范式**（持久 goal + loop_complete 审计 + Stop 语义）。Task Plan 是给 goal 补"怎么做"的结构化脚手架，**不退化成 plan mode**。

## 3. 两层分离（核心架构决策）

Task Plan 不是单一对象，而是两层，可变性相反：

### Goal 层（冻结契约）
- 启动闸门确认的对象，与用户达成一致。
- 进 loop 后**冻结**，是整个 loop 的方向契约。
- 对应现有 `LoopGoal.objective` 的升级：从一句话 objective 升级为"用户确认过的结构化目标"。

### Step 层（可调执行）
- 执行步骤，进 loop 后 agent 可用 `dgoal_plan` 工具增改。
- **completed 不回退**（拷问 1 决）；发现某步错了不回退，新建接续 step，`blockedBy` 指向原步（拷问 1 决）。
- **这是 TUI 浮层显示的部分**（参考 rpiv-todo overlay）——用户随时可见进度推进。
- `loop_complete` 前置检查：所有 step 全 completed 才放行。

### 两层分离解开的张力
- 启动闸门确认 **goal**（方向正确性，用户掌控）→ 解决纯 goal 范式"plan 跑偏不可见"。
- loop 内可调 **step**（执行适应性，agent 掌控）→ 解决纯 plan mode"plan 错了卡死"。
- TUI 显示 **step 进度**，goal 稳定不晃。

## 4. 已敲定的决策（拷问进度）

### 核心原理（拷问 24）
- **建检循环**是 dgoal 基本盘：定义 goal + 完成后 check，不过继续干，过则结束。两个粒度（phase 阶段建检 / goal 终审）统一用 dgoal_check。心智模型，不建模。详见 ADR 0006、术语表。

### 架构
1. **completed 不回退，新建接续 task**（拷问 1）：错了不回退，新建 task 接续，blockedBy 指向原 task。
2. **plan 必选**（拷问 2）：/dgoal 即复合目标，必须建 plan。
3. **启动闸门**（拷问 6）：整理 plan → 弹确认 UI → 确认后进 loop。
4. **goal 冻结 + 执行层可调**（拷问 7，演进于拷问 18-20）：goal 层冻结，phase+task 层可调。
5. **三层内容 goal/phase/task**（拷问 18-19）：取代两层。phase 是显式阶段，task 是按需分解细粒度。详见 ADR 0006。
6. **blockedBy 涌现分解**（拷问 19-20，B 路径）：task 间 blockedBy 依赖图表达分解，深度不限（ADaPT），取代固定嵌套层。
7. **双可见性轴**（拷问 21）：用户可见（task 默认隐藏 Ctrl+O 展开）/ AI 可见（三层全可见）。
8. **phase 由 task 聚合**（拷问 22）：phase 状态由其下 task 派生，空 phase 可直接 blocked。
9. **evidence 两层 + 可复验形态**（拷问 17）：task 级 evidence（可被 check 独立复验的命令/文件/测试结果）+ goal 级 verification（全局说明）。

### 工具规范化（拷问 9-11、23）
10. **工具回调落法**（拷问 9）：dgoal_propose 提交结构化 plan。
11. **统一 dgoal_ 前缀**（拷问 10）：loop_complete → dgoal_done，auditor → dgoal_check。
12. **dgoal_check 绑定 phase 完成门**（拷问 23）：dgoal_check 是 phase completed 唯一入口（阶段建检）；最后 phase 的 check = 终审；dgoal_done ≈ 标最后 phase completed + 关 goal。颗粒度：task 不 check，phase 阶段建检，goal 终审。

### 状态机（拷问 12-16）
13. **goal rejected + 3 次进 paused + pauseReason**（拷问 12-15）：终审不过进 rejected（硬约束重回）；×3 转 paused(audit_failed_3x)，resume 清零；异常中断的 paused resume 不清零。
14. **task blocked 状态**（拷问 16）：四态，blocked 带 reason，可回退 in_progress，不触发 goal 停止。

### 工具清单
- `dgoal_propose`：启动闸门提交 goal + phases（+ 可选初始 task），触发确认 UI。
- `dgoal_plan`：task/phase CRUD（建/改状态/依赖/标 task completed/标空 phase blocked），纯本地快操作。
- `dgoal_check`：phase completed 唯一入口（阶段建检门）；最后 phase = 终审。
- `dgoal_done`：标最后 phase completed（走终审）+ 关 goal。
- `/dgoal` 命令 + pause/resume/clear/status 子命令（不变）。

### 工具规范化（拷问 10-11）
7. **统一 `dgoal_` 前缀**：工具命名规范化，对齐 `/dgoal` 命名。
8. **`loop_complete` 改名 `dgoal_done`**（拷问 11）：`complete`→`done`，`loop_complete` 是历史遗留（loop 时代），改名安全——dgoal 持久化靠 `dgoal-state` custom entry（非工具名 replay），工具名不是恢复键。
9. **`dgoal_check` 一个工具两语义**（拷问 11）：原 auditor 改名 `dgoal_check`，承载「阶段性自检」（agent 执行中主动调，审单个 step）+「终审」（dgoal_done 内部调，审全 goal）两种模式，审核逻辑只有一份。
10. **`dgoal_done` 内部自动触发终审**（拷问 12，α）：agent 调 dgoal_done → 内部跑终审 → 通过关 goal，不过拒绝。agent 不感知终审存在，完成必审不可绕过。

### 状态机（拷问 12-15）
11. **新增 `rejected` 状态**（拷问 12，取向 2）：终审不过进 rejected，硬约束重回——每轮 prompt 钉着未过审核问题，agent 无法假装没看见。
12. **3 次终审不过进 paused**（拷问 13-14，C）：不直接清退出，进 paused（paused 不自动续跑，不烧 token）。用户可 resume 或搁置。
13. **两种 paused 语义分离 + pauseReason 字段**（拷问 15，选择 1）：
    - 异常中断（user_abort / model_error / audit_error）：resume 不清零（瞬时故障，重试合理）
    - 能力到顶（audit_failed_3x）：resume 清零 rejected 计数（用户主动再给一次机会）
    - 用 `LoopGoal.pauseReason` 字段区分，resume 时按 reason 决定清不清零。

### 状态机全图
```
pending ──→ active ──→ done          (正常路径)
              │  ↑
              ↓  │ rejected         (终审不过，硬约束重回，prompt 钉问题)
              │  │  ×3终审不过
              ↓  ↓
            paused (audit_failed_3x) ──resume清零──→ active
            paused (user_abort/model_error/audit_error) ──resume不清零──→ active
```

### 工具清单
- `dgoal_propose`（新）：提交 goal + 初始 steps，触发确认 UI。
- `dgoal_plan`（新）：更新 step（status/blockedBy/增改），reducer 平移 rpiv-todo。
- `dgoal_check`（新，原 auditor）：阶段性自检（审单 step）+ 终审（审全 goal）两模式。
- `dgoal_done`（原 loop_complete）：声明完成 + 内部触发终审 + 关 goal。
- `dgoal_pause`（待定，拷问 10 提）：agent 主动暂停说"卡住"，呼应诚实失败。
- `/dgoal` 命令 + pause/resume/clear/status 子命令（不变，用户侧控制）。

## 5. 数据模型（三层内容）

```ts
interface LoopGoal { /* 现有字段 */
  objective: string;              // goal 文本简述
  verification?: string;          // goal 级验证（跨 phase 全局说明）
  plan?: TaskPlan;                // phase + task 两层
  pauseReason?: "user_abort" | "model_error" | "audit_error" | "audit_failed_3x";
  rejectedCount?: number;         // 终审连续不过计数，×3 转 paused(audit_failed_3x)
  /* status, iteration, contextSummary 等不变 */
}

interface TaskPlan {
  phases: Phase[];
  nextId: number;
}

interface Phase {
  id: number;
  subject: string;               // 阶段性目标
  description?: string;
  status: "pending" | "in_progress" | "completed" | "blocked";  // 由其下 task 聚合，空 phase 可直接 blocked
  tasks: Task[];                  // 该阶段的任务
  blockedReason?: string;         // 空 phase 直接 blocked 时的原因
}

interface Task {
  id: number;
  subject: string;
  description?: string;
  activeForm?: string;
  status: "pending" | "in_progress" | "completed" | "blocked";
  blockedBy?: number[];           // 依赖图（可跨 phase，深度不限 → 涌现分解）
  evidence?: string;              // 完成证据：可被 dgoal_check 独立复验的命令/文件/测试结果，非自述
  blockedReason?: string;         // blocked 时必带
}
```

持久化复用现有 `dgoal-state` custom entry（index.ts:505 `appendEntry` + index.ts:509 `loadGoal` last-write-wins），不另起载体。三层内容（goal/phase/task）都持久化（AI 可见 + compact 后可恢复）。

**状态机**：
- Goal: `pending | active | rejected | paused | done`
- Phase: `pending | in_progress | completed | blocked`（task 聚合）
- Task: `pending | in_progress | completed | blocked`（completed 不回退，blocked 可回退）

## 6. 启动闸门流程（待拷问 5 的落法后定细节）

`/dgoal <objective>` → 整理 plan（goal 层）→ 弹确认 UI → 确认/拒绝/反馈 → 进 loop。

**待定（拷问 5 悬而未决）**：整理 plan 用主代理（落法 X）还是带工具子进程（落法 Y）。倾向 X（主代理在真实上下文里整理，质量高、摩擦小），但有"主代理跑偏不产出 plan"的兜底问题待解。

## 7. TUI 浮层（借鉴 rpiv-todo）

照搬 `todo-overlay.ts` 结构：
- `pi.setWidget("dgoal-plan", factory, { placement: "aboveEditor" })`
- heading：`🎯 <objective 首行> (X/Y)`
- 每行：`├─ [符] subject`，符 ○/◐/✓
- completed 闪现（两 Set，agent_start 搬运）
- 12 行折叠，completed 先掉/pending 最后留
- 刷新：`tool_execution_end`(toolName=dgoal_plan) + `agent_end` 推进 iteration 时

## 8. 待 grill 拷问的张力点

1-15. ~~已决~~（架构/工具/状态机，见上方已決决策）
16. ~~step blocked~~ → **已决（拷问 16）**：加 blocked 状态。
17. ~~evidence 层级~~ → **已决（拷问 17）**：step 级 + goal 级分层；形态是可独立复验的命令/文件（建检模式启示）。
18-19. ~~goal/step 嵌套~~ → **已决（拷问 18-19）**：三层内容（goal/phase/task）+ blockedBy 涌现分解（ADaPT）。
20. ~~phase vs blockedBy 涌现~~ → **已决（拷问 20）**：B 路径，两层结构（goal + phase）+ task 的 blockedBy 涌现分解。
21. ~~task 可见性~~ → **已决（拷问 21）**：双可见性轴，task 默认隐藏（Ctrl+O 展开），AI 全可见。
22. ~~phase 状态来源~~ → **已决（拷问 22）**：phase 由 task 聚合，空 phase 可直接 blocked。
23. ~~check 颗粒度/触发~~ → **已决（拷问 23）**：check 绑定 phase 完成门，dgoal_check 是 phase completed 唯一入口，最后 phase = 终审。
24. ~~建检循环~~ → **已决（拷问 24）**：心智模型 + 核心术语（基本盘），不建模。

**剩余待拷问**：
25. **dgoal_propose 兜底**：主代理不调 dgoal_propose（跑偏没产出 plan）怎么办？降级提示 / 直接进 loop 自建 / 报错中止？
26. **dgoal_pause 工具**：要不要给 agent 主动暂停工具（拷问 10 提，未定）——现在有了 blocked/task 机制，可能不需要。
