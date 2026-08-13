# pi-dgoal

English | [中文](./README-zh.md)

A Pi extension that keeps **one Work List per session goal** and adds only the assurance the work needs. Ordinary work can remain a soft list; sustained execution and independent checks are separate, one-way upgrades on that same list.

> **v0.8.1 is a breaking release** (ADR 0051). The public surface is nine new tools, persistence moves to `dgoal-work-v1` plus `dgoal-plan-history-v1`, and active state from pre-v0.8.1 releases is intentionally not migrated.

## Choose the Right Assurance

| Mode | Choose it when | Continuation | Independent checks |
|---|---|---:|---|
| **Soft Work List** | The user explicitly wants tracking or to wait for a later input—not autonomous delivery | No | None |
| **Execution Plan** | The request has a clear deliverable the agent can complete without another user decision | Yes | None |
| **Goal Check Plan** | The final outcome needs an independent acceptance check | Yes | `goal_check` |
| **Staged Check Plan** | Real serial Phases and the final outcome each need independent checks | Yes | `phase_check` + `goal_check` |

The structure and assurance are orthogonal: a Work List may be flat or contain optional real Phases. A Phase exists only for a genuine serial boundary; there is no hidden Phase. A Plan Contract can only upgrade `execution → goal_check → staged_check` and keeps existing IDs, terminal states, and evidence.

Discussions, explanations, capability questions, and one-step answers should not create a list. Independent-check Profiles require explicit user authorization through `/dgoal` or an equally clear request; the agent must not silently add that assurance.

### Compose with dteam

