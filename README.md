# pi-dgoal

English | [中文](./README-zh.md)

A Pi extension that matches planning assurance to the work: **Task Plan** gives agents a lightweight default for ordinary multi-step execution, while explicit dgoal runs can add independently audited **Phase Plans** or **Goal Plans** when the outcome needs a stronger completion contract.

> **The next release is breaking** (ADR 0042): goal, visible phase, and task descriptions are required; `contextSummary` is removed; persistence moves to `dgoal-plan-v2`. `dgoal-plan-v1` activity is not migrated.

## Choose the Right Plan

| Plan | Choose it when | Who can start it | Independent audit |
|---|---|---|---|
| **Task Plan** | Clear multi-step work needs visible progress, not ceremony | Agent, when useful | None |
| **Phase Plan** | The goal needs a frozen completion contract and one final independent check | User explicitly invokes `/dgoal` or asks to use dgoal | `goal_check` |
| **Goal Plan** | Each delivery stage and the final outcome both need independent verification | Same | `phase_check` + `goal_check` |

### Start with Task Plan

Task Plan is the everyday structured path: the agent can turn a normal request into a visible, evidence-backed task list and keep moving until it closes. It skips proposal review, confirmation, and auditor overhead, so it fits implementation, debugging, documentation, migration, and other clear multi-step work.

It is not a ritual for every reply: discussions, explanations, capability questions, and one-step answers should not create a plan. An agent may not silently upgrade work to Phase Plan or Goal Plan; it can only recommend `/dgoal` when the user needs a frozen acceptance contract or independent auditing.

### Escalate Deliberately

Phase Plan adds a final independent review for the whole goal. Goal Plan adds a separate independent review at every phase **and** at final completion. Both are explicit user choices through `/dgoal`, so higher assurance never appears as hidden process overhead.

### Compose with dteam

