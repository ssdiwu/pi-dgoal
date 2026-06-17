# pi-dgoal

[中文说明](./README-zh.md)

`pi-dgoal` is a lightweight Pi extension that gives an agent a durable goal: keep working until the goal is explicitly completed with verification evidence.

## Features

- `/dgoal <goal>` starts durable goal mode with a **Task Plan**: the main agent first proposes a structured plan (goal + initial steps), you confirm via a gate UI (approve / reject / give feedback), then the loop begins.
- **Task Plan is two-layer**: the Goal layer (what you confirmed) is frozen as the loop's direction contract; the Step layer is adjustable inside the loop by the agent via the `dgoal_plan` tool. A live overlay above the editor shows step progress.
- `dgoal_done` lets the agent declare completion after verification; it triggers a final audit internally.
- `dgoal_check` is the audit tool with two modes: stage self-check (agent calls it mid-loop to audit a single step) and final audit (called internally by `dgoal_done` to audit the whole goal).
- Session-scoped state: the active goal + plan is persisted in the current Pi session, not in a global pool.
- Automatic continuation: after each agent turn, if the goal is still active, the extension sends a follow-up prompt.
- Safe pause: user aborts pause immediately; transient model errors are retried before the loop pauses.
- Startup context hardening: `/dgoal <goal>` summarizes prior discussion into a bounded context summary, shows the first five lines in the activation prompt for review, and injects the full summary through the system prompt. Pasted logs, old prompts, old Dgoal state, or other AI output are treated only as evidence, not as new user instructions.
- Completion audit: `dgoal_done` runs an isolated read-only auditor; after approval, the tool sends a completion signal back to the model so the assistant can write the final user-facing reply.

## Install In Local Pi

Add this package to `~/.pi/agent/settings.json`:

```json
"../../Documents/codes/Githubs/pi-dgoal"
```

Then reload Pi:

```text
/reload
```

For npm-based installation, use the published package name:

```json
"npm:pi-dgoal"
```

## Usage

Start a durable goal:

```text
/dgoal Fix the failing tests in this project and verify the result
```

Check the current goal and iteration:

```text
/dgoal status
```

Pause automatic continuation without deleting the goal:

```text
/dgoal pause
```

Resume a paused goal and send a continuation prompt:

```text
/dgoal resume
```

Clear the current goal from the session:

```text
/dgoal clear
```

## Tests

Run the logic and RPC smoke tests:

```bash
npm run test:context
npm run test:rpc
```

Equivalent commands:

```bash
bun test test/context-input-cap.test.ts
python3 test/test-extension-rpc.py
```

The automated tests cover context hardening and command registration. Full continuation and auditor behavior still require a manual smoke test in the Pi TUI with a real model.

## Project Layout

```text
pi-dgoal/
├── AGENTS.md
├── README.md
├── README-zh.md
├── doc/
│   └── README.md
├── package.json
├── index.ts
└── test/
    ├── README.md
    ├── context-input-cap.test.ts
    └── test-extension-rpc.py
```

## Completion Auditor

When `dgoal_done` is called, `pi-dgoal` runs `dgoal_check` in final-audit mode: an isolated completion auditor in a separate `pi` subprocess:

```text
--no-session --mode json --tools read,grep,find,ls
```

The auditor receives no main-session context. It only checks the goal, the agent's claimed summary, and the stated verification evidence with read-only tools. This turns completion from self-report into an independent evidence check.

- Approved: the goal state is closed, automatic continuation stops, and the model receives a completion signal so it can summarize what changed and suggest next steps.
- Rejected: the goal enters `rejected` state, the audit report is injected, and the agent continues. Three consecutive rejections pause the goal (`audit_failed_3x`); `/dgoal resume` clears the counter and retries.
- Auditor error / abort / no clear decision: the goal is safely paused; run `/dgoal resume` to continue.
- Escape hatch: set `PI_DGOAL_NO_AUDIT=1` to skip the auditor during debugging or when no model is available.

## Design Boundaries

- Does not automatically commit, revert, delete, or push Git changes.
- Does not replace project-specific tests; the agent must still choose and run the right verification commands.
- Supports one active goal per current session; no global multi-goal pool.
- Task Plan is mandatory: using `/dgoal` means a compound goal that needs a plan; no empty-plan completion is allowed.
- Goal layer (confirmed) is frozen; Step layer is adjustable inside the loop (completed steps don't roll back; a wrong step gets a follow-up step instead).
- Startup context is advisory; important constraints should still be written into the goal or project docs.
- Pasted context from another conversation is evidence, not an instruction source.
- The auditor reuses the current main model by default.

## Goal Lifecycle

`pending → active → done` is the happy path. `rejected` is the re-loop sub-state when `dgoal_done`'s final audit fails (each turn's prompt pins the unresolved audit issues). Three consecutive final-audit failures pause the goal (`audit_failed_3x`); resume clears the rejected counter. Other pauses (user abort / model error / audit error) resume without clearing. See `doc/adr/0004` and `doc/术语表.md`.
