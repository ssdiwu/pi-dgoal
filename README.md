# pi-dgoal

[中文说明](./README-zh.md)

A Pi extension that keeps an agent working on a goal until completion is independently verified — through a Task Plan and a build-check loop.

> **v0.2.0**: Task Plan (goal/phase/task) with startup gate + live overlay + build-check loop + final audit. See [CHANGELOG](#) or `doc/30-路线图`.

## Install

```bash
pi install npm:pi-dgoal
```

Then reload Pi:

```text
/reload
```

For local development:

```json
// ~/.pi/agent/settings.json
"../../Documents/codes/Githubs/pi-dgoal"
```

## Usage

Start a goal with a Task Plan:

```text
/dgoal Fix the failing tests in this project and verify the result
```

The startup gate shows the agent's proposed plan (goal + phases + tasks). Approve, reject, or give feedback before the loop begins.

During the loop:

- The agent updates task status via `dgoal_plan` (`pending → in_progress → completed | blocked`).
- Each phase completion is independently audited via `dgoal_check` (isolated subprocess with limited verification tools, including `bash`).
- A live overlay above the editor shows phase progress; tasks default-hidden, and follow Pi's `app.tools.expand` action (default `Ctrl+O`) when expanded.

Control the goal:

```text
/dgoal status       # current goal + iteration + status bar
/dgoal pause        # stop auto-continuation (keep goal)
/dgoal resume       # resume paused goal
/dgoal clear        # remove goal from session
```

Declare completion (triggers final audit):

The agent calls `dgoal_done(summary, verification)`. If the final audit passes, the goal closes and the loop stops.

## Tools

| Tool | Purpose |
|---|---|
| `dgoal_propose` | Startup gate: submit goal + phases + initial tasks. User confirms before loop begins. |
| `dgoal_plan` | CRUD on tasks (create / update / list / get). 4-state machine with `blockedBy` dependency tracking + cycle detection. |
| `dgoal_check` | Phase completion gate (spawns an isolated acceptance subprocess with fresh context and limited verification tools). Also the final-audit mechanism when called on the last phase. |
| `dgoal_done` | Declare goal completion. Triggers final audit internally; the only way to close a goal. |

## Design Boundaries

- Session-scoped: one active goal per Pi session. No global goal pool.
- Task Plan is mandatory: using `/dgoal` implies a compound goal that requires a plan. No empty-plan completion.
- Goal layer is frozen at gate confirmation; phase/task layers are adjustable inside the loop.
- Completed tasks don't roll back. A wrong step gets a follow-up task (`blockedBy` → original).
- Independent audit: the verifier is a separate `pi` subprocess with fresh context, no main-session history, no skills/extensions, and only limited verification tools (`read`, `grep`, `find`, `ls`, `bash`). Completion is not self-reported.
- No Git auto-actions, no replacement of project-specific tests, no fixed workflow engine.

## Goal Lifecycle

```text
pending ──→ active ──→ done                # happy path
              │  ↑
              ↓  │ rejected                # final audit failed; loop continues with audit report pinned
              │  │  ×3 final-audit failures
              ↓  ↓
            paused (audit_failed_3x) ──/dgoal resume──→ active
            paused (user_abort / model_error / audit_error) ──/dgoal resume──→ active
```

See `doc/术语表.md` for state definitions, `doc/adr/0004` for the rejected/paused contract, and `doc/10-架构与运行/` for the current implementation.

## Completion Audit

`dgoal_done` runs `dgoal_check` in final-audit mode: an isolated `pi` subprocess with fresh context and limited verification tools (`read`, `grep`, `find`, `ls`, `bash`).

```text
--no-session --no-extensions --no-skills --mode json --tools read,grep,find,ls,bash
```

- Approved: goal closes, loop stops, model receives a completion signal for the final user-facing reply.
- Rejected: goal enters `rejected`; the audit report is injected and pinned to each subsequent turn's prompt. Three consecutive rejections pause the goal; `/dgoal resume` clears the counter and retries.
- Audit error / abort / idle-timeout / no clear decision: goal is safely paused; `/dgoal resume` continues.
- Audit progress is streamed back through the tool call; if the check stops mid-way, partial output is still returned.
- Audit reports use a stricter acceptance style: GWT-like PASS / FAIL / BLOCKER items plus a code-and-doc consistency section.
- Escape hatch: `PI_DGOAL_NO_AUDIT=1` skips the audit (debugging only).

## Tests

```bash
npm test         # bun: full suite (95 tests across 8 files)
npm run test:rpc # python: RPC loading + command registration
```

Test files cover data model + persistence, plan reducer (state machine + cycle detection), overlay rendering, startup gate, state machine + prompt, end-to-end integration, tool execute real-path integration, and context hardening.

**TUI interaction behavior** (startup gate confirm UI, `dgoal_check` subprocess audit, terminal rejected re-loop, aboveEditor widget rendering) requires a manual smoke test in the Pi TUI with a real model.

## Project Layout

```text
pi-dgoal/
├── AGENTS.md
├── README.md
├── README-zh.md
├── doc/                          ← design + roadmap + history (中文)
│   ├── README.md
│   ├── 术语表.md
│   ├── 10-架构与运行/             ← current implementation
│   ├── 20-能力参考/               ← research references
│   ├── 30-路线图/                 ← roadmap
│   ├── 40-版本实施方案/           ← active versions
│   ├── 90-归档/                   ← historical
│   └── adr/                       ← architecture decision records
├── package.json
├── index.ts                       ← single-file extension (~2100 lines)
└── test/
    ├── context-input-cap.test.ts
    ├── task-plan-data-model.test.ts
    ├── dgoal-plan-reducer.test.ts
    ├── plan-overlay-render.test.ts
    ├── startup-gate.test.ts
    ├── state-machine-and-prompt.test.ts
    ├── e2e-integration.test.ts
    ├── tool-execute-integration.test.ts
    └── test-extension-rpc.py
```

## Documentation

Start at `doc/README.md` for the reading order. The build-check loop and three-layer content model are the basic principle; see `doc/adr/0006` for the foundational decision.

## License

MIT
