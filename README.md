# pi-dgoal

[中文说明](./README-zh.md)

A Pi extension that keeps an agent working on a goal until completion is independently verified — through a Task Plan and a build-check loop.

> **v0.6.3**: the startup-gate semantic preflight now uses a 60s idle timeout (any stream event resets it) instead of a 30s wall-clock kill, streams liveness via `onUpdate`, and separates `technical_error` (`isError:true`, not a plan-content issue) from semantic `rejected` (`isError:false`). Configurable via `proposalSemanticReviewIdleTimeoutSeconds` in `pi-dgoal.json`. See `CHANGELOG.md` for details.
>
> **Previous**: v0.6.2 fixed auditor conclusion arbitration, per-candidate failover, and `/dgoal s` widget recovery; v0.6.0 introduced the vNext Goal Runtime (new persistence key, single-phase unified completion check, final-audit three-way attribution, src layering).

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

The startup gate runs structure validation, then a semantic preflight with the current session model, before writing `pendingProposal`. The preflight streams the model response with a 60s idle timeout (configurable via `proposalSemanticReviewIdleTimeoutSeconds` in `pi-dgoal.json`); any stream event resets the timer, so a slow but active response is not killed. Manual or subjective completion conditions are rejected or rewritten into `userReviewItems`. The preflight outcome distinguishes `approved` / `rewritten` / `rejected` (semantic, `isError:false`, with fixable reasons) from `technical_error` (auth, idle timeout, network, non-terminal, JSON parse; `isError:true`, not a plan-content issue). Only then does the dialog show a phase-level summary by default (goal + verification + acceptanceCriteria + userReviewItems + readiness + boundary gaps/signals + phases + task counts). Approve, reject, or give feedback before dgoal execution begins.

During dgoal execution:

- The agent updates task status via `dgoal_plan` (`pending → in_progress → done | blocked`).
- Each phase completion is independently audited via `dgoal_check` (isolated subprocess with limited verification tools, including `bash`).
- A live widget above the editor shows phase progress; tasks are hidden by default. Its expanded state follows Pi's `app.tools.expand` action (default `Ctrl+O`) and only expands pending / in-progress phases, while done phases stay persistently visible as title rows only. The bottom line keeps the shortcut plus common command descriptions.
- User-facing overlay, status, notification, and startup-gate text can follow `pi-di18n` when that extension is installed; model-facing prompts and tool schemas stay unchanged.

Control the goal:

```text
/dgoal status | s   # detailed query modal for full plan details; missing goal shows empty state, paused goal remains read-only
/dgoal pause  | p   # stop auto-continuation (keep goal)
/dgoal resume | r   # resume paused goal
/dgoal clear  | c   # remove goal from session
```

Declare completion (triggers final audit):

The agent calls `dgoal_done(summary, verification, whatChanged?, userReview?)`. The completion reply produces a structured, checkable text (what changed / how verified / what still needs your review) rather than just announcing "done". `done` means the frozen LLM-independent acceptance criteria passed; TUI, visual, and experience checks remain explicit non-blocking `userReview` items, and the completion text states that they are not evidence of completed manual experience validation. If the final audit passes, the goal closes and dgoal execution stops.

## Tools

| Tool | Purpose |
|---|---|
| `dgoal_propose` | Startup gate: submit goal + phases + initial tasks + frozen `acceptanceCriteria` (criterion + evidence for goal and each phase) + optional `userReviewItems`. User confirms before dgoal execution begins. |
| `dgoal_plan` | CRUD on tasks (create / update / list / get). 4-state machine with `blockedBy` dependency tracking + cycle detection. |
| `dgoal_check` | Phase completion gate (spawns an isolated acceptance subprocess with fresh context and limited verification tools). For single-phase goals, one audit covers both phase and goal, recording a unified audit credential (ADR 0018). |
| `dgoal_done` | Declare goal completion after all phases have passed `dgoal_check`. For single-phase goals, reuses the unified audit credential to close directly (no duplicate audit); for multi-phase goals, triggers a goal-level final audit with phase(id)/goal/user_review attribution. The only way to close a goal. |

## Design Boundaries

