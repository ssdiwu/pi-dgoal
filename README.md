# pi-dgoal

English | [中文](./README-zh.md)

A Pi extension with one Task Plan runtime and three assurance levels: agents can structure ordinary multi-step work by default, while explicitly activated dgoal runs can add independent phase and goal audits.

> **The next release is a breaking change** (ADR 0038): the old five-tool surface becomes eight two-word tools; Task Plan becomes the everyday default; Phase Plan and Goal Plan still require explicit dgoal activation. Old persisted state is not migrated.

## Three Plan Types

| Plan | Who can start it | Structure | Independent audit |
|---|---|---|---|
| **Task Plan** | Agent, when useful | Hidden single phase + tasks | None |
| **Phase Plan** | User explicitly invokes `/dgoal` or asks to use dgoal | 1..N phases + tasks + goal contract | `goal_check` |
| **Goal Plan** | Same | 1..N phases + tasks + phase/goal contracts | `phase_check` + `goal_check` |

Task Plan is the default structured path for clear multi-step execution, not a ritual for every reply. Discussions, explanations, capability questions, and one-step answers should not create a plan. An agent may not silently upgrade work to Phase Plan or Goal Plan; it can only recommend `/dgoal` when frozen acceptance or independent auditing is warranted.

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

Ask for a concrete multi-step task normally. When tracking adds value, the agent calls `task_plan`, then advances it through `plan_create` and `plan_update`. Calling `task_plan` again atomically replaces the objective and all tasks.

```text
task_plan
→ plan_create / plan_update(task)
→ plan_update(goal, done)
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
| `task_plan` | Create or fully replace a Task Plan |
| `phase_plan` | Submit an explicitly activated Phase Plan with a frozen goal contract |
| `goal_plan` | Submit an explicitly activated Goal Plan with frozen phase and goal contracts |
| `plan_create` | Add a task only; never add a phase |
| `plan_read` | Read a plan, goal, phase, or task; pure read (Task Plan hides its phase) |
| `plan_update` | Sole agent-facing execution-status writer for task/phase/goal progress, completion, and agent pause |
| `phase_check` | Independently audit a Goal Plan phase; write a CheckRecord only |
| `goal_check` | Independently audit the whole Phase/Goal Plan; write a CheckRecord only |

Tool names follow a two-word rule and do not use a `dgoal_` prefix. `dgoal` remains the product and user-command name.

## Completion Guards

- **Task Plan:** every task must carry reproducible evidence and be done; blocked tasks do not count as complete.
- **Phase Plan:** a phase may be marked done only after every task is done; blocked still means incomplete. The goal requires all phases done plus a current-revision approved `goal_check`.
- **Goal Plan:** each phase additionally requires a current-revision approved `phase_check`; the goal likewise requires `goal_check` approval.
- Check results are `approved | rejected | audit_error`. Rejection keeps work active for repair; audit errors pause safely.

## Startup Semantics and Boundaries

Phase/Goal proposals follow “thin proposal, hard execution” (ADR 0037):

- deterministic code validates structure, state, Plan type, and explicit authorization;
- the current session model classifies independently verifiable criteria, non-blocking `userReviewItems`, and true human blockers;
- actual action permissions remain governed by host tools and execution boundaries, not proposal keywords;
- independent auditors verify only the user-confirmed frozen contract.

Implicit proposals, `implicitFinalOnlyStart`, `implicitFinalOnlyBudget`, bounded/unbounded runtime budgets, and verification-policy switches are removed. Fixed technical circuit breakers remain: user abort, model error, no progress, auditor failure, and audit timeouts. When a user decision is required, the agent calls:

```text
plan_update(target=goal, status=paused, reason="specific blocker")
```

## TUI

- **Persistent widget:** Task Plan lists tasks; Phase/Goal Plan lists phases; headings show aggregate progress.
- **`Ctrl+O`:** expands tasks under unfinished Phase/Goal Plan phases.
- **`/dgoal s` modal:** shows the full visible plan; Task Plan never exposes its hidden phase.
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

Current plans use the `dgoal-plan-v1` custom entry. Old `dgoal-state` and `dgoal-goal-vnext` entries are intentionally ignored and not migrated. A Pi session owns at most one current plan.

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
│   ├── audit/         # Independent audit protocol and checkpoints
│   ├── isolated-pi/   # Isolated Pi subprocess
│   └── tui/           # Status modal and rendering projections
├── test/
└── doc/
```

See [`doc/README.md`](./doc/README.md), the authoritative [`doc/术语表.md`](./doc/术语表.md), and [ADR 0038](./doc/决策档案/0038-三档Plan与八工具职责分离.md).

## License

MIT
