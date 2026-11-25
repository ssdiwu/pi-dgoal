# Changelog

This project follows the basic format of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). For tagged releases, use the version from the Git tag. The tagged release is maintained by the release owner in this English `CHANGELOG.md`; daily user-perceivable changes are recorded in the Chinese `CHANGELOG-zh.md` in this repository. Both files contain user-perceivable facts only and ship in the npm package.

For new releases, use headings in the format `## [x.y.z] - YYYY-MM-DD`. When an entry can be linked unambiguously to a GitHub issue, append `(#xx)`. Historical entries keep their original heading format.

## [Unreleased]

## [0.8.2] - 2026-11-25

### Added
- **Pending-plan recovery within the same session** (ADR 0052): a cold `session_start(startup|resume)` restores the full pending proposal for the current branch, or persists an already-confirmed but unfinished active Plan Contract in place as `paused(session_recovery)`. Added `/dgoal review` to manually view, give feedback on, defer, reject, or confirm and save a proposal; recovery does not automatically open a dialog, resume execution, or search across sessions / History, and a `fork`ed session does not inherit a copy of the host's Plan / History.

### Changed
- Supports Pi 1.6.0 custom-message turns and Anthropic tool definitions added during a session.
- **No guessing or replay after recovery**: both `/dgoal resume` and confirmation of a recovered upgrade proposal keep the same Goal, Plan Run, Work List, revision, checks, and evidence; when the source is session recovery, the first round must verify `in_progress` and workspace/external side effects, and block or ask when uncertain.
- **Cancelling confirmation no longer discards the plan**: Esc, empty feedback, and legacy-host confirm=false now defer and preserve the pending proposal; the confirmation UI isolates concurrent and late selections by session generation + Goal/Contract/revision/proposal.
- **Cross-branch and stale-snapshot fail-closed**: resume, START, and feedback resubmission bind to the original session generation through a one-shot input marker; during streaming they are only queued and delivered as a separate turn after `agent_settled`, with active commit at the effective abort boundary of the exact user `message_end`. If nothing has started, the prompt was rewritten, or the branch changed, the proposal stays pending / paused. Pi advances the in-memory leaf before persisting, so any `appendEntry()` throw hard-locks the current `SessionManager`: no compensating child node or continuation is appended, and extension reload, tree, and compact do not unlock it; recovery happens only after the manager is genuinely rebuilt, from the last complete record on disk, and stays fail-closed if the JSONL tail is incomplete or unreadable. State, History, prior-context handoff, and audit-workspace inference no longer guess the current branch from `getEntries()` across the whole tree; forks isolate copied state with a scope marker containing only the session ID. Upgrade proposals bind to the Goal/Work List/Contract baseline: after deferral they can only pause/resume and remain reviewable, while newer progress or audit facts invalidate the old proposal, never rolling back current state.