- Session-scoped: one active goal per Pi session. No global goal pool.
- Task Plan is mandatory: using `/dgoal` implies a compound goal that requires a plan. No empty-plan completion.
- Goal direction and goal/phase acceptance criteria are frozen at gate confirmation; during execution only phase/task progress, task decomposition, and evidence are adjustable. Acceptance criteria have no runtime update path.
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
            paused (user_abort / model_error / audit_error / no_progress) ──/dgoal resume──→ active
```

See `doc/术语表.md` for state definitions, `doc/决策档案/0004` for the rejected/paused contract, and `doc/10-架构与运行/` for the current implementation.

## Completion Audit

`dgoal_done` runs the same isolated audit runtime used by phase checks, but at the goal level: an isolated `pi` subprocess with fresh context and limited verification tools (`read`, `grep`, `find`, `ls`, `bash`).

```text
--no-session --no-extensions --no-skills --mode json --tools read,grep,find,ls,bash
```

On the first audit when neither the global nor trusted project `pi-dgoal.json` file exists, dgoal creates this global template:

```json
// ~/.pi/agent/pi-dgoal.json
{
  "$comment": "Set each list in fallback order to provider/model[:thinking]. Keep null to inherit the current session model.",
  "phaseAuditorModels": null,
  "goalAuditorModels": null,
  "contextSummarizerModels": null
}
```

Configure the phase and goal auditors independently with ordered lists of at most three candidates. Concrete entries are persistent dedicated settings and do not follow later main-session model changes or Pi reloads. A final standard Pi thinking suffix (`off`/`minimal`/`low`/`medium`/`high`/`xhigh`/`max`) selects thinking; model IDs themselves may contain `/` or `:` for custom or gateway models:

```json
// ~/.pi/agent/pi-dgoal.json or .pi/pi-dgoal.json
{
  "phaseAuditorModels": [
    "openai-codex/gpt-5.6-sol:medium",
    "minimax-cn/MiniMax-M3:high"
  ],
  "goalAuditorModels": [
    "openai-codex/gpt-5.6-sol:xhigh",
    "minimax-cn/MiniMax-M3:high"
  ]
}
```

Legacy single-candidate `phaseAuditorModel`, `goalAuditorModel`, and shared `auditorModel` keys remain supported and are never rewritten automatically. `contextSummarizerModels` configures the startup background-summary chain; each candidate is tried once, then the current session model once, and startup fails closed if all attempts fail.

Resolution order:

1. Project `.pi/pi-dgoal.json` (only when the project is trusted; its candidate chain is kept whole)
2. Global `~/.pi/agent/pi-dgoal.json`
3. Fallback to the current session model only when configuration provides no usable candidate

Within each source, the matching plural scoped key takes precedence over its single scoped key, which takes precedence over legacy `auditorModel`; source precedence is evaluated first and chains from different sources are never merged. A plural value of `null` explicitly inherits the current session model and stops further fallback. Empty lists are invalid; invalid or duplicate entries are warned and skipped, and only the first three valid unique candidates are retained.

Before an audit starts, dgoal queries the isolated auditor's structured Pi `get_available_models` registry. It matches a full model ID first, then recognizes a final standard thinking suffix; unavailable candidates are skipped. Successful registry results are cached for the current Pi process and reset on `/reload`; if the query fails, dgoal retains the configured chain for runtime handling rather than deleting candidates. Unreadable files and malformed values continue through normal configuration precedence. A missing global and trusted project config creates the template atomically without overwriting an existing file. While no usable configured candidate exists and there are no other config issues, dgoal shows the selection hint once per Pi process; otherwise it emits only the relevant warnings. User-facing hints and warnings follow `pi-di18n` when installed.

- Approved: goal closes, dgoal execution stops, model receives a completion signal for the final user-facing reply; tool results expose the actual auditor model that formed the decision and fallback progress updates it.
- Sanitized audit usage is appended to `~/.pi/agent/audit-usage.jsonl` (timestamp, parent session, project, scope, model, attempt, numeric usage, dedup key only); `pi-session-insights` merges it into `/insights` numeric aggregation.
- Rejected: phase-check rejection is a normal business result (`isError: false`) that keeps the goal active but gate-locked to the current phase; final-audit rejection enters `rejected`, and the original report is injected and pinned to subsequent prompts. Three consecutive final rejections pause the goal; `/dgoal resume` clears the counter and retries.
- Audit error / abort / real idle-timeout / no clear decision: treated as `auditor_error` (`isError: true`). Each candidate is attempted at most once per audit; technical/protocol failures (HTTP 400/401/403/404/408/429/5xx, network, timeout, zero-output, or partial output without a termination marker) switch to the next candidate. A candidate that produces a valid conclusion is persisted and reused for later audits in the same goal and scope (`phase` or `goal`). Business `<REJECTED>` and user interruption do not switch candidates; phase rejection remains repairable without a count limit, while three consecutive goal-final rejections pause the goal. `/dgoal resume` from `audit_error` resets only the failed-candidate state for the errored audit scope (`phase` or `goal`); legacy goals without a scope reset all candidate state, then retry the chain. When all candidates are exhausted the goal is safely paused; dgoal never silently falls back to the execution model.
- Audit progress is streamed back through the tool call, including liveness updates such as `thinking`, `tool_running`, and `idle Ns/180s` for model work or `idle Ns/1800s` while an auditor tool is executing. This prevents long project verification commands from being mistaken for a stalled model. Tool executions are persisted as sanitized, scope-local audit checkpoints: a new candidate or `/dgoal resume` reuses a successful exact command only when the workspace fingerprint still matches; running or failed commands are never treated as proof. Phase and goal audits also have shared total budgets of 900s and 1800s across their candidates.
- Audit reports use a stricter acceptance style: GWT-like PASS / FAIL / BLOCKER items plus a code-and-doc consistency section.
- Final rejection displays `Goal Repair · attempt N/3`, and `paused(audit_failed_3x)` displays `Goal Repair paused`; each repair round is appended to a repair ledger without creating a goal-level task or extra phase.
- `/dgoal help` / `/dgoal h` asks the current session model to explain dgoal only at cold start or while paused; it is not a `dgoal_help` tool and does not grant execution authority.
- vNext persists goals under the new `dgoal-goal-vnext` custom entry type and ignores legacy `dgoal-state` entries; upgraded users must start a new `/dgoal` goal.
- Escape hatch: `PI_DGOAL_NO_AUDIT=1` skips the audit (debugging only).

## Tests

```bash
npm test         # bun: full suite
npm run test:rpc # python: RPC loading + command registration
npm run test:smoke # python: AI-driven smoke (real model, isolated env) — costs real tokens
```

Test files cover data model + persistence, plan reducer (state machine + cycle detection), overlay rendering, startup gate, state machine + prompt, end-to-end integration, tool execute real-path integration, context hardening, and subprocess supervision for detached process-group cleanup.

**AI-driven smoke** (`npm run test:smoke`, `test/test-ai-smoke.py`): drives a real dgoal (single phase by default, per ADR 0017) in an isolated env (`pi -ne -e ./index.ts -ns -np --mode rpc`), auto-answering the startup-gate select and tracking the full `dgoal_propose → dgoal_plan → dgoal_check → dgoal_done` tool chain. Real model + real tokens, so not in CI.

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
│   ├── 40-版本实施方案/           ← version implementation plans
│   ├── 90-归档/                   ← historical
│   ├── 经验笔记.md                ← reusable practices and pitfalls
│   └── 决策档案/                  ← ADR index: see `doc/决策档案/README.md`
├── package.json
├── index.ts                       ← Pi extension composition root
├── src/                           ← responsibility-based runtime modules
│   ├── plan/                      ← Task Plan types and pure helpers
│   ├── runtime/                   ← Goal Runtime orchestration
│   ├── audit/                     ← audit parsing and sanitized usage ledger
│   ├── isolated-pi/               ← isolated Pi args and stream helpers
│   └── tui/                       ← TUI pure helpers and component boundary
└── test/                          ← test map + commands: see test/README.md
    ├── README.md
    ├── *.test.ts                   ← Bun unit / integration tests
    ├── test-extension-rpc.py       ← extension loading + command registration
    ├── test-ai-smoke-runtime.py    ← deterministic host-Pi selection checks
    └── test-ai-smoke.py            ← real-model end-to-end smoke
```

## Documentation

Start at `doc/README.md` for the reading order. The build-check loop and three-layer content model are the basic principle; see `doc/决策档案/0006` for the foundational decision.

## License

MIT
