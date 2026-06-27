# pi-dgoal

[中文说明](./README-zh.md)

A Pi extension that keeps an agent working on a goal until completion is independently verified — through a Task Plan and a build-check loop.

> **v0.5.2**: build-check feedback persistence + event-stream auditor liveness + transparent auditor retries + gate-lock progression guard + bare `/dgoal` startup carryover. See `CHANGELOG.md` and `doc/40-版本实施方案/41-v0.5.2-建检反馈闭环增强实施方案.md`.

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

Or, after you've already aligned the goal in the current conversation, use bare `/dgoal` to carry that prior discussion into the startup gate. If there is no prior discussion to carry, dgoal does not hard-start; it asks for an explicit objective instead. Use explicit `/dgoal s` (not bare `/dgoal`) to view status.

The startup gate dialog shows a phase-level summary by default (goal + verification + phases + task counts), with an explicit entry to view task details on demand. Approve, reject, or give feedback before dgoal execution begins.

During dgoal execution:

- The agent updates task status via `dgoal_plan` (`pending → in_progress → done | blocked`).
- Each phase completion is independently audited via `dgoal_check` (isolated subprocess with limited verification tools, including `bash`).
- A live widget above the editor shows phase progress; tasks are hidden by default. Its expanded state follows Pi's `app.tools.expand` action (default `Ctrl+O`) and only expands pending / in-progress phases, while done phases stay persistently visible as title rows only. The bottom line keeps the shortcut plus common command descriptions.
- User-facing overlay, status, notification, and startup-gate text can follow `pi-di18n` when that extension is installed; model-facing prompts and tool schemas stay unchanged.

Control the goal:

```text
/dgoal status | s   # detailed query modal for full plan details, or an empty dgoal state when none is active
/dgoal pause  | p   # stop auto-continuation (keep goal)
/dgoal resume | r   # resume paused goal
/dgoal clear  | c   # remove goal from session
```

Declare completion (triggers final audit):

The agent calls `dgoal_done(summary, verification)`. If the final audit passes, the goal closes and dgoal execution stops.

## Tools

| Tool | Purpose |
|---|---|
| `dgoal_propose` | Startup gate: submit goal + phases + initial tasks. User confirms before dgoal execution begins. |
| `dgoal_plan` | CRUD on tasks (create / update / list / get). 4-state machine with `blockedBy` dependency tracking + cycle detection. |
| `dgoal_check` | Phase completion gate (spawns an isolated acceptance subprocess with fresh context and limited verification tools). Even on the last phase, it only checks that phase. |
| `dgoal_done` | Declare goal completion after all phases have passed `dgoal_check`. Triggers the goal-level final audit internally; the only way to close a goal. |

## Design Boundaries

- Session-scoped: one active goal per Pi session. No global goal pool.
- Task Plan is mandatory: using `/dgoal` implies a compound goal that requires a plan. No empty-plan completion.
- Goal layer is frozen at gate confirmation; phase/task layers are adjustable during dgoal execution.
- Completed tasks don't roll back. A wrong step gets a follow-up task (`blockedBy` → original).
- Independent audit: the verifier is a separate `pi` subprocess with fresh context, no main-session history, no skills/extensions, and only limited verification tools (`read`, `grep`, `find`, `ls`, `bash`). Completion is not self-reported.
- No Git auto-actions, no replacement of project-specific tests, no fixed workflow engine.

## Goal Lifecycle

```text
pending ──→ active ──→ done                # happy path
              │  ↑
              ↓  │ rejected                # final audit failed; dgoal continues with audit report pinned
              │  │  ×3 final-audit failures
              ↓  ↓
            paused (audit_failed_3x) ──/dgoal resume──→ active
            paused (user_abort / model_error / audit_error) ──/dgoal resume──→ active
```

See `doc/术语表.md` for state definitions, `doc/决策档案/0004` for the rejected/paused contract, and `doc/10-架构与运行/` for the current implementation.

## Completion Audit

`dgoal_done` runs the same isolated audit runtime used by phase checks, but at the goal level: an isolated `pi` subprocess with fresh context and limited verification tools (`read`, `grep`, `find`, `ls`, `bash`).

```text
--no-session --no-extensions --no-skills --mode json --tools read,grep,find,ls,bash
```

- Approved: goal closes, dgoal execution stops, model receives a completion signal for the final user-facing reply.
- Rejected: phase-check rejection is a normal business result (`isError: false`) that keeps the goal active but gate-locked to the current phase; final-audit rejection enters `rejected`, and the original report is injected and pinned to subsequent prompts. Three consecutive final rejections pause the goal; `/dgoal resume` clears the counter and retries.
- Audit error / abort / real idle-timeout / no clear decision: treated as `auditor_error` (`isError: true`) after up to 3 transparent retries; the goal is then safely paused and `/dgoal resume` continues.
- Audit progress is streamed back through the tool call, including liveness updates such as `thinking`, `tool_running`, and `idle Ns/120s`; if the check stops mid-way, partial output is still returned.
- Audit reports use a stricter acceptance style: GWT-like PASS / FAIL / BLOCKER items plus a code-and-doc consistency section.
- Escape hatch: `PI_DGOAL_NO_AUDIT=1` skips the audit (debugging only).

## Tests

```bash
npm test         # bun: full suite
npm run test:rpc # python: RPC loading + command registration
npm run test:smoke # python: AI-driven smoke (real model, isolated env) — costs real tokens
```

Test files cover data model + persistence, plan reducer (state machine + cycle detection), overlay rendering, startup gate, state machine + prompt, end-to-end integration, tool execute real-path integration, context hardening, and subprocess supervision for detached process-group cleanup.

**AI-driven smoke** (`npm run test:smoke`, `test/test-ai-smoke.py`): drives a real multi-phase dgoal in an isolated env (`pi -ne -e ./index.ts -ns -np --mode rpc`), auto-answering the startup-gate select and tracking the full `dgoal_propose → dgoal_plan → dgoal_check → dgoal_done` tool chain. Real model + real tokens, so not in CI.

**TUI interaction behavior** (startup gate confirm UI, real `dgoal_check` subprocess audit content, terminal rejected retry path, aboveEditor widget rendering) still requires a manual smoke test in the Pi TUI with a real model.

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
│   └── 决策档案/                  ← architecture decision records
├── package.json
├── index.ts                       ← single-file extension (~3040 lines)
└── test/
    ├── command-aliases.test.ts
    ├── context-input-cap.test.ts
    ├── task-plan-data-model.test.ts
    ├── dgoal-plan-reducer.test.ts
    ├── plan-overlay-render.test.ts
    ├── plan-status-pure.test.ts
    ├── plan-status-dialog.test.ts
    ├── show-status.test.ts
    ├── startup-gate.test.ts
    ├── state-machine-and-prompt.test.ts
    ├── e2e-integration.test.ts
    ├── tool-execute-integration.test.ts
    ├── subprocess-supervision.test.ts
    └── test-extension-rpc.py
```

## Documentation

Start at `doc/README.md` for the reading order. The build-check loop and three-layer content model are the basic principle; see `doc/决策档案/0006` for the foundational decision.

## License

MIT
