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

### Task DAG execution frontier

The current phase also exposes a derived Task DAG read model: ready tasks, waiting dependencies, transitive root blockers, and tasks immediately unlocked by completion of a ready task. The ready set is the current legal execution or delegation boundary; waiting and blocked tasks cannot advance. Ready means only that declared dependencies are satisfied, not that tasks are safe to run concurrently. The main agent still chooses the execution route, checks scope conflicts, verifies results, and updates Plan state.

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
→ final task: evidence + declared-deliverable evidence + completion review
→ automatic goal closure
```

Task Plan has no startup review, confirmation dialog, or independent auditor, and it grants no extra tool permissions. A task may optionally declare named deliverables—files, command results, or observable external states—with a required completion fact. Declared deliverables need one-to-one evidence before that task can be done. Before the final update closes a Task Plan, the main agent supplies a same-session structured review of every task description and declared deliverable; this is a self-check, not an independent audit.

### Explicit dgoal: Phase Plan / Goal Plan

```text
/dgoal <clear objective>
```

An imperative such as “use dgoal to complete this objective” also enters the same explicit startup gate. The agent reads relevant code/docs, recommends Phase Plan or Goal Plan, runs a concise proposal-quality check across the end-to-end result, applicable lifecycle/call paths, failure paths, and acceptance-contract alignment, then submits frozen acceptance criteria, runs proposal semantic preflight, and waits for user confirmation. This check directly corrects the proposal; it does not create a report, model call, state, or hard gate.

```text
Phase Plan
phase_plan → plan_update(phase, done) × N
→ goal_check → plan_update(goal, done)

Goal Plan
goal_plan → [phase_check → plan_update(phase, done)] × N
→ goal_check → plan_update(goal, done)
```

A `check` records an audit result only; it never marks a phase or goal done. Only `plan_update` changes completion state and UI. Plan writes invalidate the final `goal_check`; task/description changes invalidate only their own phase approval. If the relevant revision changes while an audit is running, that result is discarded and must be rerun.

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
| `task_plan` | Create or fully replace a Task Plan, including goal/task descriptions and optional task deliverables |
| `phase_plan` | Submit an explicitly activated Phase Plan with required goal/phase descriptions and a frozen goal contract |
| `goal_plan` | Submit an explicitly activated Goal Plan with required descriptions and frozen phase/goal contracts |
| `plan_create` | Add a task with a required description and optional declared deliverables; never add a phase |
| `plan_read` | Read a plan, goal, phase, or task; pure read: aggregate/item output includes the current frontier reason, next legal action, and current-phase Task DAG projection (ready/waiting/root blockers/immediate unlocks), plus only the latest applicable check/feedback/completion claim from existing evidence; task detail includes declared deliverables and their evidence; no raw Plan payload (Task Plan hides its phase) |
| `plan_update` | Sole agent-facing writer for task/phase/goal progress, phase/task description revisions, completion, and agent pause; final Task Plan completion also requires a structured self-review |
| `phase_check` | Independently audit a Goal Plan phase; write a CheckRecord only |
| `goal_check` | Independently audit the whole Phase/Goal Plan; write a CheckRecord only |

Tool names follow a two-word rule and do not use a `dgoal_` prefix. `dgoal` remains the product and user-command name.

Phase and task identifiers use separate namespaces: each starts at `1`, while task IDs remain unique across the whole Plan so `blockedBy` can reference tasks in the same or an earlier phase. Typed tool targets disambiguate phase `#1` from task `#1`; `nextId` allocates tasks only. `plan_read(target=plan|goal)` aggregates phase/task progress (done/total) across the whole Plan; `target=phase|task` returns only that item.

Every goal, visible phase, and task carries a required **Description**: why it exists, how it serves its parent, why the current method was chosen, and which method drift to avoid. It is authoritative execution guidance, not a parallel audit gate. Phase/Goal Plan goal descriptions freeze at confirmation; phase/task descriptions may be explicitly revised through `plan_update`, which invalidates stale approvals. Hard method constraints belong in `guardrails` or `acceptanceCriteria`.