Plan type determines progress structure and independent-audit density; [`dteam`](https://github.com/ssdiwu/pi-dteam) is an optional model-tier routing and fresh-context execution layer. It can be used on its own or inside a Task, Phase, or Goal Plan. For non-trivial repository work that still needs facts, the main agent can first dispatch bounded, complementary, read-only T3 probes, then synthesize their sourced reports and decide whether to close, implement, verify, or escalate.

dteam does not own or update Plan state, resolve user-only decisions, replace explicit `/dgoal` authorization and confirmation, run `phase_check` / `goal_check`, or perform the final `plan_update` closure. The Plan remains the progress and audit authority; dteam only executes the current bounded slice.

## Install

```bash
pi install npm:pi-dgoal
```

Load a development checkout directly:

```bash
pi -e ./index.ts
```

## Usage

### Ordinary work: Task Plan

Ask for a concrete multi-step task normally. When tracking adds value, the agent calls `task_plan`, then advances it through `plan_create` and `plan_update`. Calling `task_plan` again atomically replaces the objective, goal description, and all tasks. AFK, bounded, low-risk exploration with a clear stopping condition can use the same lightweight path.

```text
task_plan
→ plan_create / plan_update(task)
→ last task done (with evidence) automatically closes the goal
```

Task Plan has no startup review, confirmation dialog, or independent auditor, and it grants no extra tool permissions.

### Explicit dgoal: Phase Plan / Goal Plan

```text
/dgoal <clear objective>
```

An imperative such as “use dgoal to complete this objective” also enters the same explicit startup gate. The agent reads relevant code/docs, recommends Phase Plan or Goal Plan, submits frozen acceptance criteria, runs proposal semantic preflight, and waits for user confirmation.

```text
Phase Plan
phase_plan → plan_update(phase, done) × N
→ goal_check → plan_update(goal, done)

Goal Plan
goal_plan → [phase_check → plan_update(phase, done)] × N
→ goal_check → plan_update(goal, done)
```

A `check` records an audit result only; it never marks a phase or goal done. Only `plan_update` changes completion state and UI. Any plan mutation increments its revision, invalidating stale approvals; if the revision changes while an audit is running, that result is discarded and must be rerun.

### Commands

```text
/dgoal <objective>   Start Phase/Goal Plan selection and confirmation
/dgoal               Continue the preceding context into the startup gate
/dgoal status | s    Show the full plan
/dgoal pause  | p    Pause
/dgoal resume | r    Resume
/dgoal clear  | c    Clear
/dgoal help   | h    Explain current behavior
```

## Eight Tools

| Tool | Responsibility |
|---|---|
| `task_plan` | Create or fully replace a Task Plan, including goal/task descriptions |
| `phase_plan` | Submit an explicitly activated Phase Plan with required goal/phase descriptions and a frozen goal contract |
| `goal_plan` | Submit an explicitly activated Goal Plan with required descriptions and frozen phase/goal contracts |
| `plan_create` | Add a task with a required description; never add a phase |
| `plan_read` | Read a plan, goal, phase, or task; pure read: plan/goal return aggregate phase/task progress for the whole Plan, while phase/task return one compact item; no raw Plan payload (Task Plan hides its phase) |
| `plan_update` | Sole agent-facing writer for task/phase/goal progress, phase/task description revisions, completion, and agent pause |
| `phase_check` | Independently audit a Goal Plan phase; write a CheckRecord only |
| `goal_check` | Independently audit the whole Phase/Goal Plan; write a CheckRecord only |

Tool names follow a two-word rule and do not use a `dgoal_` prefix. `dgoal` remains the product and user-command name.

Phase and task identifiers use separate namespaces: each starts at `1`, while task IDs remain unique across the whole Plan so `blockedBy` can reference tasks in the same or an earlier phase. Typed tool targets disambiguate phase `#1` from task `#1`; `nextId` allocates tasks only. `plan_read(target=plan|goal)` aggregates phase/task progress (done/total) across the whole Plan; `target=phase|task` returns only that item.

Every goal, visible phase, and task carries a required **Description**: why it exists, how it serves its parent, why the current method was chosen, and which method drift to avoid. It is authoritative execution guidance, not a parallel audit gate. Phase/Goal Plan goal descriptions freeze at confirmation; phase/task descriptions may be explicitly revised through `plan_update`, which invalidates stale approvals. Hard method constraints belong in `guardrails` or `acceptanceCriteria`.

## Completion Guards

- **Task Plan:** every task must carry reproducible evidence and be done; the final task update atomically closes the goal. Blocked tasks do not count as complete.
- **Phase Plan:** a phase may be marked done only after every task is done; blocked still means incomplete. The goal requires all phases done plus a current-revision approved `goal_check`.
- **Goal Plan:** each phase additionally requires a current-revision approved `phase_check`; the goal likewise requires `goal_check` approval.
- Check results are `approved | rejected | audit_error`. Rejection keeps work active for repair; audit errors pause safely.

## Startup Semantics and Boundaries

Phase/Goal proposals follow “thin proposal, hard execution” (ADR 0037):

- deterministic code validates structure, state, Plan type, and explicit authorization;
- the current session model classifies independently verifiable criteria, non-blocking `userReviewItems`, and true human blockers;
- actual action permissions remain governed by host tools and execution boundaries, not proposal keywords;
- independent auditors verify only the user-confirmed frozen contract.

Implicit proposals, `implicitFinalOnlyStart`, `implicitFinalOnlyBudget`, bounded/unbounded runtime budgets, and verification-policy switches are removed. Fixed technical circuit breakers remain: model error, no progress, auditor failure, and audit timeouts; user interruption pauses explicit Phase/Goal Plans, while a Task Plan remains active for the next user turn. When a user decision is required, the agent calls:

```text
plan_update(target=goal, status=paused, reason="specific blocker")
```

## TUI

- **Persistent widget:** Task Plan lists tasks; Phase/Goal Plan lists phases; headings preserve aggregate progress while truncating the objective to the current terminal width.
- **`Ctrl+O`:** expands tasks and audit activity under Phase/Goal Plan phases; the ten-second completion snapshot shows every phase and task.
- **`/dgoal s` modal:** a two-level browser. The list shows the full goal description and selectable phase/tasks; Enter opens full item details (description, status, dependencies, evidence, blocked reason), and Esc returns without losing the selection. Task Plan never exposes its hidden phase.
- **Status bar:** shows starting / active / paused / done.

State and persistence never depend on successful rendering. Widget, modal, status, or notification errors may degrade presentation but cannot block completion or recovery.

## Independent Auditing

`phase_check` and `goal_check` run isolated Pi subprocesses with fresh context and limited verification tools. They inherit the current session model by default, or use up to three ordered candidates:

```json
{
  "phaseAuditorModels": null,
  "goalAuditorModels": null,
  "proposalSemanticReviewIdleTimeoutSeconds": 60
}
```

Configure globally at `~/.pi/agent/pi-dgoal.json` or in trusted projects at `.pi/pi-dgoal.json`. Candidate syntax is `provider/model[:thinking]`. Business rejection never changes candidates; only network, protocol, timeout, zero-output, or similar technical failures do. Exhaustion pauses safely.

Legacy single-candidate `phaseAuditorModel`, `goalAuditorModel`, and `auditorModel` keys remain config-compatible. Historical `implicitFinalOnlyStart` / `implicitFinalOnlyBudget` keys are ignored and may be removed.

## Persistence

Current plans use the `dgoal-plan-v2` custom entry. Old `dgoal-state`, `dgoal-goal-vnext`, and `dgoal-plan-v1` entries are intentionally ignored and not migrated. Reload strictly revalidates required descriptions, the Plan-specific frozen acceptance contract, IDs, statuses, dependencies, removed fields, and any pending proposal; one invalid part rejects the whole entry. A Pi session owns at most one current plan.

## Design Boundaries

- No multi-goal pool, daemon, scheduling, or cross-session background execution.
- No automatic Git commit, rollback, push, or release.
- Project tests remain authoritative; dgoal does not replace them.
- Phase/Goal Plans cannot add phases at runtime, only tasks.
- Visual and experiential checks belong in `userReviewItems`, not machine completion gates.

## Tests

```bash
npm test                    # Bun unit/integration suite
npm run test:rpc            # RPC loading and tool registration
npm run test:context        # Context-injection tests
npm run test:smoke:runtime  # Smoke runtime selection logic
npm run test:smoke          # Real-model isolated smoke (uses tokens)
```

Real TUI confirmation, modal, widget, and interaction behavior should still receive a manual smoke test; those checks are not machine completion gates.

## Project Layout

```text
pi-dgoal/
├── index.ts
├── src/
│   ├── plan/          # Data model and pure helpers
│   ├── runtime/       # Three-Plan runtime, startup gate, tools, lifecycle
│   ├── startup/       # Extension event wiring and default guidance
│   ├── goal-runtime/  # Mutable session goal, proposal, continuation, and audit liveness state
│   ├── audit/         # Independent audit protocol and checkpoints
│   ├── isolated-pi/   # Isolated Pi subprocess
│   └── tui/           # Stateless scrolling, width, elapsed-time, and text-style helpers
├── test/
└── doc/
```

See [`doc/README.md`](./doc/README.md), the authoritative [`doc/术语表.md`](./doc/术语表.md), [ADR 0038](./doc/决策档案/0038-三档Plan与八工具职责分离.md), [ADR 0039](./doc/决策档案/0039-Phase与Task使用独立ID命名空间.md), [ADR 0041](./doc/决策档案/0041-TaskPlan末任务自动收口.md), and [ADR 0042](./doc/决策档案/0042-三层Description必填并移除contextSummary.md).

## License

MIT
