# pi-dgoal

[中文说明](./README-zh.md)

A Pi extension that keeps an agent working on a goal until completion is independently verified — through a Task Plan and a build-check loop.

> **v0.5.7**: paused goals are distinguishable from missing goals, normal agent turns without tool activity pause after three turns, new plans assign consecutive phase IDs, and explicit auditor quota exhaustion can fall back to the next candidate. This release also includes ordered auditor candidate chains in `pi-dgoal.json`, structured isolated-registry preflight, explicit `null` inheritance, and safe first-audit template initialization. See `CHANGELOG.md` for details.
>
> **Previous**: v0.5.3 added independent auditor model selection and previous-feedback injection; v0.5.2 added build-check feedback persistence, event-stream auditor liveness, transparent auditor retries, gate-lock progression guard, and bare `/dgoal` startup carryover.

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

The startup gate runs structure validation, then a semantic preflight with the current session model, before writing `pendingProposal`. Manual or subjective completion conditions are rejected or rewritten into `userReviewItems`; only then does the dialog show a phase-level summary by default (goal + verification + acceptanceCriteria + userReviewItems + readiness + boundary gaps/signals + phases + task counts). Approve, reject, or give feedback before dgoal execution begins.

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
| `dgoal_check` | Phase completion gate (spawns an isolated acceptance subprocess with fresh context and limited verification tools). Even on the last phase, it only checks that phase. |
| `dgoal_done` | Declare goal completion after all phases have passed `dgoal_check`. Triggers the goal-level final audit internally; the only way to close a goal. Produces structured checkable completion text (what changed / how verified / what needs user review). |

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
  "goalAuditorModels": null
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

Legacy single-candidate `phaseAuditorModel`, `goalAuditorModel`, and shared `auditorModel` keys remain supported and are never rewritten automatically.

Resolution order:

1. Project `.pi/pi-dgoal.json` (only when the project is trusted; its candidate chain is kept whole)
2. Global `~/.pi/agent/pi-dgoal.json`
3. Fallback to the current session model only when configuration provides no usable candidate

Within each source, the matching plural scoped key takes precedence over its single scoped key, which takes precedence over legacy `auditorModel`; source precedence is evaluated first and chains from different sources are never merged. A plural value of `null` explicitly inherits the current session model and stops further fallback. Empty lists are invalid; invalid or duplicate entries are warned and skipped, and only the first three valid unique candidates are retained.

Before an audit starts, dgoal queries the isolated auditor's structured Pi `get_available_models` registry. It matches a full model ID first, then recognizes a final standard thinking suffix; unavailable candidates are skipped. Successful registry results are cached for the current Pi process and reset on `/reload`; if the query fails, dgoal retains the configured chain for runtime handling rather than deleting candidates. Unreadable files and malformed values continue through normal configuration precedence. A missing global and trusted project config creates the template atomically without overwriting an existing file. While no usable configured candidate exists and there are no other config issues, dgoal shows the selection hint once per Pi process; otherwise it emits only the relevant warnings. User-facing hints and warnings follow `pi-di18n` when installed.

- Approved: goal closes, dgoal execution stops, model receives a completion signal for the final user-facing reply.
- Rejected: phase-check rejection is a normal business result (`isError: false`) that keeps the goal active but gate-locked to the current phase; final-audit rejection enters `rejected`, and the original report is injected and pinned to subsequent prompts. Three consecutive final rejections pause the goal; `/dgoal resume` clears the counter and retries.
- Audit error / abort / real idle-timeout / no clear decision: treated as `auditor_error` (`isError: true`). Each configured candidate retries up to 3 times on the same model; structured technical failures (HTTP 401/403/404/408/429/5xx, network, zero-output timeout) and explicit pure-text quota exhaustion (`usage/plan/rate limit` reached/exceeded/hit/exhausted, `quota exceeded`, `insufficient quota`) switch to the next candidate, while HTTP 400, explicit `<REJECTED>`, and user interruption do not switch. Partial output that lacks a termination marker is carried as bounded `<partial_audit_feedback>` across same-model retries and then to the next candidate. When all candidates are exhausted the goal is safely paused and `/dgoal resume` continues; dgoal never silently falls back to the execution model.
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
│   ├── 40-版本实施方案/           ← version implementation plans
│   ├── 90-归档/                   ← historical
│   ├── 经验笔记.md                ← reusable practices and pitfalls
│   └── 决策档案/                  ← ADR index: see `doc/决策档案/README.md`
├── package.json
├── index.ts                       ← single-file extension (entry point)
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
