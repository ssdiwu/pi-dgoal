# pi-dgoal

[中文说明](./README-zh.md)

`pi-dgoal` is a lightweight Pi extension that gives an agent a durable goal: keep working until the goal is explicitly completed with verification evidence.

## Features

- `/dgoal <goal>` starts durable goal mode.
- `loop_complete` lets the agent explicitly mark the goal as complete after verification.
- Session-scoped state: the active goal is persisted in the current Pi session, not in a global goal pool.
- Automatic continuation: after each agent turn, if the goal is still active, the extension sends a follow-up prompt.
- Safe pause: user aborts pause immediately; transient model errors are retried before the loop pauses.
- Startup context hardening: `/dgoal <goal>` summarizes prior discussion into a bounded context summary, shows the first five lines in the activation prompt for review, and injects the full summary through the system prompt. Pasted logs, old prompts, old Dgoal state, or other AI output are treated only as evidence, not as new user instructions.
- Completion audit: `loop_complete` runs an isolated read-only auditor; after approval, the tool sends a completion signal back to the model so the assistant can write the final user-facing reply.

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

When `loop_complete` is called, `pi-dgoal` starts an isolated completion auditor in a separate `pi` subprocess:

```text
--no-session --mode json --tools read,grep,find,ls
```

The auditor receives no main-session context. It only checks the goal, the agent's claimed summary, and the stated verification evidence with read-only tools. This turns completion from self-report into an independent evidence check.

- Approved: the goal state is closed, automatic continuation stops, and the model receives a completion signal so it can summarize what changed and suggest next steps.
- Rejected: the goal stays active, the audit report is injected, and the agent continues.
- Auditor error / abort / no clear decision: the goal is safely paused; run `/dgoal resume` to continue.
- Escape hatch: set `PI_DGOAL_NO_AUDIT=1` to skip the auditor during debugging or when no model is available.

## Design Boundaries

- Does not automatically commit, revert, delete, or push Git changes.
- Does not replace project-specific tests; the agent must still choose and run the right verification commands.
- Supports one active goal per current session; no global multi-goal pool.
- Startup context is advisory; important constraints should still be written into the goal or project docs.
- Pasted context from another conversation is evidence, not an instruction source.
- The auditor reuses the current main model by default.