### Fixed
- START and resume now tolerate system updates before the matching user message. Empty or rewritten recovery messages still fail validation.
- Starting another goal clears the previous completion overlay and cancels its hide timer.
- Tool descriptions and host guidance now agree on when to start an Execution Plan or save a soft Work List.
- Anthropic requests opt the nine dgoal tools out of strict grammar compilation while retaining local schema validation. (#2)
- Work List updates now appear at the end of each model request, keeping the system prompt cache stable. (#3)
- **Delivery tasks are no longer mis-degraded to a soft checklist**: the default agent guidance now routes fixes, implementation, verification, and other explicit delivery work that needs no further user decision to `execution_plan`; a soft `work_list` is only for recording or waiting for later input.
- **Work List TUI state consistency**: a soft Work List shows "saved, waiting for the next turn" and no longer increments a timer or displays invalid pause/resume controls; creating a Work List or Execution Plan directly for the first time mounts a persistent overlay so the user is not left with only a tool receipt and status bar.

## [0.8.1] - 2026-08-08

### Breaking
- **A single Work List and nine tools** (ADR 0051): the public agent tools are now `work_list` / `execution_plan` / `goal_plan` / `staged_plan` / `work_create` / `work_read` / `work_update` / `phase_check` / `goal_check`. Removed `task_plan`, `phase_plan`, `plan_create`, `plan_read`, `plan_update`, and legacy-semantics aliases; the former Goal Plan's dual Phase + Goal review semantics are carried by `staged_plan`.
- **New persisted state; no migration of old active plans**: the current Goal / Work List / Plan Contract is written to `dgoal-work-v1`, and the current session's redacted Plan Run History to `dgoal-plan-history-v1`. `dgoal-plan-v2` and older active state are neither read nor migrated; after upgrading, the current work list must be re-established.

### Added
- **Orthogonal assurance profiles**: the same Work List can stay soft, or be upgraded one-way to an Execution Plan, Goal Check Plan, or Staged Check Plan; phases exist only at real serial boundaries and never auto-complete when their members are exhausted.
- **Plan Run History**: closed or superseded Plan Contracts are archived within the current session; the status page can view and clear the history. Archives keep structured completion evidence and audit conclusions, trimming the auditor's raw report, feedback, thinking, and transcript.

### Changed
- **The check / update split is unchanged**: `phase_check` / `goal_check` only record independent audit results for the current revision; Phase and Goal completion can still only be written explicitly by `work_update`. Profiles, Work Lists, and phase revisions all invalidate older audits by monotonic rules.
- **Soft checklist and continuous execution are separated**: `work_list` only does lightweight cross-turn tracking, with no continuation (auto-resume), no-progress counting, or independent audit; `execution_plan` adds the Until Done assurance.
- **Unified TUI and completion projection**: overlays, the status page, and tool details consistently show Work Items / Phases / Profiles; completed phases are softly forgotten as titles in execution context so history no longer bloats the main context.

### Fixed
- **Reliable closure cleanup and user feedback**: a soft Work List closes automatically when all work items are finished and real phases are explicitly completed; any profile closure proceeds in the order done → null tombstone → continuation / proposal / circuit breaker / audit snapshot / authorization cleanup, and returns a structured `dgoal completion signal`, no longer leaving a completed list behind or ending silently.
- **Cross-branch and late-audit isolation**: `session_tree` / `session_compact` only restore `dgoal-work-v1` and continue to isolate stale-branch audit results and continuations by session generation + Goal ID + revision.
- **Staged repair loop and phase invariants**: Staged Check only allows adding a new goal-level root Work Item after all phases are explicitly completed, and that follow-up survives compact / reload; status or description changes in a non-terminal phase invalidate local approval, and a done phase no longer permits same-status rewrites. Goal Check → Staged Check `acceptanceCriteria` / `nonGoals` / `guardrails` remain frozen at input, in semantic pre-review results, in pending proposals, and at recovery boundaries.
- **Atomic replacement, full readback, and corrupt-state isolation**: an invalid Execution replacement no longer prematurely archives a still-active old Plan Run; `work_read`, the main agent context, and the independent check prompt now fully project descriptions, deliverables, and per-item evidence; corrupt Work Lists / CheckRecords or ones with unknown fields fail closed on recovery instead of throwing type errors or restoring forged approvals.

## [0.8.0] - 2026-07-31

### Changed
- **Pi 0.83 development baseline**: upgraded the three Pi development dependencies to 0.83 and root TypeBox to 1.3.8; the public peer range remains host-provided `*`, and the strict-schema nullable compatibility layer is retained.

### Fixed
- **Task Plan model-error recovery**: after a Task Plan hits a `model_error` circuit break, it is no longer silently dropped on the next turn; the next real interactive/RPC input restores it once, preserving the original task, evidence, and revision. Extension injections, streaming follow-ups, prompt rewrites, and Phase/Goal Plans do not wake it automatically.
- **Nullable conversion under strict parameters**: nullable parameters now put the `null` branch first in the TypeBox union so Pi 0.83 validation does not convert numeric defaults to `0`; `phaseId:null` together with a valid `phaseNumber` is no longer misread as a duplicate-parameter case and no longer triggers an invalid `phase_check` retry loop.

## [0.7.12] - 2026-07-27

### Fixed
- **Localized task-exhaustion notices**: when the current task is exhausted in Task, Phase, and Goal Plans, `plan_update(target=task,status=done)` now follows the current UI language instead of bypassing `i18n` to show an English notice.
- **Localized Plan tool output**: `plan_read` headings, Plan creation and update guards, phase/goal review entry points, and their auditor error notices now follow the current UI language.

## [0.7.11] - 2026-07-27

### Fixed
- **Task Plan closure placeholder compatibility**: `plan_update(target=goal,status=done)` now treats empty or whitespace-only `subject` / `description` rewritten at the host's strict-schema boundary as absent; real non-empty text is still rejected by the goal-freeze guard.

## [0.7.10] - 2026-07-26

### Added
- **Tool-constraint sampling**: the eight public Plan tools (`task_plan` / `phase_plan` / `goal_plan` / `plan_create` / `plan_read` / `plan_update` / `phase_check` / `goal_check`) now request JSON Schema strict mode on supported provider/models so tool arguments match the TypeBox schema exactly; when the model does not support it, the host falls back to ordinary tool calls and cross-provider behavior is unchanged. Development dependencies were upgraded to Pi 0.82 as well.

### Changed
- **Task DAG explainable read model**: for the current unfinished phase, ready, waiting, transitive root blocking, and immediate unblock relationships are derived purely from existing `blockedBy` and task status, and projected into `plan_read`, `/dgoal s`, and the main agent prompt; no new persisted fields or scheduling state are introduced. "ready" only declares tasks the main agent may currently execute or delegate legally; it is not bound to a specific execution extension and does not replace concurrency-conflict judgment; after verification by the main agent the Plan is still written by `plan_update`.
- **Task Plan deliverables and safe closure**: tasks may declare file, command-result, or observable external-state deliverables as needed; once declared, structured evidence must be provided for each. When all current tasks are complete the Plan stays active; the main agent reads back all task descriptions and deliverables, then closes explicitly with `plan_update(target=goal,status=done)` using `summary` / `verification`. After `session_compact`, the persisted Plan is restored unchanged as the execution authority, and the compaction summary cannot override task descriptions or declared deliverables.
- **Explicit Task Plan closure**: completing all current tasks no longer closes the goal automatically. The main agent now receives a decision-boundary hint: it may add tasks from new evidence, replace the Task Plan when the goal is reframed, or close explicitly with `plan_update(target=goal,status=done)` using `summary` / `verification` after reading back all task descriptions and declared deliverables; Task Plans still do not add independent audits.
- **Three-tier Plan task-exhaustion decision boundary**: when all current phase tasks finish in Phase Plans and Goal Plans, the main agent is likewise prompted to decide whether to keep creating tasks from new evidence; only after confirming the current phase is sufficient does it move to phase done or the `phase_check` chain. Existing independent audits and completion guards are unchanged.

### Fixed
- **Codex strict-schema compatibility**: public tool parameters and nested objects now explicitly disable additional properties and list every property in `required`; originally optional fields use `null` as a placeholder and are restored to omitted before execution, preventing OpenAI/Codex models that support strict JSON Schema from rejecting calls such as `task_plan`.
- **Strict-parameter Task Plan closure**: `plan_update(target=goal,status=done)` now treats `subject:null` / `description:null` filled in by strict tool calls as absent, avoiding accidental triggering of the frozen-goal text guard and an inability to close explicitly.
- **Task Plan no-progress recovery**: only on a `no_progress` technical circuit break may the main agent atomically replace the Task Plan or close explicitly after passing completion guards; user pauses, genuine user blockers, other technical pauses, and Phase/Goal Plans remain locked.
- **Auto-resume fake-progress circuit breaker**: no-progress detection now distinguishes tool activity from durable progress; it pauses after 3 consecutive rounds with no tool calls or 8 consecutive rounds with only activity such as reads and status queries but no successful file write, independent check, or change to Plan status/evidence/blocking structure. Detection uses only structured tool events and Plan state diffs, not LLM text or `bash` command semantics; the resume prompt asks the agent to act directly, delegate, or report a real user-decision blocker before pausing.
- **Task Plan continuation after compaction**: after `session_compact` restores an active Plan, if Pi does not retry the current turn on its own, the continuation prompt is re-delivered; this prevents the overlay from ticking indefinitely while the main agent loses the decision to add, replace, or explicitly close tasks after exhaustion.

## [0.7.9] - 2026-07-20

### Changed
- **Consolidated audit status**: `phase_check` now uses the local revision of its owning phase; only changes to audited facts in the same phase invalidate its approval, while all Plan writes still invalidate `goal_check`. Per-tool audit checkpoints are reused only in memory, with persistence keeping only stable terminal states, avoiding append-only session growth from tool events.
- **Final-review and proposal hints**: three or more consecutive `goal_check` rejections now flag repair risk but keep the goal active; complex goals may receive a non-blocking suggestion to split into smaller pieces.

## [0.7.8] - 2026-07-20

### Fixed

- **Proposal evidence admissibility**: startup guidance and semantic review now reject frozen acceptance conditions that depend on evidence a future auditor cannot independently obtain, including unsupported historical non-access claims, unexported access logs, and agent/worker/user memory. Such claims must be removed or narrowed to observable, independently auditable evidence rather than being moved to user review; rejection can return all identified criterion-level issues in one response.

## [0.7.7] - 2026-07-17

### Breaking
- **Three-tier Description contract and persisted v2** (ADR 0042): descriptions for goals, user-visible phases, and tasks are now required; a Goal Plan's goal description freezes on confirmation, while phases/tasks can be explicitly revised. Removed `contextSummary` from tool parameters, state, persistence, prompts, and previews; the persistence key was upgraded to `dgoal-plan-v2` with no migration of `dgoal-plan-v1` active state.

### Changed
- **Task Plan probing and light self-check guidance**: ordinary explicit multi-step execution, and AFK, bounded, low-risk exploration with stop conditions, can use a Task Plan to hold the current frontier; before generating the Plan/tasks, only a soft self-check of relevance, necessity, dependencies, and evidence paths is performed, with no added phases, hard gates, or fake HITL.
- **Two-layer `/dgoal s` modal**: the list page shows the full goal description with selectable phases/tasks; the detail page shows the full description, status, dependencies, evidence, and blocked reason. Supports logical-item selection, window following, Enter to enter, Esc to return while keeping position, and independent detail scrolling; the persistent overlay still does not show descriptions.
- **Description execution/audit boundary**: the main agent's runtime context receives goal and current/future phase/task descriptions; done phases are still softly forgotten. Independent auditors can use them to understand the method but may not promote free-text descriptions into independent completion gates.
- **Explicit Plan streamlining quality check**: before submitting Phase/Goal proposals, always verify end-to-end outcomes, lifecycle/real call chains where applicable, failure paths, and consistency between the Plan and the acceptance contract; fix issues in place without adding reports, model calls, state, or hard gates; Task Plan and semantic pre-review responsibilities are unchanged.
- **Shared frontier and latest-audit projection**: `plan_read` and `/dgoal s` read-only explain the direct causes of the current frontier and the next legal action, combining the latest CheckRecord, feedback, task evidence, and completion claim from existing fields; no internal history indices are shown and no counts, timings, or recovery structures are added.

### Fixed
- **Final-review completion-claim validation**: `goal_check` rejects whitespace-only summary/verification before starting an audit, avoiding unrecoverable final-review history written by rejection results; the top-level rejection count is also strictly validated on recovery.
- **v2 recovery boundary**: reloading `dgoal-plan-v2` strictly revalidates goal/plan descriptions, frozen acceptance contracts, IDs, statuses, dependency graph, checks, feedback, final-review history, and `pendingProposal` structure by Plan type; a dirty entry invalidates the whole record and cannot bypass startup validation or break read-only state projection after session recovery.
- **`/dgoal s` long content and rendering boundaries**: list paging scrolls only physical lines so very long goal descriptions can be browsed in full; audit-liveness changes invalidate same-second caches; non-positive or extremely narrow terminal widths degrade safely.

## [0.7.6] - 2026-07-17

### Changed
- **Task Plan automatic closure and in-progress projection**: when the last task with evidence enters `done`, the runtime atomically closes the goal in the same `plan_update(target=task)` call instead of relying on the model to append `plan_update(target=goal,status=done)`; removed the redundant `activeForm` field, and the persistent overlay now shows a cycling `. / .. / ...` after the task title to indicate in-progress work.

## [0.7.5] - 2026-07-16

### Fixed
- **Human-readable tool-result projection**: the eight public tools show a compact summary by default; expanding shows the full text result and a tool-allowlisted detail projection, with liveness text for in-progress checks, but never hands raw structured `details` directly to the host renderer.
- **Task Plan user-interruption recovery**: interrupting the current response no longer writes the Task Plan as `paused(user_abort)`; it stays active with old continuations cleared, and the next user input can continue directly without `/dgoal resume`. Explicit Phase/Goal Plans keep their pause-on-user-interrupt semantics.

## [0.7.4] - 2026-07-16

### Changed
- **Task Plan display and model-error circuit breaker**: the persistent overlay lists tasks by default; successful tool progress resets the model-error counter, with the first two consecutive errors silent, the 3rd/4th warning, and the 5th pausing.
- **`plan_read` human-readable diagnostics**: no longer returns the raw Plan payload; `target=plan|goal` aggregates phase/task progress across the whole Plan, and `target=phase|task` returns a single item.

### Fixed
- **Cross-session branch async isolation**: late audit results, liveness updates, or continuations from an old branch no longer write to or are delivered to a resynced new branch.
- **Task Plan replacement and completion overlay**: creating or replacing a Task Plan clears the old completion snapshot so the previous goal is not briefly displayed.
- **Legacy persisted-state compatibility**: phases missing `tasks` are normalized to `tasks: []` on load/resync; `removeBlockedBy` and `addBlockedBy` in the same update validate cycles against the final dependency set.
- **Independent-audit subprocess boundary**: event classification and abort handling now reuse the isolated runner's production implementation, avoiding drift in test copies.

## [0.7.3] - 2026-07-16

### Breaking
- **Three-tier Plans and eight-tool runtime** (ADR 0038): public agent tools are now `task_plan` / `phase_plan` / `goal_plan`, `plan_create` / `plan_read` / `plan_update`, and `phase_check` / `goal_check`; the old five `dgoal_*` tools are no longer registered. The new persistence key is `dgoal-plan-v1`, with no migration of old `dgoal-state` / `dgoal-goal-vnext` active state.
- **Removal of policies and implicit-start combinations**: removed `final_only` / `phased`, bounded / unbounded runtime budgets, `implicitFinalOnlyStart` / `implicitFinalOnlyBudget`, and the proposal `implicit` parameter; assurance strength is now expressed solely by `planType: task | phase | goal`.
- **State convergence**: Goals keep only `pending | active | paused | done`, and phases/tasks only `pending | in_progress | done | blocked`. Business rejections are written only to `CheckRecord` and leave the Goal active; the Goal `rejected`, fixed three-rejection pause, and `completed` compatibility states are gone.

### Added
- **Task Plan as the everyday default entry point**: the agent can proactively create a replaceable Task Plan for explicit multi-step execution tasks; it reuses the existing reducer, persistence, and overlay but hides the internal single phase and skips proposals, confirmation, and independent audit.
- **Invalidatable audit records**: phase/goal checks persist a `CheckRecord` with the plan revision; any change to audited facts invalidates older approvals, and late results are discarded if the revision changes during the audit run.

### Changed
- **check and update responsibilities separated**: `phase_check` / `goal_check` only write audit results; `plan_update` is the sole writer of task / phase / goal status, completion display, and agent-initiated pauses. Approved no longer implicitly means done.
- **Explicit Plan-type selection in `/dgoal`**: `/dgoal` and explicit natural-language starts have the agent recommend a Phase Plan or Goal Plan, and the confirmation UI only switches Plan type, not acceptance or budget policies.
- **Tighter task-status guards**: tasks must progress `pending → in_progress → done`, and done requires verifiable evidence; blocked tasks clear the old reason when unblocked and may not depend on tasks in later phases.
- **Phase/Task ID dual namespaces** (ADR 0039): phases and plan-global tasks each number consecutively from ID `1`, with `nextId` allocating tasks only; typed tools distinguish same-numbered objects, and old `dgoal-plan-v1` plans keep their original numbering and remain writable.

### Fixed
- **Persistent overlay title no longer wraps on wide CJK characters**: the widget obtains the current terminal width via `Component.render(width)`, prioritizes progress and elapsed time, and dynamically trims the objective and each line by real display width.
- **Failed delivery on recovery no longer fakes active**: if sending the recovery prompt for `/dgoal resume` fails, the original pause reason is restored and persisted, avoiding an active Plan with no execution turn that stalls forever.

## [0.7.2] - 2026-07-16

### Fixed
- **npm package installation no longer reinstalls Pi core dependencies**: changed the runtime import of `@earendil-works/pi-ai` from a regular dependency to a host-provided peer dependency and added the missing `@earendil-works/pi-tui` peer declaration; both remain dev dependencies for local development only, preventing `pi install` / `/reload` from broadly replacing Pi dependencies in a shared npm prefix and triggering npm Arborist rollback errors.

## [0.7.1] - 2026-07-16

### Added
- **Explicit natural-language start** (ADR 0036): after a real user explicitly requests "use/start dgoal" with an imperative sentence in an idle cold session, `dgoal_propose` can consume a one-shot in-memory authorization bound to the exact input/prompt after structural and semantic pre-review, create an ordinary pending goal, and enter the confirmation UI; complex goals may submit `phased` / `unbounded` and in-plan external actions without requiring the user to type `/dgoal` again. Capability questions, quoted/code examples, explanatory discussion, expressions that only negate using dgoal, identifier suffixes, additional input during processing, sources other than `interactive` / `rpc`, and existing goals cannot silently start or replace anything this way; Pi has no immutable raw-input field, so trusted transforms earlier than dgoal remain within the extension's full-permission trust boundary.

### Changed
- **Proposal semantics changed to "light proposal, hard execution"** (ADR 0037): `dgoal_propose`'s deterministic layer only validates structure, state, policies/budget, and authorization and no longer uses evidence wordlists or free-text keywords for broad semantic hard rejection; the current session's LLM handles independent acceptance / `userReviewItems` / genuine human-blocker triage, high-risk identified actions still fail closed before `tool_call` execution, and final review only checks the frozen result.
- **Implicit proposals can automatically downgrade to explicit confirmation**: when semantic pre-review returns `requiresExplicitConfirmation`, the runtime creates an ordinary pending goal and shows the existing confirmation UI without executing automatically or requiring the user to retype `/dgoal`; structural or semantic failure no longer leaves a half-started goal.
- **Implicit dgoal allows full local execution** (ADR 0035): implicit goals with global authorization may run local tests, builds, interpreter scripts, project file changes, and local Git changes; identified repository destruction, `.git` damage, Git remote writes, release deployments, external writes, and permission or paid commands fail closed before `tool_call` execution and must go through explicit `/dgoal`. This guardrail is a best-effort policy check, not an OS sandbox, and cannot prove that an approved script has no hidden side effects.

### Fixed
- **`final_only` semantic pre-review with an empty phase array no longer blocks startup**: when the reviewer returns a valid `phaseAcceptanceCriteria: []` with approve/rewrite, the runtime fills in missing layers according to the proposal's phase count and preserves existing values, no longer misclassifying approval as tampering or crashing with `rewrittenLayers[layer] is not iterable`; extra phase layers are still rejected fail-closed.
- **Semantic pre-review approval no longer echoes the full acceptance contract**: when approving a plan, the startup-gate reviewer only needs to return minimal `{"decision":"approve"}` JSON and the runtime keeps using the original frozen `acceptanceCriteria`; this avoids invalid JSON or meaningless reformatting from echoing long commands and multi-layer criteria while still rejecting approve responses that secretly modify completion gates.
- **Final review no longer creates a self-referential completion gate for the current result**: the goal auditor explicitly runs before the current `dgoal_done` tool result and `status=done` are generated; the audit only checks pre-call frozen conditions and artifacts, and runtime finalizes only after `<APPROVED>` is returned. The `final_only` plan projection also shows `progressCompleted` to avoid misreading progress-complete as still incomplete.
- **Natural-language adversative imperatives no longer miss authorization**: "not asking you to run a script, but you need to test it yourself with dgoal" grants one-shot explicit-start permission from the clear action in the second half; counterexamples such as "not to use dgoal, but to discuss/explain it" are still rejected.
- **Persistent overlay reliably restores on activation and reload**: PlanOverlay initialization now relies on real `setWidget` capability instead of `hasUI` / `mode` flags that may be absent in different Pi versions; active-goal activation and session resync both ensure the widget is mounted, and UI errors still do not affect the state machine.
- **Implicit-start execution guardrails aligned with schema**: action guardrails moved from `tool_execution_start + abort` to the blockable `tool_call` just before execution and now cover nested shells, fd redirection, cwd variable deletion, Git aliases, and curl equals-sign arguments; the `dgoal_propose` schema allows the wall-clock grace to be set explicitly to `0`, consistent with runtime and default config.

## [0.7.0] - 2026-07-15

### Added
- **Optional acceptance policies and runtime budgets** (ADR 0032): for the same dgoal, the main agent recommends and the user chooses `final_only` / `phased` at the startup gate, plus a bounded / `unbounded` budget. `final_only` removes per-phase independent checks but keeps the final goal review, using a "diagnostic audit + narrow confirmation audit"; when a bounded budget is first exhausted it enters one pre-authorized grace period, pausing only when the grace is exhausted (`pauseReason: budget_exhausted`); `unbounded` does not pause due to budget or fixed counts but still keeps safety exits for model errors, no progress, audit errors, and `agent_blocked`.
- **Main model leads background context solidification** (ADR 0033): removed the separate pre-start background-summary subprocess and its fail-closed semantics; the main agent may submit `contextSummary` in `dgoal_propose` as needed, and missing background does not block startup.
- **Config-authorized implicit lightweight start** (ADR 0034): explicit `/dgoal` is still required by default; once the user enables `implicitFinalOnlyStart` in global `pi-dgoal.json`, the LLM may automatically start `final_only + bounded` goals for specific, independently acceptable tasks (baseline `24 turns / 60 minutes / 1 final-review repair`, with 24 more turns of grace, overridable via `implicitFinalOnlyBudget`); project config cannot grant this permission.

### Fixed
- **Runtime budget counts real agent execution turns**: active-goal turns ending with `toolUse`, `length`, and a normal `stop` all count toward `budgetUsage.turns` instead of only `stop`; the default implicit budget was adjusted to a baseline of 24 turns, 60 minutes, and 1 final-review repair, with 24 more turns of grace.
- **Restore dgoal goals after session compaction**: listens for `session_compact` and adds lazy recovery of persisted goals to `dgoal_plan` / `dgoal_check` / `dgoal_done`; resync distinguishes stale session replacement from real read errors, avoiding false "no goal" reports after compaction or session switches.
- **Tightened implicit-start action boundaries**: forbids implicit shell/test execution and validates local-path tools, Git options, and multi-link files uniformly to avoid reads/writes outside the project and arbitrary script side effects.
- **Implicit lightweight-start prompt alignment**: cold startup informs the model of the globally authorized implicit entry point, and the `dgoal_propose` `implicit` description explicitly says explicit `/dgoal` is not required but still limits it to `final_only + bounded` and to a safe task explicitly requested by the user.
- **No fake 1ms candidate after shared audit budget exhaustion**: when the first audit candidate exhausts the shared total budget for a phase/goal, the runtime no longer starts the next candidate and compresses the remaining time to 1ms; it keeps the real total-duration timeout reason instead of misleading the user with a new instant timeout. Audit timeout copy no longer leaks internal milliseconds and is shown in seconds.

## [0.6.4] - 2026-07-14

### Added
- **Agent-initiated pause exit `dgoal_pause`**: when the agent is deadlocked because it "needs a user decision to continue" (for example frozen acceptance conditions conflicting with the goal, or missing information or authorization only the user has), it can call `dgoal_pause({ reason })` to pause immediately (the new `pauseReason: agent_blocked` records the agent's reason) instead of waiting for the 3-round `no_progress` fallback. Previously such deadlocks left the agent passively making no tool calls, burning tokens in a continuation loop until round 3 paused it. `no_progress` remains the fallback; after `dgoal_pause`, `/dgoal resume` clears the idle counter and gives the agent a full retry budget.

### Fixed
- **`dgoal_pause` reason boundaries and recovery state**: rejects blank or overlong `reason`, keeps a readable `pauseReasonDetail` in post-pause queries and status headings, and clears old detail on resume or when switching to another pause reason so users are not left unable to recover or shown stale reasons.
- **Long audit tool executions killed by the 180-second idle gate**: Pi emits `tool_execution_*` while child processes actually run built-in tools such as `bash`; dgoal previously did not recognize these events, so long commands such as full test suites ran normally but were misjudged as `auditor_error` after 180 seconds. Model work still uses a 180-second idle timeout while tool executions extend it to 1800 seconds; timeout diagnostics name the tool so normal verification is not misreported as an audit failure.
- **Timed-out audits restart from zero**: the isolated audit child now generates redacted audit checkpoints keyed by phase/goal and workspace fingerprint for `tool_execution_start/end`. Candidate switches or `/dgoal resume` inject exact commands that previously completed successfully in the same workspace into a fresh context, avoiding repeated heavy verification; running, failed, or workspace-changed commands are not treated as completion evidence. Phases and goals also have cross-candidate shared 900-second / 1800-second round budgets to prevent endless auditing.
- **Audit-checkpoint workspace validation**: changes to untracked/ignored file contents, unreadable file contents, or an incomplete Git status all block reuse of an old workspace fingerprint (except dependency directories), avoiding reuse of stale audit-success evidence.
- **Audit-checkpoint event validation**: a successful command is recorded only when start/end tool names match and the child explicitly reports `isError:false`; exceptions, missing, or invalid states no longer become reusable evidence.
- **Audit-command redaction**: audit recovery reports additionally mask shell environment variables, CLI arguments, URL credentials, cookies/session, HTTP headers, and composite API keys, access tokens, client secrets, credentials, private keys, passwords, secrets, and authorization in URL query form, avoiding sensitive values entering persisted checkpoints or model context.
- **`dgoal_propose` missing-phase error made actionable**: when the model omits the required `phases`, preprocessing now fills an empty array and lets the tool layer validate instead of exposing the host's vague `must have required properties phases`; the error now explicitly names the missing `phases` and suggests at least one phase with `subject` and `acceptanceCriteria` (`criterion` + `evidence`), with a regression test covering this path.

## [0.6.3] - 2026-07-14

### Fixed
- **Semantic pre-review changed from a total-duration timeout to an observable idle timeout**: `dgoal_propose`'s pre-start semantic review previously used a 30s total timeout and was killed during provider queueing or streaming delays, and timeouts, network errors, and technical failures were all disguised as a semantic rejection telling the agent to "move manual experience into userReviewItems", causing it to repeatedly revise the plan. It now defaults to a 60s **idle timeout** (times out only when there are no valid stream events, reset by any event) and streams liveness status through `onUpdate` (authenticating / receiving review result / validating review JSON) with an idle countdown. Pre-review terminal states split into four: `approved` / `rewritten` / `rejected` (semantic rejection, `isError:false`, with criterion-level feedback) / `technical_error` (authentication, timeout, network, non-terminal, JSON parsing, and other infrastructure failures, `isError:true`, no longer telling the user to change the plan).
- **Configurable semantic pre-review idle timeout**: added `proposalSemanticReviewIdleTimeoutSeconds` to `pi-dgoal.json` (positive integer seconds, 1..3600; invalid values fall back to the default 60s with a warning); project-level takes precedence over global.
- **Pre-review now uses streaming events**: switched from `completeSimple()` (waits only for the final result) to `streamSimple()` (consumes `AssistantMessageEventStream`); every valid event (text/thinking/toolcall/done/error) resets the idle timer, partial JSON is not adopted as a rewrite suggestion, and only a fully parsed final result passing migration-map validation is written to `pendingProposal`.

### Changed
- **Separated pre-review technical failures from semantic rejections**: technical failures return `semantic review technical error` with `isError:true`, explicitly saying "this is not a plan-content problem; you can retry /dgoal later or check model/network availability"; semantic rejections keep `isError:false` with `semantic review rejected` and fixable reasons. The legacy test hook `__setProposalSemanticCompletionForTest` is kept for backward compatibility, and `__setProposalSemanticStreamForTest` was added to inject streamed event sequences.
- **Type-safe pre-review config loading**: `loadDgoalConfig`'s `isProjectTrusted` is now optional with defensive optional chaining, and `DgoalContext` gained `isProjectTrusted?`; the `dgoal_propose` call site dropped the `as unknown as ExtensionContext` cast and the over-broad `.catch(() => null)`, instead loading config based on the presence of `ctx.cwd` and falling back to the default 60s without blocking pre-review when absent. Cleaned up the dead parameter of `raceWithIdle`, the pass-through wrapper `emitProposeUpdate`, and the dead `"done"` branch of `SemanticReviewLiveness` (it now explicitly sets `done` before the terminal state).

## [0.6.2] - 2026-07-13

### Fixed
- **Audit-verdict arbitration**: a valid `<APPROVED>` / `<REJECTED>` now takes priority over trailing WebSocket/network errors and is no longer mis-paused as `audit_error`.
- **Audit-candidate switching**: one failover per candidate; healthy fallbacks persist by goal and audit scope; `audit_error` resume resets failed-candidate state, and phase/goal rejection loops are layered.
- **Status-query overlay recovery**: `/dgoal s` can now idempotently rebind and redraw `dgoal-plan` after a persistent overlay is lost or its first render fails, without modifying runtime state.

## [0.6.1] - 2026-07-13

### Fixed
- **Attributed audit rejections misread as partial output**: `<REJECTED goal>`, `<REJECTED phase="N">`, and `<REJECTED user_review>` are now recognized as formal final-review verdicts just like bare `<REJECTED>` and no longer trigger same-model continued auditing and candidate-chain fallback before being mis-paused as `audit_error`.

## [0.6.0] - 2026-07-13

### ⚠️ Breaking Changes
- **New persistence key incompatible with old goals**: vNext uses the `dgoal-goal-vnext` custom entry and the old `dgoal-state` is completely ignored. After upgrading you must run `/dgoal` again; old goals are not migrated, restored, or displayed (ADR 0026).

### Changed
- **vNext Goal Runtime**: added the `dgoal-goal-vnext` persistence key; final-review rejections append to a final-repair ledger, and rejected/paused(audit_failed_3x) states show Goal Repair while preserving the full plan repair context (including soft-forgetting the pause after resume). Three-way attribution for multi-phase final review: auditor output `<REJECTED phase="N">/goal/user_review` respectively reopens the corresponding phase, enters Goal Repair, or records user review without rejecting.
- **Unified single-phase completion check**: for a single-phase goal, one `dgoal_check` verifies both phase and goal and records a unified audit credential; `dgoal_done` reuses that credential without repeating final review (ADR 0018).
- **Startup and observability**: added dedicated `/dgoal help` for cold start / paused; if all background-summary candidates fail, startup aborts fail-closed (ADR 0027); the startup gate's `select→confirm→editor` three-layer fallback stays compatible with older hosts; audit tool results show the actual model, and redacted audit usage is written to `~/.pi/agent/audit-usage.jsonl` for `pi-session-insights` aggregation.
- **Source layering**: the entry point was consolidated into the `index.ts` assembly root, with new responsibility modules `src/plan`, `src/audit`, `src/isolated-pi`, `src/tui`, `src/goal-runtime` (a mutable session-state singleton), and `src/startup` (Pi registration + event subscriptions) (ADR 0024/0025).

### Fixed
- **Smoke prompt aligned with ADR 0017**: smoke goals no longer force two phases and allow a single phase for simple tasks, fixing repeated resubmission at the proposal stage by real models.
- **Empty migration array in semantic pre-review**: an empty `migratedUserReviewItems` in approve JSON no longer triggers fail-closed.
- **Full context for Goal Repair resume**: after resuming from rejected/paused(audit_failed_3x) to active, full plan context is preserved while `finalFeedback` remains, fixing the conflict between soft-forgetting and repair context.
- **Background-failure wording aligned**: when all candidates fail, the notice changed from "degraded to starting without background" to "startup aborted (no goal entered)", consistent with fail-closed behavior (ADR 0027).

## [0.5.8] - 2026-07-12

### Changed
- **Frozen LLM-independently-verifiable acceptance contract**: `dgoal_propose` now requires structured `acceptanceCriteria` (criterion + evidence) for the goal and every phase; missing or empty criteria are rejected before the startup gate. After structural validation and evidence-shape checks pass, the current session's LLM performs a plan-level semantic pre-review before writing `pendingProposal`; human conditions combined with verifiable evidence are rejected or rewritten into `userReviewItems`; `rewrite` must preserve removed conditions with an exact `sourceCriterion` → `userReviewItem` mapping, and missing or irrelevant mappings fail closed. Pre-review exceptions/interruptions fail closed. Rule 5 of `buildProposePrompt` continues to tell the agent to double-check before submitting, and the reviewer only backs up the already-frozen contract. A new goal's frozen completion gate is only `acceptanceCriteria`; `verification` is downgraded to a goal-level acceptance note and no longer acts as a separate final-review completion gate. `userReviewItems` declares TUI, visual, and real-use review items and, after final approval, is delivered together with agent additions and the auditor's non-blocking suggestions without becoming a phase/goal completion gate; the completion text explicitly says these items do not mean manual experience has been verified. User-review suggestions in a rejected final-review report are also persisted and merged on a later approval. On re-review, out-of-scope manual-experience completion gates in the previous round's feedback are not carried forward as completion gates; review follows only the frozen contract. The auditor reviews only the frozen contract and does not expand completion gates at runtime from AGENTS/README or manual-experience requirements. See ADR 0016.
- **Fail-soft startup and completion UI**: startup confirmation persists active before delivering the START prompt, so state progression does not depend on status/overlay/notify; `finalizeGoal` persists done/null and clears the in-memory goal before showing the completion UI. PlanOverlay synchronous updates, tool-execution refreshes, ticks, and delayed-hide `setWidget` calls are also all fail-soft. Added regression tests for UI errors and state ordering.

## [0.5.7] - 2026-07-12

### Fixed
- **Paused state misreported as no goal**: when a goal existed but was `paused`, `dgoal_plan` / `dgoal_check` / `dgoal_done` all returned "no active /dgoal goal", hiding the pause. It now distinguishes readable (`isGoalReadable`, includes paused, used by read-only entry points) from mutable (`isGoalMutable`, only active/rejected, used by write entry points): while paused, `list` / `get` / `/dgoal status` work read-only; `create` / `update` / `check` / `done` return a structured paused result (with `pauseReason` + `/dgoal resume` guidance) instead of conflating "cannot modify" with "goal does not exist".
- **No-progress continuation idle loop**: `agent_end` unconditionally sent a continuation for a normal `stopReason=stop`, so the agent could reply "not finished" for many rounds while burning tokens. It now resets the per-round tool-call flag in `before_agent_start`, sets it in `tool_execution_start`, and pauses automatically after 3 consecutive rounds with no tool calls (`pauseReason=no_progress`); a tool call or plan/goal state progress resets the counter. The counter clears in startGoal / clearGoal / resyncGoalFromSession / finalizeGoal and is not inherited across goals/sessions.
- **Missing `pauseReason` writes**: `markGoalPaused` was called from `aborted` / `model_error` / `/dgoal pause` without `pauseReason`, so logs showed `pausedReason=None`. It now writes `user_abort` / `model_error` / `user_abort` respectively.
- **New plan phase IDs not consecutive**: `proposalToPlan` previously had tasks and phases share a global `nextId`, so new plans had phase IDs `#1/#4/#8/#12` (tasks consumed the later phase IDs). It now pre-allocates consecutive IDs `1..N` for all phases first and gives tasks globally unique IDs; old plans keep their original IDs with no migration.
- **Phase-not-found unmapped + phaseId/phaseNumber ambiguity**: when a phase was not found it previously only returned "phase #N does not exist", leaving the model unable to locate the real ID. It now returns the full phase list (phase ordinal + real phaseId + title, with the current phase highlighted). `dgoal_check` / `dgoal_plan` gained a `phaseNumber` (phase ordinal) parameter as an alternative to `phaseId` (supplying both is rejected); `phaseId=2` is no longer silently interpreted as the second phase.
- **Auditor quota errors did not trigger candidate fallback**: provider business-layer quota exhaustion (e.g. `Codex error: The usage limit has been reached`) is returned as plain text, neither a structured HTTP 429 nor a network error, so it was classified as `unknown` → `retry_same_model` → three retries on the same model and then a pause without switching candidates. `classifyAuditorFailure` now triggers `fallback` to the next candidate for explicit quota text (usage/plan/rate limit, quota exceeded, insufficient quota); business `REJECTED`, HTTP 400, and unknown non-quota errors (e.g. `context length exceeded`, `billing address invalid`, `credit card declined`, `quota field invalid`) keep their original behavior.

### Changed
- **Audit-model candidate chain and preflight**: added `phaseAuditorModels` / `goalAuditorModels`, with up to 3 ordered `provider/model[:thinking]` candidates per audit scope. A project-level chain takes overall precedence over the global chain, and within the same source plural > matching singular value > legacy `auditorModel`; `null` explicitly inherits the current session model and blocks further fallback, while legacy single-value config is not rewritten automatically. Parsing warns item by item about illegal/duplicate/over-limit entries and preflights using a structured Pi `get_available_models` result under the same isolation boundary as the audit child (full model ID first, then trailing thinking detection); successful results are cached for the current Pi process, and preflight failures keep the candidates for runtime. See ADR 0015.
- **Auditor model-selection template initialization**: on the first real independent audit, if neither a global nor a trusted project-level `pi-dgoal.json` exists, a global template containing only the two plural fields set to `null` is created atomically; existing files are not overwritten. Bad JSON or unreadable files only warn and degrade, and write failures still fall back to the current session model without interrupting the audit.
- **Auditor candidate-chain runtime fallback and partial-output continuation**: structured technical failures of the auditor (HTTP 401/403/404/408/429/5xx, network errors, zero-output timeouts) or explicit plain-text quota exhaustion switch to the next model in order; HTTP 400, user interruption, and explicit `<APPROVED>` / `<REJECTED>` do not switch. With partial output but no terminal marker, the same model is retried up to 3 times with the existing text injected as bounded `<partial_audit_feedback>` (6000-character limit, XML escaping); if still inconclusive, the chain moves on to the next candidate with the partial text. When all candidates are exhausted it enters an `audit_error` pause and never silently falls back to the current execution model. Tool progress `onUpdate` and final `details` record the model actually used, config/preflight degradation status, each attempt's trace (model, outcome, reason, network code, process exitCode, error text), and the exhaustion flag; traces are not written to `GoalState`, and partial feedback does not pollute the official `phaseFeedbackById` / `finalFeedback`. See ADR 0015.

## [0.5.6] - 2026-07-07

### Fixed
- **Overlay and goal state not resynced after `/tree` navigation**: `/tree` (`navigateTree`) switches session branches in place, emitting only `session_tree` and not `session_start`, and pi-dgoal previously did not listen for `session_tree`, so `currentGoal` stayed on the old branch and the plan overlay showed stale state (phases clearly done still shown unfinished, timers frozen). Extracted `resyncGoalFromSession` (cancel old continuation, clear check snapshot/auditor tracker + `loadGoal` + setStatus + overlay resync) and shared it between `session_start` and the new `session_tree` handler so the two event paths do not diverge; each successful resync increments an in-memory-only session generation so late audit results from the old branch cannot write to the new one, already-sent but undispatched old continuations are dropped by the input handler, and UI errors do not block state resync. `/fork` goes through `session_start reason fork` and is covered by the same sync.
- **`/dgoal` startup did not pause current LLM work**: `startGoal` previously did not abort the current agent turn (`clearGoal` has `ctx.abort`, `startGoal` did not), so typing `/dgoal` while the LLM was working waited for the current turn to finish before entering dgoal. `startGoal` now calls `ctx.abort` when not idle (following `shouldAbortCurrentTurnOnClear`), and a `startGoalInProgress` flag wraps the whole "create pending goal → deliver propose prompt" section in try/finally to suppress the interrupted turn's `agent_end` from triggering `handleStartupGate` and colliding with startGoal's own propose delivery (double send).
- **`dgoal_plan` / `dgoal_propose` compatibility with models that serialize array parameters as strings**: models sometimes serialize `blockedBy` / `addBlockedBy` / `removeBlockedBy` (and `dgoal_propose`'s `phases[].tasks[].blockedBy`) as strings `"[]"` / `"[1,2]"` instead of real arrays; previously pi-ai argument validation (`TypeBox` `Value.Convert` converting the string into an array-like structure and validating element by element) rejected with `blockedBy.0: must be number`, so creating tasks or adding dependencies failed. Added a `prepareArguments` hook (the framework's seam for normalizing bad model input before validation, executed before `validateToolArguments`) that `JSON.parse`s stringified arrays back to `number[]`; the schema stays strictly `Array<number>` without loosening the LLM contract. The reducer entry point also keeps `coerceNumberArray` as a defensive second cleaning pass.

## [0.5.5] - 2026-07-07

### Fixed
- **Audit child sees the real working directory in git worktree scenarios**: isolated audit subprocesses started by `dgoal_check` / `dgoal_done` previously always launched with the session's `ctx.cwd`, so when the agent edited files in a separate `git worktree` (nested worktree) the audit could not see the changes, forcing the agent to `git apply` the diff back to the main worktree to pass checks. Added audit working-directory inference: first take the path of a successfully executed file tool call in the current round (`edit` / `write`, then falling back to `read`), then the most recent file tool call in persisted session history, and finally switch to that worktree root when its git root differs from the git root of the current `ctx.cwd`; stay on the original `ctx.cwd` within the same repository and fall back to the current directory when there is no file history. The tracker lifecycle is aligned with goals: it resets in `startGoal` / `clearActiveGoal` / `finalizeGoal` / `session_start` / `session_shutdown`, preventing one goal's worktree path from leaking to the next.

## [0.5.4] - 2026-07-06

### Added
- **`dgoal_propose` plan-readiness self-check**: the startup-gate confirmation UI now shows plan-level L0-L3 readiness grades and gap hints, prioritizing insufficient `non-goals` boundaries. `dgoal_propose` gained optional `nonGoals` / `guardrails` / `budget` fields as plan-level signals; after confirmation, boundaries persist to `GoalState` and a `<dgoal_boundaries>` block is injected into the execution-time system prompt. Readiness evaluation is an assessment before plan submission, not a runtime autonomy tier, and introduces no project-level `loop-audit` / badge.
- **`dgoal_done` verifiable completion text**: `dgoal_done` gained optional `whatChanged` (list of changes) and `userReview` (items still needing user verification) fields; the completion reply signal was upgraded from a vague "done" announcement to structured, verifiable text (goal / completion summary / verification evidence / what changed / still for you to verify / audit conclusion). The final-review task input also includes the change list so the auditor can verify it. Corresponding debt model: comprehension debt is recovered by the agent's explanation, while intent debt cannot be repaid by the agent (`userReview` prompts human verification).

### Changed
- **loop naming cleanup**: per the decision "goal/loop are not distinguished; use goal/dgoal externally", remaining `loop` names were cleaned up. Type names `LoopGoal`→`GoalState`, `LoopStatus`→`GoalStatus`, `LoopContext`→`DgoalContext`, `LoopStateEntryData`→`DgoalStateEntryData`; function names `isLooping`→`isGoalRunning`, `handleLoopCommand`→`handleDgoalCommand`; prompt injection tags `<loop_*>`→`<dgoal_*>`. Code, tests, and current authoritative docs are synced; archives and decision records retain their original historical names without retroactive changes.

### Fixed
- **`dgoal_done` success path no longer inlines the full audit report**: the completion reply signal previously concatenated the raw long final-review report into the signal text for the main model, causing final replies to hit the maximum output token limit and be truncated. It now keeps only the audit conclusion without inlining the report text.

## [0.5.3] - 2026-06-29

### Added
- **Independent-auditor model configuration**: added `~/.pi/agent/pi-dgoal.json` or project `.pi/pi-dgoal.json`, allowing a separate model for the isolated audit subprocess via `auditorModel` (format `provider/model`). Resolution order: project-level (only when the project is trusted) > global > current session model; when config is missing, unreadable, or invalid it falls back to the current session model without interrupting the audit. On the first audit with no config files, dgoal gives a one-time i18n notice of the global path (wording follows the locale when `pi-di18n` is installed) and stays silent afterwards; config files are not created automatically. This setting affects only auditor model selection and does not change the main execution thread model.
- **Exhaustive audit prompts**: `PHASE_CHECK_SYSTEM_PROMPT` and `AUDITOR_SYSTEM_PROMPT` gained "list everything at once" and "list all findings by severity" instructions, requiring the auditor to list every issue it can find within the round's budget (FAIL/BLOCKER must be listed; warnings are listed but need not cause REJECTED) instead of stopping at the first blocker, reducing piecemeal back-and-forth.
- **Re-review feedback injection**: when previous-round feedback exists, `buildPhaseCheckTask` / `buildAuditorTask` inject the persisted raw `phaseFeedbackById` / `finalFeedback` reports into the audit child's task in a `<previous_feedback>` block; both SYSTEM_PROMPTs gained a "re-review focus" instruction requiring the auditor to first verify that last round's issues were genuinely fixed and then check for all new issues, eliminating re-review blind spots. Data structures are unchanged and existing feedback persistence is reused.
- **New decision**: added `doc/决策档案/0013-auditorModel配置落点选独立文件.md`, recording why auditor model configuration uses `pi-dgoal.json` rather than Pi's `settings.json` (it does not rely on Pi's undocumented tolerance of unknown fields).

## [0.5.2] - 2026-06-27

### Added
- **Check-feedback loop enhancements**: `LoopGoal` gained `phaseFeedbackById` / `finalFeedback`, persisting raw reports from failed phase checks and final-review rejections into session state; the system prompt injects `<check_feedback>` after `<loop_plan>` according to state so the main agent can still read the full failure report after compact / recovery / rejection loops.
- **Event-streamed auditor liveness**: `runIsolatedCheck` now consumes `thinking_*`, `toolcall_*`, `text_delta`, `message_end`, and other events, with every valid event resetting the idle timer; liveness state and an `idle Ns/120s` countdown are streamed via `onUpdate` and are not written to `LoopGoal`.
- **Bare `/dgoal` carries prior context into startup**: an empty-argument `/dgoal` no longer falls through to a status query but takes startup-gate "path B"; the command layer only sends a carry-over signal and the main agent summarizes the objective in `dgoal_propose`. When there is no prior context to carry over, it suggests `/dgoal <objective>` instead.
- **TUI smoke evidence**: recorded ANSI evidence of the startup-gate confirmation UI, provider/model identifiers, the `/dgoal s` detailed-query modal, the expanded persistent overlay, and bare-`/dgoal` context-carrying startup (covering slices 4/8 of key paths). Targeted TUI supplementary recording for slices 5/6 could not be completed due to the current Pi 0.80.2 inline-extension runtime limitation, so unit/integration tests cover them instead.

### Changed
- **Check results tri-stated**: `dgoal_check` / final review now formally distinguish `approved` / `rejected` / `auditor_error`; `rejected` keeps `isError: false` (a normal business outcome) while only `auditor_error` is `isError: true` (an auditor exception).
- **3 transparent retries on `auditor_error`**: auditor exceptions are retried at most 3 times within one tool call; any successful retry converges to a normal check result, and only 3 failures enter `paused(audit_error)`.
- **Check gate lock and out-of-gate progression blocking**: when a phase check fails, the goal stays `active` but only that phase may be fixed; `dgoal_check` on later phases and `dgoal_done` while earlier phases have not passed are hard-rejected.
- **Tighter user-visible boundaries**: the aboveEditor overlay, the `/dgoal s` detailed-query modal, and the bottom status bar continue to show only status and plan structure, not the check-report body.
- **Persistent overlay expanded state narrowed**: `Ctrl+O` expansion of the persistent overlay expands only `pending / in_progress` phases; a `done phase` shows only its title line and no longer expands its tasks, while the `/dgoal s` detailed-query modal keeps full phase/task detail.
- **Chinese/English terminology unified**: standardized the Chinese UI labels for "live overlay," "expanded live overlay," and "Detailed Query Modal," with the English copy aligned to the same terms.

## [0.5.1] - 2026-06-23

### Added
- **AI-driven smoke (`npm run test:smoke`)**: added `test/test-ai-smoke.py`, which uses `pi -ne -e ./index.ts -ns -np --mode rpc --no-session` in an isolated environment (temporary working directory, this extension only) to run the full multi-phase dgoal tool chain (`dgoal_propose → dgoal_plan → dgoal_check → dgoal_done`) with a real model, automatically answering the startup-gate `select` (choosing the `confirmStart` option) and tracking `isError`, file artifacts, and exit signals for every `dgoal_*` call. Fills the verification gap between offline RPC tests (loading/command registration only) and manual TUI smoke. ⚠️ Consumes real tokens and requires network access and a configured provider; not part of CI.

### Changed
- **`/dgoal s` modal long-text wrapping**: headings, phase subjects, and task subjects now wrap instead of truncating with `...` when they exceed the modal width, with continuation lines aligned to the content column and scrolling computed by physical wrapped lines.
- **Plan injection soft-forgetting (ADR 0010)**: `buildPlanContextBlock` now injects only the title line for done phases that passed checks, omitting their tasks' subject/evidence. Analogy to R-SWA (reference sliding-window attention): goal + context are globally visible (reference layer), current phase + task are focused (working memory), and done-phase task details are softly forgotten to focus on current progress. Does not change `goal.plan` persistence (fully saved), does not change audit subprocess visibility (reads the full persisted state), and adds no lookup tool (it relies on the done-phase title line plus the check report as two natural paths); soft-forgetting happens when the phase as a whole is done, while completed tasks within the current phase are still injected.

## [0.5.0] - 2026-06-22

### Changed
- **`/dgoal s` modal anchor changed from top-center to center (additional decision in ADR 0008)**: in real use, top-center visually "hung" at the top and was not focused enough; `/dgoal s` is an on-demand query popup that users open, read, and close, so it covers chat history only briefly and the original reason for rejecting center was weak; `maxHeight` 85% + scrolling already solves the content-visibility problem. The overlay config is now `anchor: "center"`, activating the original alternative Variant C.
- **TUI visual-encoding refactor: hierarchy by color, status by character (ADR 0009)**: the `/dgoal s` modal no longer colors whole rows by status but assigns base colors by content hierarchy — `goal = accent + bold`, `phase = text`, `task = dim`; `phase`/`task` now share one set of status characters `○ / ◐ / ✓ / ⚠` (removing the modal's dual `PHASE_EMOJI`/`TASK_EMOJI` tracks and aligning with the persistent overlay's `PHASE_ICON`), while `goal` keeps `🎯`. `in_progress` no longer adds bold; status is conveyed only by characters. Color choices assume cross-theme visibility, excluding hues such as `yellow` that are easily lost on white backgrounds.

### Added
- **`done` strikethrough extended to phases**: done `phase`/`task` title text in both the modal and the persistent overlay now has a strikethrough (ANSI 9/29), applied only to the title text, not to the status characters `○/◐/✓/⚠` or tree glyphs `├─ / │`; inline suffix notes (`activeForm`, `blockedReason`) are deemphasized as auxiliary information and excluded from the strikethrough.
- **New terminology and decisions**: added "hierarchy base color" and "status character" to `doc/术语表.md`; added `doc/决策档案/0009-tui-visual-encoding-layer-over-status.md` (overriding ADR 0008's emoji + status-color scheme).

### Fixed
- **Status bar `zh-CN` genuinely localized**: status-bar copy such as `🔁 active #N / paused / starting / rejected / done` previously kept English status words under the Chinese locale; it is now localized to five two-character Chinese status labels.
- **`/dgoal s` empty-state consistency**: with no active goal, TUI mode also shows a center modal empty state; non-TUI still degrades to notify, user-visible copy consistently uses dgoal rather than loop, and `ESC/Ctrl+C` close hints were restored.
- **`/dgoal s` shortcut hints dynamic**: when plan content does not exceed the modal's visible height, only `ESC/Ctrl+C` is hinted; `j/k`, arrow keys, and paging keys appear only when the content is scrollable.

### Reminders
- **Persistent-overlay colorization deferred**: this round only unified modal visual encoding; theme-aware colorization of the persistent overlay (`aboveEditor widget`) is deferred to the next release (see `doc/30-路线图/30-项目路线图.md`) to avoid opening a new surface of TUI rendering bugs.

## [0.4.2] - 2026-06-20

### Added
- **`/dgoal s` top-center overlay modal**: `showStatus()` now prefers a scrollable top-center overlay modal via `ctx.ui.custom()` in TUI mode, showing the full goal / phase / task status; the heading is pinned and `j/k`, arrow keys, `PgDn/PgUp`, `End/G`, `Home/g`, and `ESC` are supported.
- **Pure status-render functions and component tests**: added `RenderLine`, `buildBodyLines*`, `buildHeadingLine`, `colorize`, `computeScrollOffset`, and `PlanStatusDialog`, plus regression coverage in `plan-status-pure.test.ts`, `plan-status-dialog.test.ts`, and `show-status.test.ts`.

### Changed
- **`/dgoal s` query form upgraded**: from a 5-line `notify` to a top-center overlay modal (Variant A, see `doc/决策档案/0008-dgoal-s-modal-形态选型.md`); it falls back to the old notify without TUI / `ctx.ui.custom()` for RPC / print / json compatibility.
- **User-interruption pause notice color**: the "Dgoal paused (user interrupt…)" notice now uses `error` (red) rather than `warning` (yellow) for better visibility in dark themes.

### Fixed
- **elapsed no longer swallows pause boundaries**: after a goal pauses it records `pauseStartedAt`, which is added to `pausedTotalMs` on resume; `⏱️ elapsed` in overlays/modals/headings now excludes pause windows and no longer counts the time from `/dgoal pause` to `/dgoal resume` toward total duration.
- **Modal title through i18n**: the `/dgoal s` popup title is no longer hard-coded English and follows the `pi-di18n` locale or local fallback.
- **Document state contract unified to `done`**: README and the authoritative data-model document no longer expose the old `completed` as a current task/phase status.

### Removed
- **Deleted throwaway prototype**: removed `prototype/dgoal-status-modal.prototype.ts` and `prototype/dgoal-status-modal.preview.ts`.

### Reminder
- **Run `/reload` after upgrading**: this release adds an overlay modal, so `/reload` the extension in Pi before trying the new `/dgoal s` form.

## [0.4.1] - 2026-06-19

### Fixed
- **Goal finalization tolerates TUI render errors**: after `dgoal_done` succeeds, `finalizeGoal`'s calls to the host TUI (completion overlay, clearing the status bar) are now wrapped in try/catch, so TUI render errors such as `Spacer is not defined` no longer block clearing goal state — the goal still correctly lands in `done` and is cleared even if the UI display fails, avoiding a stuck goal that cannot be closed.

## [0.4.0] - 2026-06-19

### Added
- **Single-letter `/dgoal` commands**: users can now use `/dgoal s`, `/dgoal p`, `/dgoal r`, and `/dgoal c` for status, pause, resume, and clear respectively

### Changed
- **Command hint copy**: the Ctrl+O overlay, status output, and Chinese/English docs now show the full spelling + single-letter shortcut form, with English help using `[s]tatus` / `[p]ause` / `[r]esume` / `[c]lear`

### Removed
- **Removed the `/dgoal stop` alias**: `stop` no longer maps to `clear`; use `/dgoal clear` or `/dgoal c` instead

### Fixed
- **TUI timer icon rendering**: the overlay title bar's timer now uses an explicit emoji form `⏱️` (with a variation selector) so some terminals do not render it as black-and-white glyphs with text-character styling

## [0.3.0] - 2026-06-18

### Fixed
- **Task ID numbering**: `proposalToPlan()` now numbers phases and tasks each starting from 1 (they previously shared a counter, so phases took ID=1 and tasks started at 2)
- **blockedBy mapping**: 1-based in-phase `blockedBy` indices in proposals now map correctly to global task IDs (previously passed through directly, causing misaligned references)
- **Sequential phase execution**: added a hard phase-order constraint to the system prompt and an `enforcePhaseOrder()` guard in the `dgoal_plan` tool to block cross-phase operations
- **TUI goal done overlay does not disappear**: `finalizeGoal()` now calls `planOverlay.dispose()` to clear the overlay
- **TUI final phase not showing completion**: in the done state, completed phases are no longer hidden; the full final result is shown (all ✓ + N/N)
- **Audit child idle-timeout misjudgment**: `dgoal_check` / auditor subprocesses now refresh the watchdog on any `stdout` chunk instead of waiting for a complete newline-delimited JSON line, preventing half-line streamed output from being killed
- **Incomplete audit-child cleanup**: on timeout/interruption it now prefers terminating the detached process group, avoiding grandchildren inheriting pipes and leaving `close` hanging for a long time

### Changed
- **PlanStatus terminal state unified to `done`**: task/phase terminal state changed from `completed` to `done` (consistent with the goal-level `LoopStatus.done`) across type definitions, TUI icons, system prompt, tool descriptions, and error messages
- **Startup gate shows a summary by default**: the confirmation UI shows goal / verification / phase and task counts by default, with task details expanded on demand so the initial dialogue is not flooded with fine-grained tasks
- **`verification` required**: `dgoal_propose`'s `verification` changed from optional to required (tool schema + `validateProposalInput` tool-layer validation); a goal without a verifiable completion gate is rejected at the tool layer and never enters startup-gate confirmation; empty talk is handled by prompt guidance plus a final-review backstop (ADR 0007)

### Added
- **TUI timer**: the overlay title bar shows elapsed time (e.g. `⏱️ 2m 34s`)
- **TUI delayed disappearance after done**: after a goal completes, the overlay keeps the final state visible for 10 seconds before auto-hiding (for cases where the agent starts tasks of a later phase while the current phase is unfinished)
- **Subprocess-supervision regression test**: added `subprocess-supervision.test.ts`, reproducing cleanup when the parent exits but grandchildren inherit pipes

## [0.2.0] - 2025-06

### Added
- **Three-tier Task Plan content**: goal (frozen) → phase (phase goal) → task (fine-grained execution units decomposed as needed), with `dgoal_plan` CRUD support
- **Check loop**: the only way to complete a phase is `dgoal_check` (verification by an isolated read-only subprocess), with no bypass
- **Startup gate**: `dgoal_propose` submits a plan → user confirmation UI (confirm/reject/feedback) → activate loop
- **Final-review audit**: `dgoal_done` triggers an isolated read-only subprocess audit and automatically pauses after 3 consecutive failures
- **Plan overlay**: a TUI aboveEditor widget shows plan state (phases visible by default, tasks expandable)
- **Startup background context solidification**: before `/dgoal` starts, structured background (goal scope / key constraints / acceptance criteria) is extracted from prior discussion and injected into every subsequent turn's system prompt

### Changed
- Renamed `pi-dloop` → `pi-dgoal`
- The README became an English facade-style entry point, with the Chinese documentation moved to `README-zh.md`
- Established the full design-document system (`doc/10-架构与运行/`, ADR 0001–0006)

### Fixed
- After completion, correctly hand back to the model to reply to the user (no more self-continuing)
- Cleaned up residual dloop references

## [0.1.1] - 2025-05

### Added
- Automatically solidify prior context before startup (summarizeContext subprocess)
- Automatic model-error retry (limit of 3 times)
- Audit-report sanitization (noise removal)

### Fixed
- Use a total-size cap for background-solidification input (previously truncating by message count could exceed the limit)
- Avoid fully expanding loop context in user messages (use preview + system-prompt injection in two tracks instead)
- Prevent Dloop background solidification from being misleading (explicitly labeled as reference evidence rather than new instructions)
- Remove leftover notices during an audit and add a notice on audit success

## [0.1.0] - 2025-05

### Added
- Initial version: a lightweight goal-loop extension (the `/dloop` command)
- Independent completion audit (in-process session version, later refactored to a subprocess)
- Auditor switched to the official CLI subprocess approach, strictly read-only
- Unified prompts in Chinese