## Completion Guards

- **Task Plan:** every task must carry reproducible evidence and be done; a task with declared deliverables also needs one-to-one deliverable evidence. The final update additionally carries a same-session completion review, then atomically closes the goal. Blocked tasks do not count as complete.
- **Phase Plan:** a phase may be marked done only after every task is done; blocked still means incomplete. The goal requires all phases done plus a current-revision approved `goal_check`.
- **Goal Plan:** each phase additionally requires a current-revision approved `phase_check`; the goal likewise requires `goal_check` approval.
- Check results are `approved | rejected | audit_error`. Rejection keeps work active for repair; audit errors pause safely.

## Startup Semantics and Boundaries

Phase/Goal proposals follow “thin proposal, hard execution” (ADR 0037):

- deterministic code validates structure, state, Plan type, and explicit authorization;
- the current session model classifies independently verifiable criteria, non-blocking `userReviewItems`, and true human blockers;
- actual action permissions remain governed by host tools and execution boundaries, not proposal keywords;
- independent auditors verify only the user-confirmed frozen contract.

Implicit proposals, `implicitFinalOnlyStart`, `implicitFinalOnlyBudget`, bounded/unbounded runtime budgets, and verification-policy switches are removed. Fixed technical circuit breakers remain: model error, no progress, auditor failure, and audit timeouts. No-progress detection is deterministic (ADR 0045): the LLM chooses whether to keep advancing or to pause for a true user-decision blocker, while the runtime never parses assistant prose or `bash` command text and observes only structured activity. Three consecutive turns with no tools pause immediately; eight consecutive turns with tool activity but no observable file, Plan, or independent-check result also pause. User interruption pauses explicit Phase/Goal Plans, while a Task Plan remains active for the next user turn. When a user decision is required, the agent calls:

```text
plan_update(target=goal, status=paused, reason="specific blocker")
```

## TUI

- **Persistent widget:** Task Plan lists tasks; Phase/Goal Plan lists phases; headings preserve aggregate progress while truncating the objective to the current terminal width.
- **`Ctrl+O`:** expands tasks and audit activity under Phase/Goal Plan phases; the ten-second completion snapshot shows every phase and task.
- **`/dgoal s` modal:** a two-level browser. The list shows the full goal description, current-frontier reason/next legal action, current-phase Task DAG projection, latest applicable audit projection, and selectable phase/tasks; Enter opens item details (description, declared deliverables and their evidence, status, dependencies, evidence, blocked reason, scoped frontier/graph state, and latest phase check/feedback), and Esc returns without losing the selection. Only the latest feedback/completion claim is exposed; the internal repair index stays hidden. Task Plan never exposes its hidden phase.
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

Current plans use the `dgoal-plan-v2` custom entry. Old `dgoal-state`, `dgoal-goal-vnext`, and `dgoal-plan-v1` entries are intentionally ignored and not migrated. Reload strictly revalidates required descriptions, optional declared deliverables and their evidence, the Plan-specific frozen acceptance contract, IDs, statuses, dependencies, removed fields, and any pending proposal; one invalid part rejects the whole entry. A Pi session owns at most one current plan. On `session_compact`, the persisted structural Plan is restored unchanged and re-injected as the execution authority; the compacted summary remains background only and cannot override task descriptions or declared deliverables.

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

See [`doc/README.md`](./doc/README.md), the authoritative [`doc/术语表.md`](./doc/术语表.md), [ADR 0038](./doc/决策档案/0038-三档Plan与八工具职责分离.md), [ADR 0039](./doc/决策档案/0039-Phase与Task使用独立ID命名空间.md), [ADR 0041](./doc/决策档案/0041-TaskPlan末任务自动收口.md), [ADR 0042](./doc/决策档案/0042-三层Description必填并移除contextSummary.md), [ADR 0045](./doc/决策档案/0045-LLM语义选择与运行时结构化活性熔断.md), and [ADR 0046](./doc/决策档案/0046-TaskPlan交付物与末任务自检.md).

## License

MIT