[`dteam`](https://github.com/ssdiwu/pi-dteam) remains an optional model-tier routing and fresh-context execution layer. It can operate inside any Work List or Plan Contract. The main agent still owns scope, evidence synthesis, conflicts, and final state updates.

## Install

```bash
pi install npm:pi-dgoal
```

Load a development checkout directly:

```bash
pi -e ./index.ts
```

## Usage

### Passive tracking: Soft Work List

Use `work_list` only to record work for a later turn or when the user does not request completion now. A repair, implementation, validation, or other clear deliverable belongs in `execution_plan`, not a soft list.

```text
work_list
→ work_create / work_update(item)
→ every Work Item terminal and every real Phase explicitly done
→ automatic close + visible completion summary
```

A soft list persists across turns but starts no continuation, no no-progress counters, and no auditor. Its TUI projection says that it is saved and awaiting the next turn; it does not show a running elapsed timer or pause/resume controls. Description and evidence are optional while it remains soft. Once all Work Items are terminal (`done` or `abandoned`) and every real Phase is explicitly `done`, the current Goal is cleared atomically and the tool returns a structured completion signal.

### Sustained work: Execution Plan

`execution_plan` establishes or upgrades the same Work List to Until Done execution. Planned Work Items require Description; `done` requires reproducible evidence, and declared deliverables require one-to-one `deliverableEvidence`.

```text
execution_plan
→ work_create / work_update(item)
→ explicitly close each real Phase with work_update(phase, done)
→ work_update(goal, done): summary + verification
```

Execution Plan has fixed model-error and structured no-progress circuit breakers but no independent audit.

### Explicit dgoal: Goal Check / Staged Check

```text
/dgoal <clear objective>
```

An imperative such as “use dgoal to complete this objective” enters the same startup gate. The agent reads the relevant code and documentation, chooses Goal Check or Staged Check, submits independently verifiable acceptance criteria, passes semantic preflight, and waits for user confirmation. A rejected proposal or failed confirmation does not mutate the current Work List.

```text
Goal Check Plan
goal_plan → work_update(item/phase) → goal_check → work_update(goal, done)

Staged Check Plan
staged_plan
→ [work_update(item) → phase_check → work_update(phase, done)] × N
→ goal_check → work_update(goal, done)
```

A `check` records a `CheckRecord` only. It never marks a Phase or Goal done. Only `work_update` writes completion state; a stale or late result is discarded when the relevant revision, Goal, or session branch changes.

In Staged Check, non-terminal work must enter the confirmed Phase backbone while any Phase remains open. Once every Phase is explicitly done, `work_create` may add goal-level root follow-up without reopening or mutating a done Phase; that work must finish before the next `goal_check` and survives session reload.

## Nine Tools

| Tool | Responsibility |
|---|---|
| `work_list` | Create or atomically rewrite the current soft Work List |
| `execution_plan` | Create or upgrade to an Until Done Execution Plan |
| `goal_plan` | Submit a Goal Check Plan proposal with goal-level independent acceptance |
| `staged_plan` | Submit a Staged Check Plan proposal with Phase- and goal-level acceptance |
| `work_create` | Add a Work Item, or a real Phase when the active Profile permits it |
| `work_read` | Read full Goal, Work List, Phase, Work Item, deliverable/evidence detail, or session Plan Run History |
| `work_update` | Sole agent-facing writer for Work Item / Phase / Goal state and completion |
| `phase_check` | Independently check the current Staged Check Phase; record only |
| `goal_check` | Independently check the complete Goal; record only |

Tool names follow a two-word rule and do not use a `dgoal_` prefix. `dgoal` remains the product and user-command name.

Work Item IDs are unique across the whole Work List; Phase IDs use a separate namespace. Both start at `1`. `blockedBy` always references Work Item IDs, cannot form a cycle, and cannot point from an earlier Phase into a future Phase.

Goal and real Phase Descriptions are required. Work Item Description becomes required under every Plan Contract. Description explains purpose and method; it is execution guidance, not an extra acceptance gate. Hard completion conditions belong in `acceptanceCriteria`; subjective review belongs in `userReviewItems`.

## Completion and State Guards

- `done` never regresses. `abandoned`, `blocked`, and agent-initiated `paused` require reasons.
- A real Phase never auto-completes when its members are exhausted; `work_update(target=phase,status=done)` is always explicit.
- Goal Check and Staged Check completion require an approved `goal_check` for the current Work List revision.
- A Staged Check Phase requires an approved `phase_check` for its current local revision before `work_update` can mark it done.
- Business rejection keeps the Plan active for repair. `audit_error` pauses safely.
- Every close writes `done`, then a null tombstone, then clears continuation, proposal, liveness counters, check snapshots, and authorizations before UI after-effects. The returned `dgoal completion signal` contains summary and verification so closure is never silent.

## Commands

```text
/dgoal <objective>       Start Goal Check / Staged Check selection and confirmation
/dgoal                   Continue the preceding context into the startup gate
/dgoal status | s        Open current Work List and session History
/dgoal review            Inspect, revise, or confirm this session's saved proposal
/dgoal pause  | p        Pause an active Plan Contract
/dgoal resume | r        Verify current facts, then resume a paused Plan Contract
/dgoal clear  | c        Clear the current Goal / Work List
/dgoal history clear     Confirm and clear this session's Plan Run History
/dgoal help   | h        Explain current behavior
```

Soft Work Lists cannot enter Plan pause state. Fixed continuation circuit breakers apply only while a Plan Contract is active. No-progress detection observes structured tool activity and durable state changes; it never parses assistant prose or shell command strings.

## TUI

- **Persistent widget:** shows the active Profile, aggregate progress, real Phases, and current Work Items.
- **`Ctrl+O`:** expands Work Items and current audit activity.
- **`/dgoal s` modal:** lists the current Work List and Plan Run History; details show Description, status, dependencies, evidence, reasons, deliverables, and applicable check records.
- **Recovery hints:** a saved proposal points to `/dgoal review`; a cold-restored unfinished Plan points to `/dgoal resume`. Neither path opens a dialog or starts execution automatically.
- **Fail-soft:** widget, modal, status, or notification errors may degrade presentation but cannot block persistence, completion, or recovery.

Completed Phases remain visible in the TUI and History. In the execution prompt they are soft-forgotten to a title-only line so old details do not keep expanding model context.

## Independent Auditing

`phase_check` and `goal_check` run isolated Pi subprocesses with fresh context and limited read/verification tools. They inherit the current session model by default, or use up to three ordered candidates:

```json
{
  "phaseAuditorModels": null,
  "goalAuditorModels": null,
  "proposalSemanticReviewIdleTimeoutSeconds": 60
}
```

Configure globally at `~/.pi/agent/pi-dgoal.json` or in trusted projects at `.pi/pi-dgoal.json`. Candidate syntax is `provider/model[:thinking]`. Business rejection never changes candidates; only technical failures do. Exhaustion pauses safely. Legacy single-candidate model config keys remain accepted.

## Persistence and History

- `dgoal-work-v1` stores the one current Goal, Work List, optional Plan Contract, and pending proposal.
- `dgoal-plan-history-v1` stores append-only Plan Run History for the current session branch.
- History preserves structural completion evidence and check outcomes, but strips auditor reports, feedback, thinking, transcript, and mutation logs. History is read-only and cannot be resumed.
- Pre-v0.8.1 activity is intentionally ignored and not migrated. After upgrading, recreate the active Work List.
- On a cold `startup` / `resume`, the current Pi session branch restores a complete pending proposal without confirming it; `/dgoal review` is required. An active unfinished Plan Contract is first persisted in place as `paused(session_recovery)`. `/dgoal resume` then verifies `in_progress` work and external side effects before continuing the same Goal, Plan Run, Work List, and revision.
- `reload`, `session_tree`, and `session_compact` only resynchronize structure; they do not trigger the cold-recovery pause. Compaction may resume continuation for an active Plan when Pi is not already retrying. Soft Work Lists only restore structure and never enter recovery pause or continuation.
- If any dgoal session append throws, the current `SessionManager` is hard-locked: dgoal performs no compensating append, mutation, or continuation on that manager. A real task reopen/app restart must rebuild it from the last complete on-disk record; an incomplete or unreadable JSONL tail remains fail-closed until the session file is repaired or replaced.

## Design Boundaries

- One current Goal / Work List per session. Recovery reads only the latest `dgoal-work-v1` on the current session branch. Its current Goal must validate completely; an invalid latest Goal fails closed instead of reviving an older active Plan, and an invalid pending proposal is not restored. A Pi `fork` is a new session; a durable `dgoal-session-scope-v1` marker containing only the session ID excludes copied parent Plan / History entries. Recovery never searches other sessions and adds no goal pool, daemon, scheduler, or cross-session execution.
- No automatic Git commit, rollback, push, publish, or deployment.
- Project tests remain authoritative; dgoal does not replace them.
- Visual and experiential checks belong in `userReviewItems`, not machine completion gates.
- Staged Check Phase backbone is frozen after confirmation. Other Profiles may add real Phases only when they remain valid serial boundaries.

## Tests

```bash
npm test                    # Bun unit/integration suite
npm run test:rpc            # RPC loading and nine-tool registration
npm run test:context        # Context and acceptance-prompt tests
npm run test:smoke:runtime  # Deterministic smoke runtime logic
npm run test:smoke:cleanup  # Auditor subprocess cleanup smoke
npm run test:smoke          # Real-model isolated smoke (uses tokens)
```

Real TUI confirmation, modal, widget, and interaction behavior still needs manual review; automated tests do not claim human TUI acceptance.

## Project Layout

```text
pi-dgoal/
├── index.ts
├── src/
│   ├── work-list/     # Work List data model, validation, and reducer
│   ├── runtime/       # Nine tools, lifecycle, startup gate, persistence, prompts, TUI composition
│   ├── startup/       # Extension event wiring and default guidance
│   ├── goal-runtime/  # Session Goal, Plan Contract, continuation, history, and audit liveness state
│   ├── audit/         # Independent audit protocol and checkpoints
│   ├── isolated-pi/   # Isolated Pi subprocess
│   └── tui/           # Stateless scrolling, width, elapsed-time, and text-style helpers
├── test/
└── doc/
```

See [`doc/README.md`](./doc/README.md), [`doc/术语表.md`](./doc/术语表.md), [ADR 0051](./doc/决策档案/0051-单一工作清单与计划保障正交.md), [ADR 0052](./doc/决策档案/0052-同会话未完成计划原地恢复.md), and the [v0.8.1 implementation plan](./doc/40-版本实施方案/44-v0.8.1-单一工作清单与计划保障实施方案.md).

## License

MIT
