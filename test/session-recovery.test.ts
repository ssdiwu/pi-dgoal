import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import dgoal, {
  __fingerprintProposalBaseForTest,
  __clearActiveGoalForTest,
  __getGoalForTest,
  __getPendingProposalForTest,
  __getRuntimeStateForTest,
  __resetGoalForTest,
  __pauseGoalForTest,
  __setGoalForTest,
  __setProposalSemanticReviewForTest,
  __setRuntimeStateForTest,
  buildProposalConfirmationOptions,
  goalPlanTool,
  handleDgoalCommand,
  persistPlanHistory,
  persistWorkGoal,
  resyncGoalFromSession,
  sendContinuation,
  SESSION_SCOPE_ENTRY_TYPE,
  workUpdateTool,
  type GoalState,
  type PlanProposal,
} from "../index.ts";

type Entry = { id?: string; timestamp?: string; type: "custom"; customType: string; data: unknown };

function executionGoal(overrides: Partial<GoalState> = {}): GoalState {
  return {
    id: "recover-execution",
    objective: "恢复未完成实现",
    description: "沿用同一计划与既有进度。",
    status: "active",
    startedAt: 10,
    updatedAt: 20,
    iteration: 3,
    workList: {
      items: [{ id: 1, subject: "核对副作用", description: "确认中断前是否已经产生外部副作用。", status: "in_progress" }],
      phases: [],
      nextItemId: 2,
      nextPhaseId: 1,
      revision: 4,
    },
    contract: {
      id: "run-recover-execution",
      profile: "execution",
      startedAt: 10,
      revision: 4,
      transitions: [{ to: "execution", at: 10, revision: 4 }],
    },
    ...overrides,
  };
}

function softGoal(): GoalState {
  const plan = executionGoal({ id: "soft", contract: undefined });
  return { ...plan, workList: { ...plan.workList!, revision: 1 } };
}

function pendingGoal(): GoalState {
  return {
    id: "pending-review",
    objective: "恢复待确认计划",
    description: "计划已生成但尚未确认。",
    status: "pending",
    startedAt: 10,
    updatedAt: 20,
    iteration: 0,
  };
}

function proposal(): PlanProposal {
  return {
    objective: "恢复待确认计划",
    description: "计划已生成但尚未确认。",
    assuranceProfile: "goal_check",
    workList: {
      items: [{ id: 1, subject: "实现恢复", description: "实现并验证恢复路径。", status: "pending" }],
      phases: [],
      nextItemId: 2,
      nextPhaseId: 1,
      revision: 0,
    },
    verification: "bun test test/session-recovery.test.ts",
    acceptanceCriteria: [{ criterion: "恢复行为可重复验证", evidence: "bun test test/session-recovery.test.ts" }],
    phases: [],
  };
}

function upgradeProposal(goal: GoalState): PlanProposal {
  return {
    objective: goal.objective,
    description: goal.description,
    assuranceProfile: "goal_check",
    workList: { ...structuredClone(goal.workList!), revision: goal.workList!.revision + 1 },
    verification: "bun test test/session-recovery.test.ts",
    acceptanceCriteria: [{ criterion: "恢复后的原计划可继续升级", evidence: "bun test test/session-recovery.test.ts" }],
    phases: [],
  };
}

function goalCheckUpgradeInput(goal: GoalState) {
  const item = goal.workList!.items[0];
  return {
    objective: goal.objective,
    description: goal.description,
    verification: "bun test test/session-recovery.test.ts",
    acceptanceCriteria: [{ criterion: "恢复流程可回归", evidence: "bun test test/session-recovery.test.ts" }],
    items: [{ id: item.id, subject: item.subject, description: item.description }],
    phases: [],
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let turn = 0; turn < 30 && !predicate(); turn += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  expect(predicate()).toBe(true);
}

function workEntry(goal: GoalState | null, pendingProposal?: { goalId: string; proposal: PlanProposal; baseFingerprint?: string }): Entry {
  if (goal?.workList && pendingProposal && pendingProposal.baseFingerprint === undefined) {
    pendingProposal.baseFingerprint = __fingerprintProposalBaseForTest(goal);
  }
  return { type: "custom", customType: "dgoal-work-v1", data: { goal, ...(pendingProposal ? { pendingProposal } : {}) } };
}

function legacyWorkEntry(goal: GoalState | null, pendingProposal?: { goalId: string; proposal: PlanProposal }): Entry {
  return { type: "custom", customType: "dgoal-work-v1", data: { goal, ...(pendingProposal ? { pendingProposal } : {}) } };
}

function historyEntry(goal: GoalState): Entry {
  return {
    type: "custom",
    customType: "dgoal-plan-history-v1",
    data: {
      records: [{
        id: goal.contract!.id,
        goalId: goal.id,
        objective: goal.objective,
        description: goal.description,
        goalStartedAt: goal.startedAt,
        endedAt: goal.updatedAt + 1,
        terminalReason: "cleared",
        workList: structuredClone(goal.workList),
        contract: structuredClone(goal.contract),
      }],
    },
  };
}

interface HarnessOptions {
  editor?: () => Promise<string | undefined>;
  confirm?: () => Promise<boolean>;
  abort?: () => void;
  beforeAppend?: (customType: string, data: unknown) => void;
  afterAppend?: (customType: string, data: unknown) => void;
  sendUserMessage?: (message: string, options?: unknown) => void | Promise<void>;
  initialIdle?: boolean;
  sessionId?: string;
  header?: { id?: string; parentSession?: string; timestamp?: string };
  sessionFile?: string;
}

function makeHarness(
  initial: Entry[],
  select?: () => Promise<string | undefined>,
  options: HarnessOptions = {},
) {
  let entrySequence = 0;
  const entries = initial.map((entry) => ({ ...entry, id: entry.id ?? `entry-${++entrySequence}` }));
  const sent: string[] = [];
  const sendCalls: Array<{ message: string; options?: unknown }> = [];
  const statuses: Array<string | undefined> = [];
  const notifications: string[] = [];
  const providerRequests: unknown[] = [];
  const handlers = new Map<string, Function>();
  let selectCalls = 0;
  let idle = options.initialIdle ?? true;
  let runActive = false;
  let runAborted = false;
  let abortCalls = 0;
  let effectiveAborts = 0;
  const ctx = {
    cwd: "/tmp",
    ui: {
      setStatus: (_key: string, value: string | undefined) => statuses.push(value),
      notify: (message: string) => notifications.push(message),
      ...(select ? { select: async () => { selectCalls += 1; return select(); } } : {}),
      ...(options.editor ? { editor: options.editor } : {}),
      ...(options.confirm ? { confirm: options.confirm } : {}),
    },
    sessionManager: {
      getBranch: () => entries,
      getSessionId: () => options.sessionId ?? "session-recovery-test",
      getLeafId: () => entries.at(-1)?.id ?? null,
      getHeader: () => options.header ?? null,
      getSessionFile: () => options.sessionFile,
    },
    isIdle: () => idle,
    hasPendingMessages: () => false,
    abort: () => {
      abortCalls += 1;
      options.abort?.();
      if (runActive) {
        runAborted = true;
        effectiveAborts += 1;
      }
    },
  } as never;
  const pi = {
    registerTool: () => {},
    registerCommand: () => {},
    on: (name: string, handler: Function) => handlers.set(name, handler),
    events: { emit: () => {} },
    appendEntry: (customType: string, data: unknown) => {
      options.beforeAppend?.(customType, data);
      entries.push({ id: `entry-${++entrySequence}`, timestamp: new Date().toISOString(), type: "custom", customType, data });
      options.afterAppend?.(customType, data);
    },
    sendUserMessage: (message: string, sendOptions?: unknown) => {
      sent.push(message);
      sendCalls.push({ message, ...(sendOptions === undefined ? {} : { options: sendOptions }) });
      return options.sendUserMessage?.(message, sendOptions);
    },
  } as never;
  dgoal(pi);
  return {
    entries, sent, sendCalls, statuses, notifications, providerRequests, handlers, ctx, pi,
    getSelectCalls: () => selectCalls,
    getAbortCalls: () => abortCalls,
    getEffectiveAborts: () => effectiveAborts,
    setIdle(value: boolean) { idle = value; },
    async driveLastPlanRun(runOptions: {
      finalPrompt?: string;
      messageEndPrompt?: string;
      interleave?: () => Promise<void> | void;
      afterMessageEnd?: () => Promise<void> | void;
      settle?: boolean;
    } = {}) {
      const message = sent.at(-1);
      if (!message?.includes("pi-dgoal-delivery:")) return undefined;
      const inputResult = await handlers.get("input")?.({ source: "extension", text: message }, ctx);
      if (inputResult?.action === "handled") return { inputResult };
      await runOptions.interleave?.();
      const finalPrompt = runOptions.finalPrompt ?? message;
      const beforeResult = await handlers.get("before_agent_start")?.({
        prompt: finalPrompt,
        systemPrompt: "system",
        systemPromptOptions: { cwd: "/tmp" },
      }, ctx);
      idle = false;
      runActive = true;
      runAborted = false;
      await handlers.get("agent_start")?.({ type: "agent_start" }, ctx);
      const userMessage = { role: "user", content: [{ type: "text", text: runOptions.messageEndPrompt ?? finalPrompt }], timestamp: Date.now() };
      const messageEndResult = await handlers.get("message_end")?.({ type: "message_end", message: userMessage }, ctx);
      const finalizedMessage = messageEndResult?.message ?? userMessage;
      await runOptions.afterMessageEnd?.();
      if (!runAborted) providerRequests.push(finalizedMessage);
      if (runAborted) {
        const aborted = { role: "assistant", content: [], stopReason: "aborted", timestamp: Date.now() };
        await handlers.get("message_end")?.({ type: "message_end", message: aborted }, ctx);
        await handlers.get("agent_end")?.({ type: "agent_end", messages: [aborted] }, ctx);
      }
      runActive = false;
      idle = true;
      if (runAborted || runOptions.settle) await handlers.get("agent_settled")?.({ type: "agent_settled" }, ctx);
      return { inputResult, beforeResult, finalizedMessage, runAborted };
    },
    async driveDirectUserRun(prompt: string, messageEndPrompt = prompt) {
      const inputResult = await handlers.get("input")?.({ source: "interactive", text: prompt }, ctx);
      const beforeResult = await handlers.get("before_agent_start")?.({
        prompt,
        systemPrompt: "system",
        systemPromptOptions: { cwd: "/tmp" },
      }, ctx);
      idle = false;
      runActive = true;
      runAborted = false;
      const userMessage = { role: "user", content: [{ type: "text", text: messageEndPrompt }], timestamp: Date.now() };
      const messageEndResult = await handlers.get("message_end")?.({ type: "message_end", message: userMessage }, ctx);
      const finalizedMessage = messageEndResult?.message ?? userMessage;
      if (!runAborted) providerRequests.push(finalizedMessage);
      if (runAborted) {
        const aborted = { role: "assistant", content: [], stopReason: "aborted", timestamp: Date.now() };
        await handlers.get("message_end")?.({ type: "message_end", message: aborted }, ctx);
        await handlers.get("agent_end")?.({ type: "agent_end", messages: [aborted] }, ctx);
      }
      runActive = false;
      idle = true;
      if (runAborted) await handlers.get("agent_settled")?.({ type: "agent_settled" }, ctx);
      return { inputResult, beforeResult, finalizedMessage, runAborted };
    },
  };
}

const temporaryDirectories: string[] = [];

beforeEach(() => __resetGoalForTest());
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("unfinished Plan recovery", () => {
  test("an incomplete persistent JSONL tail blocks recovery before any dgoal append", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pi-dgoal-tail-"));
    temporaryDirectories.push(directory);
    const sessionFile = path.join(directory, "session.jsonl");
    fs.writeFileSync(sessionFile, '{"type":"session","id":"tail-test"}\n{"type":"custom"');
    let appendCalls = 0;
    const harness = makeHarness([workEntry(executionGoal())], undefined, {
      sessionFile,
      beforeAppend: () => { appendCalls += 1; },
    });

    harness.handlers.get("session_start")!({ reason: "startup" }, harness.ctx);

    expect(__getRuntimeStateForTest().sessionProjectionValid).toBe(false);
    expect(__getGoalForTest()).toBeUndefined();
    expect(appendCalls).toBe(0);
    expect(harness.notifications.at(-1)).toContain("JSONL");
  });

  test("a future session file path that does not exist yet is treated as a clean new session", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pi-dgoal-new-file-"));
    temporaryDirectories.push(directory);
    const sessionFile = path.join(directory, "future-session.jsonl");
    let appendCalls = 0;
    const harness = makeHarness([workEntry(executionGoal())], undefined, {
      sessionFile,
      beforeAppend: () => { appendCalls += 1; },
    });

    harness.handlers.get("session_start")!({ reason: "startup" }, harness.ctx);

    expect(__getRuntimeStateForTest().sessionProjectionValid).toBe(true);
    expect(__getGoalForTest()).toMatchObject({ status: "paused", pauseReason: "session_recovery" });
    expect(appendCalls).toBe(1);
  });

  test("a History append failure poisons the same SessionManager just like Work and scope appends", () => {
    let historyAppendCalls = 0;
    const harness = makeHarness([], undefined, {
      beforeAppend: (customType) => {
        if (customType === "dgoal-plan-history-v1") {
          historyAppendCalls += 1;
          throw new Error("history unavailable");
        }
      },
    });
    harness.handlers.get("session_start")!({ reason: "reload" }, harness.ctx);

    expect(() => persistPlanHistory([])).toThrow("history unavailable");
    expect(__getRuntimeStateForTest().sessionProjectionValid).toBe(false);
    expect(historyAppendCalls).toBe(1);

    __resetGoalForTest();
    harness.handlers.get("session_start")!({ reason: "reload" }, harness.ctx);
    expect(__getRuntimeStateForTest().sessionProjectionValid).toBe(false);
    expect(historyAppendCalls).toBe(1);
  });

  test("cold startup/resume persistently pauses an active Plan without changing its identity or progress", () => {
    for (const reason of ["startup", "resume"]) {
      __resetGoalForTest();
      const original = executionGoal();
      const harness = makeHarness([workEntry(original)]);
      harness.handlers.get("session_start")!({ reason }, harness.ctx);

      expect(__getGoalForTest()).toMatchObject({
        id: original.id,
        status: "paused",
        pauseReason: "session_recovery",
        workList: { revision: 4, items: [{ id: 1, status: "in_progress" }] },
        contract: { id: original.contract!.id, revision: 4 },
      });
      expect(harness.sent).toEqual([]);
      expect(harness.getSelectCalls()).toBe(0);
      expect(harness.statuses.at(-1)).toContain("/dgoal resume");
      expect((harness.entries.at(-1)!.data as { goal: GoalState }).goal).toMatchObject({ status: "paused", pauseReason: "session_recovery" });
    }
  });

  test("reload/new, soft Work Lists, and an already-paused Plan do not enter cold recovery", () => {
    for (const reason of ["reload", "new"]) {
      __resetGoalForTest();
      const ordinaryStart = makeHarness([workEntry(executionGoal())]);
      ordinaryStart.handlers.get("session_start")!({ reason }, ordinaryStart.ctx);
      expect(__getGoalForTest()?.status).toBe("active");
      expect(ordinaryStart.entries).toHaveLength(1);
    }

    __resetGoalForTest();
    const soft = makeHarness([workEntry(softGoal())]);
    soft.handlers.get("session_start")!({ reason: "startup" }, soft.ctx);
    expect(__getGoalForTest()).toMatchObject({ id: "soft", status: "active", contract: undefined });

    __resetGoalForTest();
    const paused = executionGoal({ status: "paused", pauseReason: "user_abort", pauseStartedAt: 15 });
    const existingPause = makeHarness([workEntry(paused)]);
    existingPause.handlers.get("session_start")!({ reason: "startup" }, existingPause.ctx);
    expect(__getGoalForTest()).toMatchObject({ status: "paused", pauseReason: "user_abort", pauseStartedAt: 15 });
  });

  test("fork starts a new session without inheriting copied Plan state", () => {
    const inheritedGoal = executionGoal();
    const inherited = workEntry(inheritedGoal);
    inherited.timestamp = "2026-08-14T00:01:00.000Z";
    const inheritedHistory = historyEntry(inheritedGoal);
    inheritedHistory.timestamp = "2026-08-14T00:02:00.000Z";
    const harness = makeHarness([inherited, inheritedHistory], undefined, {
      sessionId: "forked-session",
      header: { id: "forked-session", parentSession: "/tmp/parent.jsonl", timestamp: "2026-08-14T00:01:00.000Z" },
    });

    harness.handlers.get("session_start")!({ reason: "fork" }, harness.ctx);
    expect(__getGoalForTest()).toBeUndefined();
    expect(__getRuntimeStateForTest().planHistory).toEqual([]);
    expect(harness.entries.at(-1)).toMatchObject({ customType: SESSION_SCOPE_ENTRY_TYPE, data: { sessionId: "forked-session" } });

    __resetGoalForTest();
    harness.handlers.get("session_start")!({ reason: "reload" }, harness.ctx);
    expect(__getGoalForTest()).toBeUndefined();
    expect(__getRuntimeStateForTest().planHistory).toEqual([]);
    expect(harness.entries.filter((entry) => entry.customType === SESSION_SCOPE_ENTRY_TYPE)).toHaveLength(1);

    const local = executionGoal({ id: "fork-local" });
    harness.entries.push({ ...workEntry(local), timestamp: "2026-08-14T00:02:00.000Z" });
    harness.entries.push({ ...historyEntry(local), timestamp: "2026-08-14T00:02:00.000Z" });
    harness.handlers.get("session_start")!({ reason: "reload" }, harness.ctx);
    expect(__getGoalForTest()).toMatchObject({ id: "fork-local", status: "active" });
    expect(__getRuntimeStateForTest().planHistory.map((record) => record.goalId)).toEqual(["fork-local"]);
  });

  test("an in-memory fork without parentSession still creates an isolated durable scope", () => {
    const inheritedGoal = executionGoal({ id: "in-memory-parent" });
    const harness = makeHarness([workEntry(inheritedGoal), historyEntry(inheritedGoal)], undefined, {
      sessionId: "in-memory-fork",
      header: { id: "in-memory-fork" },
    });

    harness.handlers.get("session_start")!({ reason: "fork" }, harness.ctx);
    expect(__getGoalForTest()).toBeUndefined();
    expect(__getRuntimeStateForTest().planHistory).toEqual([]);
    expect(harness.entries.at(-1)).toMatchObject({ customType: SESSION_SCOPE_ENTRY_TYPE, data: { sessionId: "in-memory-fork" } });

    __resetGoalForTest();
    harness.handlers.get("session_start")!({ reason: "reload" }, harness.ctx);
    expect(__getGoalForTest()).toBeUndefined();
    expect(__getRuntimeStateForTest().planHistory).toEqual([]);
  });

  test("a nested fork creates its own durable scope and ignores the parent fork state", () => {
    const parentGoal = executionGoal({ id: "parent-fork-goal" });
    const harness = makeHarness([
      { type: "custom", customType: SESSION_SCOPE_ENTRY_TYPE, data: { sessionId: "parent-fork" } },
      workEntry(parentGoal),
      historyEntry(parentGoal),
    ], undefined, {
      sessionId: "child-fork",
      header: { id: "child-fork", parentSession: "/tmp/parent-fork.jsonl" },
    });

    harness.handlers.get("session_start")!({ reason: "fork" }, harness.ctx);
    expect(__getGoalForTest()).toBeUndefined();
    expect(__getRuntimeStateForTest().planHistory).toEqual([]);
    expect(harness.entries.at(-1)).toMatchObject({ customType: SESSION_SCOPE_ENTRY_TYPE, data: { sessionId: "child-fork" } });

    __resetGoalForTest();
    harness.handlers.get("session_start")!({ reason: "reload" }, harness.ctx);
    expect(__getGoalForTest()).toBeUndefined();
    expect(__getRuntimeStateForTest().planHistory).toEqual([]);
  });

  test("a fork scope write failure hard-locks that SessionManager until a fresh manager scopes the session", () => {
    const inherited = workEntry(executionGoal({ id: "copied-parent" }));
    let scopeAppendCalls = 0;
    const harness = makeHarness([inherited], undefined, {
      sessionId: "fork-scope-retry",
      header: { id: "fork-scope-retry", parentSession: "/tmp/parent.jsonl" },
      beforeAppend: (customType) => {
        if (customType === SESSION_SCOPE_ENTRY_TYPE) {
          scopeAppendCalls += 1;
          throw new Error("scope unavailable");
        }
      },
    });

    harness.handlers.get("session_start")!({ reason: "fork" }, harness.ctx);
    expect(__getRuntimeStateForTest().sessionProjectionValid).toBe(false);
    expect(__getGoalForTest()).toBeUndefined();
    expect(scopeAppendCalls).toBe(1);

    // Extension reload reuses the same SessionManager, so it must not retry an append from a
    // possibly phantom leaf even if the underlying I/O failure appears to have cleared.
    __resetGoalForTest();
    harness.handlers.get("session_start")!({ reason: "reload" }, harness.ctx);
    expect(__getRuntimeStateForTest().sessionProjectionValid).toBe(false);
    expect(__getGoalForTest()).toBeUndefined();
    expect(scopeAppendCalls).toBe(1);

    // Reopening from disk creates a fresh manager. It may establish a new scope from the last
    // complete record without inheriting the poisoned manager's in-memory leaf.
    __resetGoalForTest();
    const reopened = makeHarness([structuredClone(inherited)], undefined, {
      sessionId: "fork-scope-retry",
      header: { id: "fork-scope-retry", parentSession: "/tmp/parent.jsonl" },
    });
    reopened.handlers.get("session_start")!({ reason: "reload" }, reopened.ctx);
    expect(__getRuntimeStateForTest().sessionProjectionValid).toBe(true);
    expect(__getGoalForTest()).toBeUndefined();
    expect(reopened.entries.at(-1)).toMatchObject({ customType: SESSION_SCOPE_ENTRY_TYPE });
  });

  test("a fork scope append that pushes before throwing is never followed by another append on that manager", () => {
    let scopeAppendCalls = 0;
    const inherited = workEntry(executionGoal({ id: "copied-parent-after-push" }));
    const harness = makeHarness([inherited], undefined, {
      sessionId: "fork-scope-after-push",
      header: { id: "fork-scope-after-push", parentSession: "/tmp/parent.jsonl" },
      afterAppend: (customType) => {
        if (customType !== SESSION_SCOPE_ENTRY_TYPE) return;
        scopeAppendCalls += 1;
        throw new Error("scope disk unavailable");
      },
    });

    harness.handlers.get("session_start")!({ reason: "fork" }, harness.ctx);
    expect(__getRuntimeStateForTest().sessionProjectionValid).toBe(false);
    expect(scopeAppendCalls).toBe(1);

    harness.handlers.get("session_start")!({ reason: "reload" }, harness.ctx);
    expect(__getRuntimeStateForTest().sessionProjectionValid).toBe(false);
    expect(scopeAppendCalls).toBe(1);

    __resetGoalForTest();
    const reopened = makeHarness([structuredClone(inherited)], undefined, {
      sessionId: "fork-scope-after-push",
      header: { id: "fork-scope-after-push", parentSession: "/tmp/parent.jsonl" },
    });
    reopened.handlers.get("session_start")!({ reason: "reload" }, reopened.ctx);
    expect(__getRuntimeStateForTest().sessionProjectionValid).toBe(true);
    expect(__getGoalForTest()).toBeUndefined();
    expect(reopened.entries.filter((entry) => entry.customType === SESSION_SCOPE_ENTRY_TYPE)).toHaveLength(1);
  });

  test("fork scope fails closed without a readable current branch and never appends a marker", () => {
    for (const branchMode of ["missing", "non_array", "throw"] as const) {
      __resetGoalForTest();
      const appended: string[] = [];
      const sessionManager: Record<string, unknown> = {
        getSessionId: () => `fork-${branchMode}`,
        getLeafId: () => null,
        getHeader: () => ({ id: `fork-${branchMode}`, parentSession: "/tmp/parent.jsonl" }),
      };
      if (branchMode === "non_array") sessionManager.getBranch = () => null;
      if (branchMode === "throw") sessionManager.getBranch = () => { throw new Error("branch unavailable"); };
      const handlers = new Map<string, Function>();
      dgoal({
        registerTool: () => {}, registerCommand: () => {}, events: { emit: () => {} },
        on: (name: string, handler: Function) => handlers.set(name, handler),
        appendEntry: (customType: string) => appended.push(customType),
        sendUserMessage: () => {},
      } as never);
      const ctx = { cwd: "/tmp", ui: {}, sessionManager } as never;

      if (branchMode === "throw") {
        expect(() => handlers.get("session_start")!({ reason: "fork" }, ctx)).toThrow("branch unavailable");
      } else {
        handlers.get("session_start")!({ reason: "fork" }, ctx);
      }

      expect(__getRuntimeStateForTest().sessionProjectionValid).toBe(false);
      expect(__getGoalForTest()).toBeUndefined();
      expect(appended).toEqual([]);
    }
  });

  test("a restored proposal stays pending until explicit /dgoal review", async () => {
    const goal = pendingGoal();
    const pending = { goalId: goal.id, proposal: proposal() };
    const harness = makeHarness([workEntry(goal, pending)], async () => "确认，开始执行");
    harness.handlers.get("session_start")!({ reason: "startup" }, harness.ctx);

    expect(__getPendingProposalForTest()).toEqual(pending);
    expect(__getRuntimeStateForTest().startupGateGoalId).toBeUndefined();
    expect(harness.statuses.at(-1)).toContain("/dgoal review");
    await harness.handlers.get("agent_end")!({ messages: [{ role: "assistant", stopReason: "stop" }] }, harness.ctx);
    expect(harness.getSelectCalls()).toBe(0);
    expect(harness.sent).toEqual([]);

    await handleDgoalCommand("review", harness.pi, harness.ctx);
    expect(harness.getSelectCalls()).toBe(1);
    expect(__getPendingProposalForTest()).toEqual(pending);
    expect(__getGoalForTest()).toMatchObject({ status: "pending" });
    await harness.driveLastPlanRun();
    expect(__getPendingProposalForTest()).toBeUndefined();
    expect(__getGoalForTest()).toMatchObject({ status: "active", contract: { profile: "goal_check" } });
    expect(harness.sent).toHaveLength(1);
    expect(harness.sent[0]).toContain("Goal Check Plan 已激活");
  });

  test("Esc/defer keeps a restored proposal reusable and a bare pending Goal never auto-retries", async () => {
    const goal = pendingGoal();
    const pending = { goalId: goal.id, proposal: proposal() };
    const deferred = makeHarness([workEntry(goal, pending)], async () => undefined);
    deferred.handlers.get("session_start")!({ reason: "startup" }, deferred.ctx);
    await handleDgoalCommand("review", deferred.pi, deferred.ctx);
    expect(__getGoalForTest()?.status).toBe("pending");
    expect(__getPendingProposalForTest()).toEqual(pending);
    expect(deferred.sent).toEqual([]);
    expect(deferred.notifications.at(-1)).toContain("仍保持待确认");

    __resetGoalForTest();
    const bare = makeHarness([workEntry(pendingGoal())]);
    bare.handlers.get("session_start")!({ reason: "startup" }, bare.ctx);
    await bare.handlers.get("agent_end")!({ messages: [{ role: "assistant", stopReason: "stop" }] }, bare.ctx);
    expect(bare.sent).toEqual([]);
    expect(__getGoalForTest()?.status).toBe("pending");
    const entryCount = bare.entries.length;
    await handleDgoalCommand("review", bare.pi, bare.ctx);
    expect(bare.entries).toHaveLength(entryCount);
    expect(bare.sent).toEqual([]);
    expect(bare.notifications.at(-1)).toContain("没有可复用");
  });

  test("agent_end confirmation waits for agent_settled and dispatches one standalone turn", async () => {
    const goal = pendingGoal();
    const pending = { goalId: goal.id, proposal: proposal() };
    const harness = makeHarness(
      [workEntry(goal, pending)],
      async () => "确认，开始执行",
      { initialIdle: false },
    );
    harness.handlers.get("session_start")!({ reason: "reload" }, harness.ctx);
    __setRuntimeStateForTest({ startupGateGoalId: goal.id });

    await harness.handlers.get("agent_end")!({ messages: [{ role: "assistant", stopReason: "stop" }] }, harness.ctx);
    expect(harness.getSelectCalls()).toBe(1);
    expect(harness.sent).toEqual([]);
    expect(__getRuntimeStateForTest().pendingPlanDelivery).toMatchObject({ phase: "queued", kind: "start" });

    harness.setIdle(true);
    await harness.handlers.get("agent_settled")!({ type: "agent_settled" }, harness.ctx);
    expect(harness.sendCalls).toHaveLength(1);
    expect(harness.sendCalls[0].options).toBeUndefined();
    expect(__getRuntimeStateForTest().pendingPlanDelivery).toMatchObject({ phase: "sent", kind: "start" });
  });

  test("input and before_agent_start only preflight; user message_end commits and removes the marker", async () => {
    const goal = pendingGoal();
    const pending = { goalId: goal.id, proposal: proposal() };
    const harness = makeHarness([workEntry(goal, pending)], async () => "确认，开始执行");
    harness.handlers.get("session_start")!({ reason: "startup" }, harness.ctx);
    await handleDgoalCommand("review", harness.pi, harness.ctx);
    const markedPrompt = harness.sent[0];

    expect(harness.handlers.get("input")!({ source: "extension", text: markedPrompt }, harness.ctx)?.action).not.toBe("handled");
    expect(__getGoalForTest()).toMatchObject({ status: "pending" });
    expect((harness.entries.at(-1)!.data as { goal: GoalState }).goal).toMatchObject({ status: "paused", pauseReason: "model_error" });

    const before = await harness.handlers.get("before_agent_start")!({
      prompt: markedPrompt,
      systemPrompt: "system",
      systemPromptOptions: { cwd: "/tmp" },
    }, harness.ctx);
    expect(before.systemPrompt).toContain("恢复待确认计划");
    expect(before.systemPrompt).toContain("#1 实现恢复");
    expect(__getGoalForTest()).toMatchObject({ status: "pending" });

    await harness.handlers.get("agent_start")?.({ type: "agent_start" }, harness.ctx);
    expect(__getGoalForTest()).toMatchObject({ status: "pending" });
    const userMessage = { role: "user", content: [{ type: "text", text: markedPrompt }], timestamp: Date.now() };
    const sanitized = await harness.handlers.get("message_end")!({ type: "message_end", message: userMessage }, harness.ctx);
    expect(__getGoalForTest()).toMatchObject({ status: "active", contract: { profile: "goal_check" } });
    expect(JSON.stringify(sanitized.message)).not.toContain("pi-dgoal-delivery:");
    expect(JSON.stringify(sanitized.message)).toContain("Goal Check Plan 已激活");
  });

  test("a session_tree between input and user message_end aborts the stale run without touching the new Goal", async () => {
    const goal = pendingGoal();
    const pending = { goalId: goal.id, proposal: proposal() };
    const harness = makeHarness([workEntry(goal, pending)], async () => "确认，开始执行");
    harness.handlers.get("session_start")!({ reason: "startup" }, harness.ctx);
    await handleDgoalCommand("review", harness.pi, harness.ctx);
    const newer = executionGoal({ id: "new-branch-goal", objective: "新分支目标", updatedAt: 99 });

    const result = await harness.driveLastPlanRun({
      interleave: async () => {
        harness.entries.push({ ...workEntry(newer), id: "new-branch-leaf" });
        await harness.handlers.get("session_tree")!({ type: "session_tree" }, harness.ctx);
      },
    });

    expect(result?.runAborted).toBe(true);
    expect(harness.getEffectiveAborts()).toBe(1);
    expect(harness.providerRequests).toEqual([]);
    expect(JSON.stringify(result?.finalizedMessage)).toContain("transition cancelled");
    expect(__getGoalForTest()).toMatchObject({ id: newer.id, status: "active", objective: newer.objective });
    expect((harness.entries.at(-1)!.data as { goal: GoalState }).goal.id).toBe(newer.id);
  });

  test("a session_tree after message sanitization aborts the accepted run before provider execution", async () => {
    const goal = pendingGoal();
    const pending = { goalId: goal.id, proposal: proposal() };
    const harness = makeHarness([workEntry(goal, pending)], async () => "确认，开始执行");
    harness.handlers.get("session_start")!({ reason: "startup" }, harness.ctx);
    await handleDgoalCommand("review", harness.pi, harness.ctx);
    const newer = executionGoal({ id: "tree-after-message", objective: "消息结束后切换的新分支", updatedAt: 101 });

    const result = await harness.driveLastPlanRun({
      afterMessageEnd: async () => {
        harness.entries.push({ ...workEntry(newer), id: "tree-after-message-leaf" });
        await harness.handlers.get("session_tree")!({ type: "session_tree" }, harness.ctx);
      },
    });

    expect(result?.runAborted).toBe(true);
    expect(harness.getEffectiveAborts()).toBe(1);
    expect(harness.providerRequests).toEqual([]);
    expect(__getGoalForTest()).toMatchObject({ id: newer.id, objective: newer.objective, status: "active" });
  });

  test("prompt transforms and pre-prompt compaction fail closed after input observation", async () => {
    for (const mode of ["transform", "compact"] as const) {
      __resetGoalForTest();
      const goal = pendingGoal();
      const pending = { goalId: goal.id, proposal: proposal() };
      const harness = makeHarness([workEntry(goal, pending)], async () => "确认，开始执行");
      harness.handlers.get("session_start")!({ reason: "startup" }, harness.ctx);
      await handleDgoalCommand("review", harness.pi, harness.ctx);
      const finalPrompt = mode === "transform"
        ? harness.sent[0].replace("Goal Check Plan 已激活", "后加载扩展改写了执行指令")
        : undefined;
      const result = await harness.driveLastPlanRun({
        ...(finalPrompt ? { finalPrompt } : {}),
        ...(mode === "compact"
          ? { interleave: () => harness.handlers.get("session_compact")!({ type: "session_compact", willRetry: true }, harness.ctx) }
          : {}),
      });

      expect(result?.runAborted).toBe(true);
      expect(harness.getEffectiveAborts()).toBe(1);
      expect(harness.providerRequests).toEqual([]);
      expect(JSON.stringify(result?.finalizedMessage)).toContain("transition cancelled");
      expect(__getGoalForTest()).toMatchObject({ status: "paused", pauseReason: "model_error" });
    }
  });

  test("a transformer that removes the delivery marker before dgoal input is handled fail closed", async () => {
    const goal = pendingGoal();
    const pending = { goalId: goal.id, proposal: proposal() };
    const harness = makeHarness([workEntry(goal, pending)], async () => "确认，开始执行");
    harness.handlers.get("session_start")!({ reason: "startup" }, harness.ctx);
    await handleDgoalCommand("review", harness.pi, harness.ctx);
    const markedPrompt = harness.sent.at(-1)!;
    const strippedPrompt = markedPrompt.replace(/\n\n<!-- pi-dgoal-delivery:[^>]+ -->$/, "");

    const result = await harness.handlers.get("input")!({ source: "extension", text: strippedPrompt }, harness.ctx);

    expect(result).toEqual({ action: "handled" });
    expect(__getGoalForTest()).toMatchObject({ status: "pending" });
    expect(__getPendingProposalForTest()).toEqual(pending);
    expect(__getRuntimeStateForTest().pendingPlanDelivery).toBeUndefined();
    expect(harness.providerRequests).toEqual([]);
  });

  test("a message_end transformer that removes the marker aborts before Plan activation", async () => {
    const goal = pendingGoal();
    const pending = { goalId: goal.id, proposal: proposal() };
    const harness = makeHarness([workEntry(goal, pending)], async () => "确认，开始执行");
    harness.handlers.get("session_start")!({ reason: "startup" }, harness.ctx);
    await handleDgoalCommand("review", harness.pi, harness.ctx);
    const markedPrompt = harness.sent.at(-1)!;
    const strippedPrompt = markedPrompt.replace(/\n\n<!-- pi-dgoal-delivery:[^>]+ -->$/, "");

    const result = await harness.driveLastPlanRun({ messageEndPrompt: strippedPrompt });

    expect(result?.runAborted).toBe(true);
    expect(JSON.stringify(result?.finalizedMessage)).toContain("transition cancelled");
    expect(harness.providerRequests).toEqual([]);
    expect(__getGoalForTest()).toMatchObject({ status: "paused", pauseReason: "model_error" });
  });

  test("message_end body or marker replacement restores the prepared paused checkpoint in memory", async () => {
    for (const mode of ["body", "marker"] as const) {
      __resetGoalForTest();
      const goal = pendingGoal();
      const pending = { goalId: goal.id, proposal: proposal() };
      const harness = makeHarness([workEntry(goal, pending)], async () => "确认，开始执行");
      harness.handlers.get("session_start")!({ reason: "startup" }, harness.ctx);
      await handleDgoalCommand("review", harness.pi, harness.ctx);
      const markedPrompt = harness.sent.at(-1)!;
      const transformed = mode === "body"
        ? markedPrompt.replace("Goal Check Plan 已激活", "消息结束阶段改写了正文")
        : markedPrompt.replace(/pi-dgoal-delivery:[0-9a-f-]+/i, "pi-dgoal-delivery:22222222-2222-4222-8222-222222222222");

      const result = await harness.driveLastPlanRun({ messageEndPrompt: transformed });

      expect(result?.runAborted).toBe(true);
      expect(harness.providerRequests).toEqual([]);
      expect(__getGoalForTest()).toMatchObject({ status: "paused", pauseReason: "model_error" });
      expect(__getPendingProposalForTest()).toBeUndefined();
      expect((harness.entries.at(-1)!.data as { goal: GoalState; pendingProposal?: unknown })).toMatchObject({
        goal: { status: "paused", pauseReason: "model_error" },
      });
    }
  });

  test("/dgoal resume verifies in-progress and external side effects before continuing the same Plan", async () => {
    const original = executionGoal();
    const harness = makeHarness([workEntry(original)]);
    harness.handlers.get("session_start")!({ reason: "startup" }, harness.ctx);
    await handleDgoalCommand("resume", harness.pi, harness.ctx);

    expect(__getGoalForTest()).toMatchObject({ id: original.id, status: "paused" });
    await harness.driveLastPlanRun();
    expect(__getGoalForTest()).toMatchObject({ id: original.id, status: "active", contract: { id: original.contract!.id, revision: 4 } });
    expect(harness.sent).toHaveLength(1);
    expect(harness.sent[0]).toContain("这是会话中断后的恢复，不是重新执行");
    expect(harness.sent[0]).toContain("in_progress");
    expect(harness.sent[0]).toContain("不得猜测并重放");
  });

  test("ordinary input cannot resume a model-error Execution Plan while an upgrade proposal awaits review", async () => {
    const paused = executionGoal({
      status: "paused",
      pauseReason: "model_error",
      pauseStartedAt: 25,
    });
    const pending = { goalId: paused.id, proposal: upgradeProposal(paused) };
    const harness = makeHarness([workEntry(paused, pending)]);
    harness.handlers.get("session_start")!({ reason: "reload" }, harness.ctx);

    const result = await harness.driveDirectUserRun("继续处理，但先不要变更计划");

    expect(result.runAborted).toBe(false);
    expect(__getGoalForTest()).toMatchObject({ status: "paused", pauseReason: "model_error" });
    expect(__getPendingProposalForTest()).toEqual(pending);
    expect(harness.entries).toHaveLength(1);
  });

  test("a transformed direct-resume message aborts before a model-error Execution Plan becomes active", async () => {
    const paused = executionGoal({ status: "paused", pauseReason: "model_error", pauseStartedAt: 25 });
    const harness = makeHarness([workEntry(paused)]);
    harness.handlers.get("session_start")!({ reason: "reload" }, harness.ctx);

    const result = await harness.driveDirectUserRun("继续当前实现", "另一个扩展改写了输入");

    expect(result.runAborted).toBe(true);
    expect(JSON.stringify(result.finalizedMessage)).toContain("recovery cancelled");
    expect(harness.providerRequests).toEqual([]);
    expect(__getGoalForTest()).toMatchObject({ status: "paused", pauseReason: "model_error" });
    expect(harness.entries).toHaveLength(1);
  });

  test("a saved upgrade proposal survives the recovery pause and must be reviewed before resume", async () => {
    const original = executionGoal();
    const pending = { goalId: original.id, proposal: upgradeProposal(original) };
    const harness = makeHarness([workEntry(original, pending)], async () => "确认，开始执行");
    harness.handlers.get("session_start")!({ reason: "startup" }, harness.ctx);

    expect(__getGoalForTest()).toMatchObject({ status: "paused", pauseReason: "session_recovery" });
    expect(__getPendingProposalForTest()).toEqual(pending);
    await handleDgoalCommand("resume", harness.pi, harness.ctx);
    expect(harness.sent).toEqual([]);
    expect(harness.notifications.at(-1)).toContain("/dgoal review");

    await handleDgoalCommand("review", harness.pi, harness.ctx);
    await harness.driveLastPlanRun();
    expect(__getGoalForTest()).toMatchObject({
      id: original.id,
      status: "active",
      workList: { revision: 5 },
      contract: { id: original.contract!.id, profile: "goal_check", revision: 5 },
    });
    expect(harness.sent).toHaveLength(1);
    expect(harness.sent[0]).toContain("这是会话中断后的恢复，不是重新执行");
    expect(harness.sent[0]).toContain("不得猜测并重放");

    __resetGoalForTest();
    harness.handlers.get("session_start")!({ reason: "reload" }, harness.ctx);
    expect(__getGoalForTest()).toMatchObject({ status: "active", contract: { profile: "goal_check" } });
  });

  test("rejecting an upgrade keeps the existing Plan and reports only the upgrade rejection", async () => {
    const original = executionGoal();
    const pending = { goalId: original.id, proposal: upgradeProposal(original) };
    const harness = makeHarness([workEntry(original, pending)], async () => "拒绝升级，保留原 Plan");
    harness.handlers.get("session_start")!({ reason: "reload" }, harness.ctx);

    await handleDgoalCommand("review", harness.pi, harness.ctx);

    expect(__getGoalForTest()).toMatchObject({ id: original.id, status: "active", contract: { id: original.contract!.id } });
    expect(__getPendingProposalForTest()).toBeUndefined();
    expect(harness.notifications.at(-1)).toContain("拒绝升级提案");
    expect(harness.notifications.at(-1)).not.toContain("目标放弃");
  });

  test("a legacy v0.8.1 upgrade proposal is hydrated only when branch lineage proves an unchanged base", () => {
    const original = executionGoal();
    const legacyPending = { goalId: original.id, proposal: upgradeProposal(original) };
    const safe = makeHarness([
      legacyWorkEntry(structuredClone(original)),
      legacyWorkEntry(structuredClone(original), structuredClone(legacyPending)),
    ]);
    safe.handlers.get("session_start")!({ reason: "startup" }, safe.ctx);

    expect(__getGoalForTest()).toMatchObject({ status: "paused", pauseReason: "session_recovery" });
    expect(__getPendingProposalForTest()).toMatchObject({
      goalId: original.id,
      baseFingerprint: __fingerprintProposalBaseForTest(original),
    });
    expect((safe.entries.at(-1)!.data as { pendingProposal?: { baseFingerprint?: string } }).pendingProposal?.baseFingerprint)
      .toBe(__fingerprintProposalBaseForTest(original));

    __resetGoalForTest();
    const progressed: GoalState = {
      ...structuredClone(original),
      updatedAt: 99,
      workList: { ...structuredClone(original.workList!), revision: 5 },
      contract: { ...structuredClone(original.contract!), revision: 5 },
    };
    const stale = makeHarness([
      legacyWorkEntry(structuredClone(original)),
      legacyWorkEntry(structuredClone(original), structuredClone(legacyPending)),
      legacyWorkEntry(progressed, structuredClone(legacyPending)),
    ]);
    stale.handlers.get("session_start")!({ reason: "reload" }, stale.ctx);
    expect(__getGoalForTest()).toMatchObject({ workList: { revision: 5 } });
    expect(__getPendingProposalForTest()).toBeUndefined();
  });

  test("legacy hydration rejects a lifecycle whose middle entry changed and later rolled back", () => {
    const original = executionGoal();
    const legacyPending = { goalId: original.id, proposal: upgradeProposal(original) };
    const progressed: GoalState = {
      ...structuredClone(original),
      updatedAt: 90,
      workList: { ...structuredClone(original.workList!), revision: 5 },
      contract: { ...structuredClone(original.contract!), revision: 5 },
    };
    const harness = makeHarness([
      legacyWorkEntry(structuredClone(original)),
      legacyWorkEntry(structuredClone(original), structuredClone(legacyPending)),
      legacyWorkEntry(progressed, structuredClone(legacyPending)),
      legacyWorkEntry(structuredClone(original), structuredClone(legacyPending)),
    ]);

    harness.handlers.get("session_start")!({ reason: "reload" }, harness.ctx);
    expect(__getGoalForTest()).toMatchObject({ id: original.id, workList: { revision: 4 } });
    expect(__getPendingProposalForTest()).toBeUndefined();
  });

  test("a malformed latest state fails closed instead of reviving an older active Plan", () => {
    const original = executionGoal();
    const malformed = { ...structuredClone(original), objective: "" };
    const harness = makeHarness([
      workEntry(original),
      { type: "custom", customType: "dgoal-work-v1", data: { goal: malformed } },
    ]);

    harness.handlers.get("session_start")!({ reason: "reload" }, harness.ctx);

    expect(__getGoalForTest()).toBeUndefined();
    expect(__getPendingProposalForTest()).toBeUndefined();
  });

  test("pausing after deferring an upgrade keeps that proposal reviewable", async () => {
    const original = executionGoal();
    const pending = { goalId: original.id, proposal: upgradeProposal(original) };
    const harness = makeHarness([workEntry(original, pending)], async () => "确认，开始执行");
    harness.handlers.get("session_start")!({ reason: "reload" }, harness.ctx);

    await handleDgoalCommand("pause", harness.pi, harness.ctx);
    expect(__getGoalForTest()).toMatchObject({ status: "paused", pauseReason: "user_abort" });
    expect(__getPendingProposalForTest()).toEqual(pending);

    await handleDgoalCommand("review", harness.pi, harness.ctx);
    await harness.driveLastPlanRun();
    expect(__getPendingProposalForTest()).toBeUndefined();
    expect(__getGoalForTest()).toMatchObject({ status: "active", contract: { profile: "goal_check" }, workList: { revision: 5 } });
  });

  test("progress after a deferred upgrade invalidates the stale proposal instead of rolling Work List state back", async () => {
    const original = executionGoal({
      workList: {
        items: [{ id: 1, subject: "核对副作用", description: "确认中断前是否已经产生外部副作用。", status: "pending" }],
        phases: [], nextItemId: 2, nextPhaseId: 1, revision: 4,
      },
    });
    const pending = { goalId: original.id, proposal: upgradeProposal(original) };
    const harness = makeHarness([workEntry(original, pending)], async () => "确认，开始执行");
    harness.handlers.get("session_start")!({ reason: "reload" }, harness.ctx);

    const updated = await workUpdateTool.execute("call", { target: "item", id: 1, status: "in_progress" }, undefined, undefined, harness.ctx);
    expect(updated.details).toMatchObject({ target: "item", revision: 5 });
    expect(__getPendingProposalForTest()).toBeUndefined();
    expect(__getGoalForTest()).toMatchObject({ workList: { revision: 5, items: [{ id: 1, status: "in_progress" }] } });
    expect(harness.statuses.at(-1)).not.toContain("/dgoal review");

    await handleDgoalCommand("review", harness.pi, harness.ctx);
    expect(harness.getSelectCalls()).toBe(0);
    expect(__getGoalForTest()).toMatchObject({ contract: { profile: "execution" }, workList: { items: [{ id: 1, status: "in_progress" }] } });
  });

  test("a same-revision Contract change also invalidates a deferred upgrade", () => {
    const original = executionGoal();
    const pending = { goalId: original.id, proposal: upgradeProposal(original) };
    const harness = makeHarness([workEntry(original, pending)]);
    harness.handlers.get("session_start")!({ reason: "reload" }, harness.ctx);

    const changed: GoalState = {
      ...original,
      updatedAt: 99,
      contract: { ...original.contract!, auditorCandidates: { goal: { selectedModelId: "provider/model", failedModelIds: ["provider/old"] } } },
    };
    __setGoalForTest(changed);
    persistWorkGoal(changed);

    expect(__getPendingProposalForTest()).toBeUndefined();
    expect((harness.entries.at(-1)!.data as { pendingProposal?: unknown }).pendingProposal).toBeUndefined();
  });

  test("only one review can consume a proposal and a session change invalidates the old dialog", async () => {
    const goal = pendingGoal();
    const pending = { goalId: goal.id, proposal: proposal() };
    let release: ((choice: string | undefined) => void) | undefined;
    const choice = new Promise<string | undefined>((resolve) => { release = resolve; });
    const harness = makeHarness([workEntry(goal, pending)], () => choice);
    harness.handlers.get("session_start")!({ reason: "startup" }, harness.ctx);

    const first = handleDgoalCommand("review", harness.pi, harness.ctx);
    await Promise.resolve();
    await handleDgoalCommand("review", harness.pi, harness.ctx);
    expect(harness.getSelectCalls()).toBe(1);
    expect(harness.notifications.at(-1)).toContain("已经打开");

    harness.entries.push(workEntry(structuredClone(goal), structuredClone(pending)));
    harness.handlers.get("session_tree")!({}, harness.ctx);
    release!("确认，开始执行");
    await first;
    expect(__getGoalForTest()).toMatchObject({ id: goal.id, status: "pending" });
    expect(__getPendingProposalForTest()).toEqual(pending);
    expect(harness.sent).toEqual([]);
  });

  test("a stale proposal dialog cannot open another select or editor after a branch switch", async () => {
    const goal = pendingGoal();
    const pending = { goalId: goal.id, proposal: proposal() };
    let release: ((choice: string | undefined) => void) | undefined;
    const choice = new Promise<string | undefined>((resolve) => { release = resolve; });
    let editorCalls = 0;
    const harness = makeHarness(
      [workEntry(goal, pending)],
      () => choice,
      { editor: async () => { editorCalls += 1; return "stale feedback"; } },
    );
    harness.handlers.get("session_start")!({ reason: "startup" }, harness.ctx);

    const review = handleDgoalCommand("review", harness.pi, harness.ctx);
    await waitFor(() => harness.getSelectCalls() === 1);
    harness.entries.push(workEntry(structuredClone(goal), structuredClone(pending)));
    harness.handlers.get("session_tree")!({}, harness.ctx);
    release!(buildProposalConfirmationOptions(false, pending.proposal)[4]);
    await review;

    expect(harness.getSelectCalls()).toBe(1);
    expect(editorCalls).toBe(0);
    expect(__getPendingProposalForTest()).toBeDefined();
  });

  test("a late replacement confirmation cannot archive or overwrite the newly selected branch", async () => {
    const original = executionGoal({ id: "replace-branch-a" });
    let release: ((confirmed: boolean) => void) | undefined;
    let confirmCalls = 0;
    const confirmation = new Promise<boolean>((resolve) => { release = resolve; });
    const harness = makeHarness(
      [workEntry(original)],
      undefined,
      { confirm: async () => { confirmCalls += 1; return confirmation; } },
    );
    harness.handlers.get("session_start")!({ reason: "reload" }, harness.ctx);
    const replacing = handleDgoalCommand("建立新目标", harness.pi, harness.ctx);
    await waitFor(() => confirmCalls === 1);

    const newer = executionGoal({ id: "replace-branch-b", objective: "新分支已有目标", updatedAt: 99 });
    harness.entries.push(workEntry(newer));
    harness.handlers.get("session_tree")!({}, harness.ctx);
    const entryCount = harness.entries.length;
    release!(true);
    await replacing;

    expect(__getGoalForTest()).toMatchObject({ id: newer.id, objective: newer.objective, updatedAt: 99 });
    expect(__getRuntimeStateForTest().planHistory).toEqual([]);
    expect(harness.entries).toHaveLength(entryCount);
    expect(harness.sent).toEqual([]);
  });

  test("feedback on a recovered upgrade reauthorizes one revised proposal", async () => {
    const original = executionGoal();
    const pending = { goalId: original.id, proposal: upgradeProposal(original) };
    const selections = ["输入反馈意见", "确认，开始执行"];
    const harness = makeHarness(
      [workEntry(original, pending)],
      async () => selections.shift(),
      { editor: async () => "补充恢复流程的回归测试" },
    );
    harness.handlers.get("session_start")!({ reason: "startup" }, harness.ctx);
    await handleDgoalCommand("review", harness.pi, harness.ctx);

    expect(__getGoalForTest()).toMatchObject({ status: "paused", pauseReason: "session_recovery" });
    expect(__getPendingProposalForTest()).toEqual(pending);
    expect(harness.sent.at(-1)).toContain("<dgoal_user_feedback>");
    await harness.driveLastPlanRun();
    expect(__getPendingProposalForTest()).toEqual(pending);
    expect(harness.notifications.at(-1)).toContain("已反馈");

    __setProposalSemanticReviewForTest(() => ({ decision: "approve" }));
    const submitted = await goalPlanTool.execute("call", {
      objective: original.objective,
      description: original.description,
      verification: "bun test test/session-recovery.test.ts",
      acceptanceCriteria: [{ criterion: "恢复流程可回归", evidence: "bun test test/session-recovery.test.ts" }],
      items: [{ id: 1, subject: "核对副作用", description: "确认中断前是否已经产生外部副作用。" }],
      phases: [],
    }, undefined, undefined, harness.ctx);

    expect(submitted.details).toMatchObject({ profile: "goal_check", startMode: "explicit_confirmation" });
    const revised = __getPendingProposalForTest();
    expect(revised).toMatchObject({ goalId: original.id, proposal: { assuranceProfile: "goal_check" } });
    expect(__getGoalForTest()).toMatchObject({ status: "paused", contract: { profile: "execution" } });

    const sameTurnMutation = await workUpdateTool.execute("call", {
      target: "item", id: 1, status: "blocked", blockedReason: "不应写入",
    }, undefined, undefined, harness.ctx);
    expect(sameTurnMutation).toMatchObject({ isError: true, details: { error: "proposal feedback rewrite is read-only" } });
    expect(__getPendingProposalForTest()).toBe(revised);

    await harness.handlers.get("agent_end")!({ messages: [{ role: "assistant", stopReason: "stop" }] }, harness.ctx);
    expect(__getRuntimeStateForTest().proposalFeedbackFlow).toBeDefined();
    expect(harness.getSelectCalls()).toBe(1);
    await harness.handlers.get("agent_settled")!({ type: "agent_settled" }, harness.ctx);
    expect(__getRuntimeStateForTest().proposalFeedbackFlow).toBeUndefined();
    expect(harness.getSelectCalls()).toBe(2);
    expect(harness.sent).toHaveLength(2);
  });

  test("an incomplete feedback rewrite keeps the prior proposal without continuing Plan execution", async () => {
    const original = executionGoal();
    const pending = { goalId: original.id, proposal: upgradeProposal(original) };
    const harness = makeHarness(
      [workEntry(original, pending)],
      async () => "输入反馈意见",
      { editor: async () => "补充重试路径" },
    );
    harness.handlers.get("session_start")!({ reason: "reload" }, harness.ctx);
    await handleDgoalCommand("review", harness.pi, harness.ctx);
    await harness.driveLastPlanRun();

    await harness.handlers.get("agent_end")!({ messages: [{ role: "assistant", stopReason: "error", errorMessage: "retry" }] }, harness.ctx);
    expect(harness.sent).toHaveLength(1);
    expect(__getPendingProposalForTest()).toEqual(pending);
    expect(__getRuntimeStateForTest().proposalFeedbackFlow).toBeDefined();
    const retryMutation = await workUpdateTool.execute("call", {
      target: "item", id: 1, status: "blocked", blockedReason: "auto retry 不应写入",
    }, undefined, undefined, harness.ctx);
    expect(retryMutation).toMatchObject({ isError: true, details: { error: "proposal feedback rewrite is read-only" } });
    await harness.handlers.get("agent_settled")!({ type: "agent_settled" }, harness.ctx);
    expect(__getRuntimeStateForTest().proposalFeedbackFlow).toBeUndefined();
    expect(harness.notifications.at(-1)).toContain("旧计划仍保持待确认");

    const laterMutation = await workUpdateTool.execute("call", {
      target: "item", id: 1, status: "blocked", blockedReason: "反馈流结束后允许推进",
    }, undefined, undefined, harness.ctx);
    expect(laterMutation.details).toMatchObject({ target: "item", revision: 5 });
  });

  test("feedback model errors keep the last durable proposal reviewable without mutating the underlying Plan", async () => {
    const original = executionGoal();
    const pending = { goalId: original.id, proposal: upgradeProposal(original) };
    const harness = makeHarness(
      [workEntry(original, pending)],
      async () => "输入反馈意见",
      { editor: async () => "补充错误恢复" },
    );
    harness.handlers.get("session_start")!({ reason: "reload" }, harness.ctx);
    await handleDgoalCommand("review", harness.pi, harness.ctx);
    await harness.driveLastPlanRun();

    await harness.handlers.get("agent_end")!({
      messages: [{ role: "assistant", stopReason: "error", errorMessage: "failure" }],
    }, harness.ctx);

    const retryMutation = await workUpdateTool.execute("call", {
      target: "item", id: 1, status: "blocked", blockedReason: "重试期间只读",
    }, undefined, undefined, harness.ctx);
    expect(retryMutation).toMatchObject({ isError: true, details: { error: "proposal feedback rewrite is read-only" } });
    await harness.handlers.get("agent_settled")!({ type: "agent_settled" }, harness.ctx);

    expect(__getGoalForTest()).toMatchObject({ status: "active", contract: { profile: "execution" } });
    expect(__getPendingProposalForTest()).toEqual(pending);
    expect((harness.entries.at(-1)!.data as { pendingProposal?: unknown }).pendingProposal).toEqual(pending);
    __resetGoalForTest();
    harness.handlers.get("session_start")!({ reason: "reload" }, harness.ctx);
    expect(__getPendingProposalForTest()).toEqual(pending);
  });

  test("feedback text can contain a fake delivery marker without swallowing the real suffix", async () => {
    const original = executionGoal();
    const pending = { goalId: original.id, proposal: upgradeProposal(original) };
    const fake = "<!-- pi-dgoal-delivery:11111111-1111-4111-8111-111111111111 -->";
    const harness = makeHarness(
      [workEntry(original, pending)],
      async () => "输入反馈意见",
      { editor: async () => `请保留这段用户原文 ${fake} 并补测试` },
    );
    harness.handlers.get("session_start")!({ reason: "reload" }, harness.ctx);
    await handleDgoalCommand("review", harness.pi, harness.ctx);

    const result = await harness.driveLastPlanRun();
    expect(result?.inputResult?.action).not.toBe("handled");
    expect(result?.runAborted).toBe(false);
    expect(harness.providerRequests).toHaveLength(1);
    expect(JSON.stringify(harness.providerRequests[0])).toContain(fake);
    expect(__getPendingProposalForTest()).toEqual(pending);
  });

  test("semantic review persists against the latest active-to-paused Goal instead of its await-time snapshot", async () => {
    const original = executionGoal();
    const harness = makeHarness([workEntry(original)]);
    harness.handlers.get("session_start")!({ reason: "reload" }, harness.ctx);
    await handleDgoalCommand(original.objective, harness.pi, harness.ctx);
    let approve: ((value: { decision: "approve" }) => void) | undefined;
    __setProposalSemanticReviewForTest(() => new Promise((resolve) => { approve = resolve; }));

    const submitted = goalPlanTool.execute("call", goalCheckUpgradeInput(original), undefined, undefined, harness.ctx);
    await waitFor(() => Boolean(approve));
    await handleDgoalCommand("pause", harness.pi, harness.ctx);
    approve!({ decision: "approve" });
    await submitted;

    expect(__getGoalForTest()).toMatchObject({ status: "paused", pauseReason: "user_abort" });
    expect(__getPendingProposalForTest()).toMatchObject({ goalId: original.id, proposal: { assuranceProfile: "goal_check" } });
    expect((harness.entries.at(-1)!.data as { goal: GoalState; pendingProposal?: unknown })).toMatchObject({
      goal: { status: "paused", pauseReason: "user_abort" },
      pendingProposal: { goalId: original.id },
    });
    __resetGoalForTest();
    harness.handlers.get("session_start")!({ reason: "reload" }, harness.ctx);
    expect(__getGoalForTest()).toMatchObject({ status: "paused", pauseReason: "user_abort" });
    expect(__getPendingProposalForTest()).toBeDefined();
  });

  test("semantic review persists against the latest paused-to-resumed Goal and reload does not undo resume", async () => {
    const paused = executionGoal({ status: "paused", pauseReason: "user_abort", pauseStartedAt: 15 });
    const harness = makeHarness([workEntry(paused)]);
    harness.handlers.get("session_start")!({ reason: "reload" }, harness.ctx);
    __setRuntimeStateForTest({ explicitPlanUpgradeGoalId: paused.id });
    let approve: ((value: { decision: "approve" }) => void) | undefined;
    __setProposalSemanticReviewForTest(() => new Promise((resolve) => { approve = resolve; }));

    const submitted = goalPlanTool.execute("call", goalCheckUpgradeInput(paused), undefined, undefined, harness.ctx);
    await waitFor(() => Boolean(approve));
    await handleDgoalCommand("resume", harness.pi, harness.ctx);
    await harness.driveLastPlanRun();
    expect(__getGoalForTest()?.status).toBe("active");
    approve!({ decision: "approve" });
    await submitted;

    expect(__getGoalForTest()).toMatchObject({ status: "active", contract: { profile: "execution" } });
    expect(__getPendingProposalForTest()).toBeDefined();
    expect((harness.entries.at(-1)!.data as { goal: GoalState; pendingProposal?: unknown })).toMatchObject({
      goal: { status: "active" },
      pendingProposal: { goalId: paused.id },
    });
    __resetGoalForTest();
    harness.handlers.get("session_start")!({ reason: "reload" }, harness.ctx);
    expect(__getGoalForTest()?.status).toBe("active");
    expect(__getPendingProposalForTest()).toBeDefined();
  });

  test("a stale branch read still invalidates an in-flight semantic review before it can append", async () => {
    const original = executionGoal();
    const harness = makeHarness([workEntry(original)]);
    harness.handlers.get("session_start")!({ reason: "reload" }, harness.ctx);
    await handleDgoalCommand(original.objective, harness.pi, harness.ctx);
    let approve: ((value: { decision: "approve" }) => void) | undefined;
    __setProposalSemanticReviewForTest(() => new Promise((resolve) => { approve = resolve; }));
    const submitted = goalPlanTool.execute("call", goalCheckUpgradeInput(original), undefined, undefined, harness.ctx);
    await waitFor(() => Boolean(approve));
    const generation = __getRuntimeStateForTest().sessionGeneration;
    const entryCount = harness.entries.length;

    expect(resyncGoalFromSession({
      ...harness.ctx,
      sessionManager: { getBranch: () => { throw new Error("stale after session replacement"); } },
    } as never)).toBe(false);
    expect(__getRuntimeStateForTest().sessionGeneration).toBe(generation + 1);
    approve!({ decision: "approve" });
    const result = await submitted;

    expect(result.details).toMatchObject({ stale: true });
    expect(harness.entries).toHaveLength(entryCount);
    expect(__getPendingProposalForTest()).toBeUndefined();
  });

  test("a failed resync locks every mutation until a later successful branch projection", async () => {
    const original = executionGoal();
    const harness = makeHarness([workEntry(original)]);
    harness.handlers.get("session_start")!({ reason: "reload" }, harness.ctx);
    const entryCount = harness.entries.length;

    expect(resyncGoalFromSession({
      ...harness.ctx,
      sessionManager: { getBranch: () => { throw new Error("stale after session replacement"); } },
    } as never)).toBe(false);
    expect(__getRuntimeStateForTest().sessionProjectionValid).toBe(false);

    await handleDgoalCommand("clear", harness.pi, harness.ctx);
    const update = await workUpdateTool.execute("call", { target: "item", id: 1, status: "done" }, undefined, undefined, harness.ctx);
    expect(update.details).toMatchObject({ error: "session projection unavailable" });
    expect(harness.entries).toHaveLength(entryCount);
    expect(harness.notifications.at(-1)).toContain("暂时锁定");

    await harness.handlers.get("session_tree")!({ type: "session_tree" }, harness.ctx);
    expect(__getRuntimeStateForTest().sessionProjectionValid).toBe(true);
    expect(__getGoalForTest()).toMatchObject({ id: original.id, status: "active" });
  });

  test("session_shutdown invalidates a delayed replacement confirmation", async () => {
    const original = executionGoal({ id: "shutdown-original" });
    let release: ((confirmed: boolean) => void) | undefined;
    let confirmCalls = 0;
    const confirmation = new Promise<boolean>((resolve) => { release = resolve; });
    const harness = makeHarness([workEntry(original)], undefined, {
      confirm: async () => { confirmCalls += 1; return confirmation; },
    });
    harness.handlers.get("session_start")!({ reason: "reload" }, harness.ctx);
    const replacing = handleDgoalCommand("关闭后不得创建", harness.pi, harness.ctx);
    await waitFor(() => confirmCalls === 1);
    const entryCount = harness.entries.length;
    const notificationCount = harness.notifications.length;

    await harness.handlers.get("session_shutdown")!({ type: "session_shutdown" }, harness.ctx);
    release!(true);
    await replacing;

    expect(__getRuntimeStateForTest().sessionProjectionValid).toBe(false);
    expect(harness.entries).toHaveLength(entryCount);
    expect(harness.sent).toEqual([]);
    expect(harness.notifications).toHaveLength(notificationCount);
  });

  test("confirmation persistence failure keeps the original proposal reviewable", async () => {
    const goal = pendingGoal();
    const pending = { goalId: goal.id, proposal: proposal() };
    const harness = makeHarness(
      [workEntry(goal, pending)],
      async () => "确认，开始执行",
      {
        beforeAppend: (_customType, data) => {
          if ((data as { goal?: GoalState }).goal?.contract) throw new Error("session write unavailable");
        },
      },
    );
    harness.handlers.get("session_start")!({ reason: "startup" }, harness.ctx);
    await handleDgoalCommand("review", harness.pi, harness.ctx);
    await harness.driveLastPlanRun();

    expect(__getGoalForTest()).toMatchObject({ id: goal.id, status: "pending" });
    expect(__getPendingProposalForTest()).toEqual(pending);
    expect(harness.sent).toHaveLength(1);
    expect(harness.notifications.at(-1)).toContain("session write unavailable");
  });

  test("a proposal append that pushes before throwing hard-locks the manager and a fresh manager restores the prior durable proposal", async () => {
    const original = executionGoal();
    const pending = { goalId: original.id, proposal: upgradeProposal(original) };
    const durableEntries = [workEntry(original, structuredClone(pending))];
    const durablePending = (durableEntries[0].data as { pendingProposal: typeof pending & { baseFingerprint: string } }).pendingProposal;
    let failedCandidate = false;
    let workAppendCalls = 0;
    const harness = makeHarness([structuredClone(durableEntries[0])], undefined, {
      afterAppend: (_customType, data) => {
        workAppendCalls += 1;
        const candidate = (data as { pendingProposal?: { proposal?: PlanProposal } }).pendingProposal;
        if (!failedCandidate && candidate?.proposal.acceptanceCriteria[0]?.criterion === "恢复流程可回归") {
          failedCandidate = true;
          throw new Error("proposal persist failed after leaf advance");
        }
      },
    });
    harness.handlers.get("session_start")!({ reason: "reload" }, harness.ctx);
    __setRuntimeStateForTest({ explicitPlanUpgradeGoalId: original.id });
    __setProposalSemanticReviewForTest(() => ({ decision: "approve" }));

    const result = await goalPlanTool.execute("call", goalCheckUpgradeInput(original), undefined, undefined, harness.ctx);

    expect(result.details).toMatchObject({ error: "pending proposal persistence failed" });
    expect(__getPendingProposalForTest()).toEqual(durablePending);
    expect(__getRuntimeStateForTest().sessionProjectionValid).toBe(false);
    expect(workAppendCalls).toBe(1);

    // A normal extension reload must not append a compensating child from the uncertain leaf.
    __resetGoalForTest();
    harness.handlers.get("session_start")!({ reason: "reload" }, harness.ctx);
    expect(__getRuntimeStateForTest().sessionProjectionValid).toBe(false);
    expect(workAppendCalls).toBe(1);

    // A genuinely fresh manager reads the last complete on-disk checkpoint.
    __resetGoalForTest();
    const reopened = makeHarness(structuredClone(durableEntries));
    reopened.handlers.get("session_start")!({ reason: "reload" }, reopened.ctx);
    expect(__getPendingProposalForTest()).toEqual(durablePending);
  });

  test("START keeps a paused durable checkpoint until user message_end and fails closed if active persistence fails", async () => {
    const goal = pendingGoal();
    const pending = { goalId: goal.id, proposal: proposal() };
    let aborted = 0;
    let pausedCheckpoint: Entry | undefined;
    let workAppendCalls = 0;
    const harness = makeHarness(
      [workEntry(goal, pending)],
      async () => "确认，开始执行",
      {
        abort: () => { aborted += 1; },
        afterAppend: (customType, data) => {
          if (customType !== "dgoal-work-v1") return;
          workAppendCalls += 1;
          if ((data as { goal?: GoalState }).goal?.status === "paused") {
            pausedCheckpoint = { type: "custom", customType, data: structuredClone(data) };
          }
          if ((data as { goal?: GoalState }).goal?.status === "active") throw new Error("active write unavailable");
        },
      },
    );
    harness.handlers.get("session_start")!({ reason: "startup" }, harness.ctx);
    await handleDgoalCommand("review", harness.pi, harness.ctx);

    expect(__getGoalForTest()?.status).toBe("pending");
    expect(__getPendingProposalForTest()).toEqual(pending);
    const result = await harness.driveLastPlanRun();
    expect(result?.inputResult?.action).not.toBe("handled");
    expect(__getGoalForTest()?.status).toBe("paused");
    expect(aborted).toBe(1);
    expect(__getGoalForTest()).toMatchObject({ status: "paused", pauseReason: "model_error", contract: { profile: "goal_check" } });
    expect(__getPendingProposalForTest()).toBeUndefined();
    expect(__getRuntimeStateForTest().sessionProjectionValid).toBe(false);
    expect(pausedCheckpoint).toBeDefined();
    expect(workAppendCalls).toBe(2);

    __resetGoalForTest();
    harness.handlers.get("session_start")!({ reason: "reload" }, harness.ctx);
    expect(__getRuntimeStateForTest().sessionProjectionValid).toBe(false);
    expect(workAppendCalls).toBe(2);

    __resetGoalForTest();
    const reopened = makeHarness([pausedCheckpoint!]);
    reopened.handlers.get("session_start")!({ reason: "reload" }, reopened.ctx);
    expect(__getGoalForTest()).toMatchObject({ status: "paused", pauseReason: "model_error" });
  });

  test("session_tree aborts a direct model-error resume before or after its message_end commit", async () => {
    for (const switchAfterCommit of [false, true]) {
      __resetGoalForTest();
      const paused = executionGoal({ status: "paused", pauseReason: "model_error", pauseStartedAt: 25 });
      const harness = makeHarness([workEntry(paused)]);
      harness.handlers.get("session_start")!({ reason: "reload" }, harness.ctx);
      const prompt = `继续 ${switchAfterCommit ? "after" : "before"}`;
      await harness.handlers.get("input")!({ source: "interactive", text: prompt }, harness.ctx);
      const before = await harness.handlers.get("before_agent_start")!({
        prompt, systemPrompt: "system", systemPromptOptions: { cwd: "/tmp" },
      }, harness.ctx);
      expect(before?.systemPrompt).toContain(paused.objective);

      let message: unknown = { role: "user", content: [{ type: "text", text: prompt }] };
      if (switchAfterCommit) {
        const result = await harness.handlers.get("message_end")!({ type: "message_end", message }, harness.ctx);
        message = result?.message ?? message;
        expect(__getRuntimeStateForTest().executionPlanUserResumeRun).toMatchObject({ outcome: "accepted" });
      }
      const newer = executionGoal({ id: `direct-new-${switchAfterCommit}`, objective: "新分支目标", updatedAt: 99 });
      harness.entries.push({ ...workEntry(newer), id: `direct-new-leaf-${switchAfterCommit}` });
      await harness.handlers.get("session_tree")!({ type: "session_tree" }, harness.ctx);
      if (!switchAfterCommit) {
        const result = await harness.handlers.get("message_end")!({ type: "message_end", message }, harness.ctx);
        message = result?.message ?? message;
      }

      expect(harness.getAbortCalls()).toBeGreaterThan(0);
      if (!switchAfterCommit) expect(JSON.stringify(message)).toContain("recovery cancelled");
      expect(__getGoalForTest()).toMatchObject({ id: newer.id, status: "active" });
      await harness.handlers.get("agent_end")!({
        messages: [{ role: "assistant", stopReason: "aborted", content: [] }],
      }, harness.ctx);
      expect(__getGoalForTest()).toMatchObject({ id: newer.id, status: "active" });
    }
  });

  test("resume and feedback remain durably safe until user message_end persistence succeeds", async () => {
    const paused = executionGoal({ status: "paused", pauseReason: "session_recovery", pauseStartedAt: 15 });
    let resumeAborts = 0;
    const resumeHarness = makeHarness([workEntry(paused)], undefined, {
      abort: () => { resumeAborts += 1; },
      beforeAppend: (_customType, data) => {
        if ((data as { goal?: GoalState }).goal?.status === "active") throw new Error("resume active write unavailable");
      },
    });
    resumeHarness.handlers.get("session_start")!({ reason: "reload" }, resumeHarness.ctx);
    await handleDgoalCommand("resume", resumeHarness.pi, resumeHarness.ctx);
    expect(__getGoalForTest()?.status).toBe("paused");
    await resumeHarness.driveLastPlanRun();
    expect(resumeAborts).toBe(1);
    expect(__getGoalForTest()).toMatchObject({ status: "paused", pauseReason: "session_recovery" });
    expect((resumeHarness.entries.at(-1)!.data as { goal: GoalState }).goal.status).toBe("paused");

    __resetGoalForTest();
    const active = executionGoal();
    const pending = { goalId: active.id, proposal: upgradeProposal(active) };
    let feedbackAborts = 0;
    const feedbackHarness = makeHarness([workEntry(active, pending)], async () => "输入反馈意见", {
      editor: async () => "补充失败路径",
      abort: () => { feedbackAborts += 1; },
      beforeAppend: (_customType, data) => {
        if ((data as { pendingProposal?: unknown }).pendingProposal === undefined) throw new Error("feedback clear unavailable");
      },
    });
    feedbackHarness.handlers.get("session_start")!({ reason: "reload" }, feedbackHarness.ctx);
    await handleDgoalCommand("review", feedbackHarness.pi, feedbackHarness.ctx);
    expect(__getPendingProposalForTest()).toEqual(pending);
    await feedbackHarness.driveLastPlanRun();
    expect(feedbackAborts).toBe(0);
    expect(__getPendingProposalForTest()).toEqual(pending);
    expect((feedbackHarness.entries.at(-1)!.data as { pendingProposal?: unknown }).pendingProposal).toEqual(pending);
  });

  test("an asynchronously failed START leaves the saved proposal pending when no agent turn starts", async () => {
    const goal = pendingGoal();
    const pending = { goalId: goal.id, proposal: proposal() };
    const harness = makeHarness(
      [workEntry(goal, pending)],
      async () => "确认，开始执行",
      { sendUserMessage: async () => { throw new Error("queue unavailable"); } },
    );
    harness.handlers.get("session_start")!({ reason: "startup" }, harness.ctx);
    await handleDgoalCommand("review", harness.pi, harness.ctx);

    expect(harness.sent).toHaveLength(1);
    expect(__getPendingProposalForTest()).toEqual(pending);
    expect(__getGoalForTest()).toMatchObject({
      id: goal.id,
      status: "pending",
    });
    expect((harness.entries.at(-1)!.data as { goal: GoalState; pendingProposal?: unknown })).toMatchObject({
      goal: { status: "pending" },
      pendingProposal: pending,
    });
  });

  test("an input-observed delivery can be retired and retried without poisoning the next run", async () => {
    const goal = pendingGoal();
    const pending = { goalId: goal.id, proposal: proposal() };
    const harness = makeHarness([workEntry(goal, pending)], async () => "确认，开始执行");
    harness.handlers.get("session_start")!({ reason: "startup" }, harness.ctx);
    await handleDgoalCommand("review", harness.pi, harness.ctx);
    const firstPrompt = harness.sent.at(-1)!;
    const inputResult = await harness.handlers.get("input")!({ source: "extension", text: firstPrompt }, harness.ctx);
    expect(inputResult?.action).not.toBe("handled");

    // Simulate a host model/auth/pre-compaction failure: before_agent_start never arrives.
    await handleDgoalCommand("resume", harness.pi, harness.ctx);
    expect(__getGoalForTest()).toMatchObject({ status: "paused", pauseReason: "model_error" });
    expect(harness.sent).toHaveLength(2);
    const retried = await harness.driveLastPlanRun();
    expect(retried?.runAborted).toBe(false);
    expect(harness.providerRequests).toHaveLength(1);
    expect(__getGoalForTest()?.status).toBe("active");
  });

  test("a late preflight for a cancelled delivery cannot discard its fresh retry", async () => {
    const goal = pendingGoal();
    const pending = { goalId: goal.id, proposal: proposal() };
    const harness = makeHarness([workEntry(goal, pending)], async () => "确认，开始执行");
    harness.handlers.get("session_start")!({ reason: "startup" }, harness.ctx);
    await handleDgoalCommand("review", harness.pi, harness.ctx);
    const oldPrompt = harness.sent.at(-1)!;
    await harness.handlers.get("input")!({ source: "extension", text: oldPrompt }, harness.ctx);

    await handleDgoalCommand("resume", harness.pi, harness.ctx);
    const freshPrompt = harness.sent.at(-1)!;
    await harness.handlers.get("input")!({ source: "extension", text: freshPrompt }, harness.ctx);

    const lateOld = await harness.handlers.get("before_agent_start")!({ prompt: oldPrompt, systemPrompt: "system" }, harness.ctx);
    expect(lateOld).toBeUndefined();
    expect(__getRuntimeStateForTest().pendingPlanDelivery).toMatchObject({ prompt: freshPrompt, phase: "input_observed" });
    await harness.handlers.get("agent_start")?.({ type: "agent_start" }, harness.ctx);
    const oldMessage = { role: "user", content: [{ type: "text", text: oldPrompt }], timestamp: Date.now() };
    const rejected = await harness.handlers.get("message_end")!({ type: "message_end", message: oldMessage }, harness.ctx);
    expect(JSON.stringify(rejected.message)).toContain("transition cancelled");
    await harness.handlers.get("agent_end")!({ messages: [{ role: "assistant", stopReason: "aborted" }] }, harness.ctx);

    const fresh = await harness.handlers.get("before_agent_start")!({ prompt: freshPrompt, systemPrompt: "system" }, harness.ctx);
    expect(fresh?.systemPrompt).toContain("当前 Plan Contract");
    await harness.handlers.get("agent_start")?.({ type: "agent_start" }, harness.ctx);
    const freshMessage = { role: "user", content: [{ type: "text", text: freshPrompt }], timestamp: Date.now() };
    await harness.handlers.get("message_end")!({ type: "message_end", message: freshMessage }, harness.ctx);
    expect(__getGoalForTest()?.status).toBe("active");
  });

  test("cold recovery stays safely paused when persistence fails and is idempotent once persisted", () => {
    const original = executionGoal();
    const failed = makeHarness(
      [workEntry(original)],
      undefined,
      { beforeAppend: () => { throw new Error("append unavailable"); } },
    );
    failed.handlers.get("session_start")!({ reason: "startup" }, failed.ctx);
    expect(__getGoalForTest()).toMatchObject({ status: "paused", pauseReason: "session_recovery" });
    expect(failed.entries).toHaveLength(1);
    expect(failed.sent).toEqual([]);
    expect(failed.notifications.at(-1)).toContain("append unavailable");

    __resetGoalForTest();
    const persisted = makeHarness([workEntry(original)]);
    persisted.handlers.get("session_start")!({ reason: "startup" }, persisted.ctx);
    const firstPause = __getGoalForTest()!.pauseStartedAt;
    const firstEntryCount = persisted.entries.length;
    __resetGoalForTest();
    persisted.handlers.get("session_start")!({ reason: "startup" }, persisted.ctx);
    expect(__getGoalForTest()).toMatchObject({ status: "paused", pauseReason: "session_recovery", pauseStartedAt: firstPause });
    expect(persisted.entries).toHaveLength(firstEntryCount);
  });

  test("explicit pause and clear keep their safe in-memory projection while the same manager remains locked", () => {
    for (const operation of ["pause", "clear"] as const) {
      __resetGoalForTest();
      const original = executionGoal({ id: `safety-${operation}` });
      let appendCalls = 0;
      const harness = makeHarness([workEntry(original)], undefined, {
        beforeAppend: (customType) => {
          if (customType === "dgoal-plan-history-v1") return;
          appendCalls += 1;
          if (customType === "dgoal-work-v1") throw new Error(`${operation} unavailable`);
        },
      });
      harness.handlers.get("session_start")!({ reason: "reload" }, harness.ctx);

      if (operation === "pause") __pauseGoalForTest(harness.ctx);
      else __clearActiveGoalForTest(harness.ctx);

      if (operation === "pause") expect(__getGoalForTest()).toMatchObject({ id: original.id, status: "paused", pauseReason: "user_abort" });
      else expect(__getGoalForTest()).toBeUndefined();
      expect(__getRuntimeStateForTest().durabilityQuarantines).toHaveLength(1);
      expect(__getRuntimeStateForTest().sessionProjectionValid).toBe(false);
      const callsAfterFailure = appendCalls;

      __resetGoalForTest();
      harness.handlers.get("session_start")!({ reason: "reload" }, harness.ctx);
      expect(__getRuntimeStateForTest().sessionProjectionValid).toBe(false);
      expect(appendCalls).toBe(callsAfterFailure);
    }
  });

  test("a pause append that advances the in-memory leaf before throwing is never followed by a repair append", () => {
    const original = executionGoal({ id: "pause-after-push" });
    let appendCalls = 0;
    const harness = makeHarness([workEntry(original)], undefined, {
      afterAppend: (customType) => {
        if (customType === "dgoal-work-v1") {
          appendCalls += 1;
          throw new Error("disk persistence unavailable");
        }
      },
    });
    harness.handlers.get("session_start")!({ reason: "reload" }, harness.ctx);

    __pauseGoalForTest(harness.ctx);
    expect(__getGoalForTest()).toMatchObject({ status: "paused", pauseReason: "user_abort" });
    expect(__getRuntimeStateForTest().durabilityQuarantines).toHaveLength(1);
    expect(__getRuntimeStateForTest().sessionProjectionValid).toBe(false);
    expect(appendCalls).toBe(1);

    __resetGoalForTest();
    harness.handlers.get("session_start")!({ reason: "reload" }, harness.ctx);
    expect(__getRuntimeStateForTest().sessionProjectionValid).toBe(false);
    expect(appendCalls).toBe(1);
  });

  test("a failed direct model-error resume aborts the user run and hard-locks the same manager", async () => {
    const paused = executionGoal({ status: "paused", pauseReason: "model_error", pauseStartedAt: 25 });
    let appendCalls = 0;
    const harness = makeHarness([workEntry(paused)], undefined, {
      beforeAppend: (customType) => {
        if (customType === "dgoal-work-v1") {
          appendCalls += 1;
          throw new Error("resume unavailable");
        }
      },
    });
    harness.handlers.get("session_start")!({ reason: "reload" }, harness.ctx);

    const result = await harness.driveDirectUserRun("继续当前实现");

    expect(result.runAborted).toBe(true);
    expect(JSON.stringify(result.finalizedMessage)).toContain("recovery cancelled");
    expect(harness.providerRequests).toEqual([]);
    expect(__getGoalForTest()).toMatchObject({ status: "paused", pauseReason: "model_error" });
    expect(__getRuntimeStateForTest().durabilityQuarantines).toHaveLength(1);
    expect(__getRuntimeStateForTest().sessionProjectionValid).toBe(false);
    expect(appendCalls).toBe(1);

    __resetGoalForTest();
    harness.handlers.get("session_start")!({ reason: "reload" }, harness.ctx);
    expect(__getRuntimeStateForTest().sessionProjectionValid).toBe(false);
    expect(appendCalls).toBe(1);
  });

  test("a failed cold pause remains quarantined through compact and never auto-continues", async () => {
    const original = executionGoal();
    let appendCalls = 0;
    const harness = makeHarness([workEntry(original)], undefined, {
      beforeAppend: () => {
        appendCalls += 1;
        throw new Error("cold pause unavailable");
      },
    });
    harness.handlers.get("session_start")!({ reason: "startup" }, harness.ctx);
    expect(__getGoalForTest()).toMatchObject({ status: "paused", pauseReason: "session_recovery" });
    expect(__getRuntimeStateForTest().durabilityQuarantine).toBeDefined();

    harness.entries.push({
      id: "compact-child",
      type: "custom",
      customType: "unrelated-compaction-entry",
      data: { compacted: true },
    });

    await harness.handlers.get("session_compact")!({ type: "session_compact", willRetry: false }, harness.ctx);
    expect(__getGoalForTest()).toMatchObject({ status: "paused", pauseReason: "session_recovery" });
    expect(harness.sent).toEqual([]);
    expect(__getRuntimeStateForTest().durabilityQuarantine).toBeDefined();

    await harness.handlers.get("session_compact")!({ type: "session_compact", willRetry: false }, harness.ctx);
    expect(__getGoalForTest()).toMatchObject({ status: "paused", pauseReason: "session_recovery" });
    expect(__getRuntimeStateForTest().sessionProjectionValid).toBe(false);
    expect(__getRuntimeStateForTest().durabilityQuarantine).toBeDefined();
    expect(appendCalls).toBe(1);
    expect(harness.sent).toEqual([]);
  });

  test("a poisoned SessionManager stays locked across tree navigation without appending to either branch", async () => {
    const original = executionGoal();
    let appendCalls = 0;
    const harness = makeHarness([workEntry(original)], undefined, {
      beforeAppend: () => {
        appendCalls += 1;
        throw new Error("branch A pause unavailable");
      },
    });
    harness.handlers.get("session_start")!({ reason: "startup" }, harness.ctx);
    // A real reload round-trips entries through JSON, which omits undefined object fields.
    const branchA = JSON.parse(JSON.stringify(harness.entries)) as Entry[];
    expect(__getRuntimeStateForTest().durabilityQuarantines).toHaveLength(1);

    const branchB = workEntry(executionGoal({ id: "branch-b", objective: "另一个分支" }));
    branchB.id = "branch-b-leaf";
    harness.entries.splice(0, harness.entries.length, branchB);
    harness.handlers.get("session_tree")!({ type: "session_tree" }, harness.ctx);
    expect(__getRuntimeStateForTest().sessionProjectionValid).toBe(false);
    expect(__getRuntimeStateForTest().durabilityQuarantines).toHaveLength(1);
    expect(appendCalls).toBe(1);

    harness.entries.splice(0, harness.entries.length, ...branchA);
    harness.handlers.get("session_tree")!({ type: "session_tree" }, harness.ctx);
    expect(__getGoalForTest()).toMatchObject({ id: original.id, status: "paused", pauseReason: "session_recovery" });
    expect(__getRuntimeStateForTest().sessionProjectionValid).toBe(false);
    expect(harness.sent).toEqual([]);
    expect(__getRuntimeStateForTest().durabilityQuarantines).toHaveLength(1);

    await harness.handlers.get("session_compact")!({ type: "session_compact", willRetry: false }, harness.ctx);
    expect(__getRuntimeStateForTest().durabilityQuarantines).toHaveLength(1);
    expect(__getRuntimeStateForTest().sessionProjectionValid).toBe(false);
    expect(appendCalls).toBe(1);
    expect(harness.sent).toEqual([]);
  });

  test("an exact-leaf failure hard-locks the manager instead of guessing sibling ownership", () => {
    const original = executionGoal({ id: "shared-ancestor-goal" });
    let appendCalls = 0;
    const harness = makeHarness([workEntry(original)], undefined, {
      beforeAppend: (customType) => {
        if (customType === "dgoal-work-v1") {
          appendCalls += 1;
          throw new Error("checkpoint unavailable");
        }
      },
    });
    harness.handlers.get("session_start")!({ reason: "startup" }, harness.ctx);
    const base = structuredClone(harness.entries[0]);
    expect(__getRuntimeStateForTest().durabilityQuarantines).toHaveLength(1);

    const sibling = workEntry(executionGoal({ id: "sibling-goal", objective: "同祖先的另一分支" }));
    sibling.id = "sibling-leaf";
    harness.entries.splice(0, harness.entries.length, base, sibling);
    harness.handlers.get("session_tree")!({ type: "session_tree" }, harness.ctx);

    expect(__getRuntimeStateForTest().sessionProjectionValid).toBe(false);
    expect(__getRuntimeStateForTest().durabilityQuarantines).toHaveLength(1);
    expect(appendCalls).toBe(1);

    harness.entries.splice(0, harness.entries.length, base);
    harness.handlers.get("session_tree")!({ type: "session_tree" }, harness.ctx);
    expect(__getGoalForTest()).toMatchObject({ id: original.id, status: "paused", pauseReason: "session_recovery" });
    expect(__getRuntimeStateForTest().sessionProjectionValid).toBe(false);
    expect(__getRuntimeStateForTest().durabilityQuarantines).toHaveLength(1);
    expect(appendCalls).toBe(1);
  });

  test("continuation fails closed when quarantine ownership is unreadable but ignores a superseded checkpoint", async () => {
    for (const branchMode of ["missing", "non_array", "throw"] as const) {
      __resetGoalForTest();
      const original = executionGoal({ id: `quarantine-continuation-${branchMode}` });
      const harness = makeHarness([workEntry(original)]);
      harness.handlers.get("session_start")!({ reason: "reload" }, harness.ctx);
      const originEntryId = harness.entries[0].id!;
      __setRuntimeStateForTest({
        durabilityQuarantines: [{
          sessionId: "session-recovery-test",
          branchAnchorMode: "contains_entry",
          originEntryId,
          safeGoal: structuredClone(original),
          unsafeGoal: structuredClone(original),
        }],
      });
      const sessionManager = (harness.ctx as unknown as { sessionManager: { getBranch?: () => unknown } }).sessionManager;
      const getBranch = sessionManager.getBranch;
      if (branchMode === "missing") delete sessionManager.getBranch;
      if (branchMode === "non_array") sessionManager.getBranch = () => null;
      if (branchMode === "throw") sessionManager.getBranch = () => { throw new Error("branch unavailable"); };

      await sendContinuation(harness.pi, harness.ctx, original);
      expect(harness.sent).toEqual([]);

      sessionManager.getBranch = getBranch;
    }

    __resetGoalForTest();
    const original = executionGoal({ id: "quarantine-superseded" });
    const harness = makeHarness([workEntry(original)]);
    harness.handlers.get("session_start")!({ reason: "reload" }, harness.ctx);
    __setRuntimeStateForTest({ durabilityQuarantines: [{
      sessionId: "session-recovery-test",
      branchAnchorMode: "contains_entry",
      originEntryId: harness.entries[0].id!,
      safeGoal: structuredClone(original),
      unsafeGoal: structuredClone(original),
    }] });
    const newer = executionGoal({
      id: original.id,
      updatedAt: 50,
      workList: { ...structuredClone(original.workList!), revision: 5 },
      contract: { ...structuredClone(original.contract!), revision: 5 },
    });
    __setGoalForTest(newer);
    await sendContinuation(harness.pi, harness.ctx, newer);
    expect(harness.sent).toHaveLength(1);
  });

  test("a successful commit never releases another session's matching quarantine", async () => {
    const goal = pendingGoal();
    const pending = { goalId: goal.id, proposal: proposal() };
    const harness = makeHarness([workEntry(goal, pending)], async () => "确认，开始执行", { sessionId: "session-b" });
    harness.handlers.get("session_start")!({ reason: "startup" }, harness.ctx);
    await handleDgoalCommand("review", harness.pi, harness.ctx);
    const prompt = harness.sent.at(-1)!;
    await harness.handlers.get("input")!({ source: "extension", text: prompt }, harness.ctx);
    await harness.handlers.get("before_agent_start")!({ prompt, systemPrompt: "system" }, harness.ctx);
    const target = (__getRuntimeStateForTest().pendingPlanDelivery as { targetGoal: GoalState }).targetGoal;
    __setRuntimeStateForTest({
      durabilityQuarantines: [{
        sessionId: "session-a",
        originEntryId: "session-a-origin",
        safeGoal: {
          ...structuredClone(target),
          status: "paused",
          pauseReason: "session_recovery",
          pauseStartedAt: target.updatedAt,
        },
        unsafeGoal: structuredClone(target),
      }],
    });

    await harness.handlers.get("agent_start")?.({ type: "agent_start" }, harness.ctx);
    const message = { role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() };
    await harness.handlers.get("message_end")!({ type: "message_end", message }, harness.ctx);

    expect(__getGoalForTest()?.status).toBe("active");
    expect(__getRuntimeStateForTest().durabilityQuarantines).toHaveLength(1);
    expect(__getRuntimeStateForTest().durabilityQuarantines[0]?.sessionId).toBe("session-a");
  });

  test("a failed resume delivery cannot roll an updated session branch back", async () => {
    const old = executionGoal({ status: "paused", pauseReason: "session_recovery", pauseStartedAt: 15 });
    let rejectSend: ((error: Error) => void) | undefined;
    const sending = new Promise<void>((_resolve, reject) => { rejectSend = reject; });
    const harness = makeHarness([workEntry(old)], undefined, { sendUserMessage: () => sending });
    harness.handlers.get("session_start")!({ reason: "reload" }, harness.ctx);

    const resume = handleDgoalCommand("resume", harness.pi, harness.ctx);
    await Promise.resolve();
    const newer = executionGoal({
      updatedAt: 99,
      workList: { ...structuredClone(old.workList!), revision: 6 },
      contract: {
        ...structuredClone(old.contract!),
        id: "run-newer-branch",
        revision: 6,
        transitions: [{ to: "execution", at: 30, revision: 6 }],
      },
    });
    harness.entries.push(workEntry(newer));
    harness.handlers.get("session_tree")!({}, harness.ctx);
    rejectSend!(new Error("old branch queue failed"));
    await resume;

    expect(__getGoalForTest()).toMatchObject({
      id: newer.id,
      status: "active",
      updatedAt: 99,
      workList: { revision: 6 },
      contract: { id: "run-newer-branch", revision: 6 },
    });
    expect((harness.entries.at(-1)!.data as { goal: GoalState }).goal).toMatchObject({ contract: { id: "run-newer-branch" } });
    expect(harness.notifications.join("\n")).not.toContain("old branch queue failed");
  });

  test("a failed START delivery cannot pause a newer branch with the same Goal ID", async () => {
    const goal = pendingGoal();
    const pending = { goalId: goal.id, proposal: proposal() };
    let rejectSend: ((error: Error) => void) | undefined;
    const sending = new Promise<void>((_resolve, reject) => { rejectSend = reject; });
    const harness = makeHarness(
      [workEntry(goal, pending)],
      async () => "确认，开始执行",
      { sendUserMessage: () => sending },
    );
    harness.handlers.get("session_start")!({ reason: "startup" }, harness.ctx);

    const review = handleDgoalCommand("review", harness.pi, harness.ctx);
    for (let turn = 0; turn < 10 && harness.sent.length === 0; turn += 1) await Promise.resolve();
    expect(harness.sent).toHaveLength(1);
    const newer = executionGoal({
      id: goal.id,
      updatedAt: 99,
      workList: { ...structuredClone(executionGoal().workList!), revision: 6 },
      contract: {
        ...structuredClone(executionGoal().contract!),
        id: "run-newer-after-confirm",
        revision: 6,
        transitions: [{ to: "execution", at: 30, revision: 6 }],
      },
    });
    harness.entries.push(workEntry(newer));
    harness.handlers.get("session_tree")!({}, harness.ctx);
    rejectSend!(new Error("old START queue failed"));
    await review;

    expect(__getGoalForTest()).toMatchObject({
      id: goal.id,
      status: "active",
      updatedAt: 99,
      contract: { id: "run-newer-after-confirm", revision: 6 },
    });
    expect(harness.notifications.join("\n")).not.toContain("old START queue failed");
  });

  test("a failed feedback delivery cannot restore an old proposal into a newer branch", async () => {
    const old = executionGoal();
    const pending = { goalId: old.id, proposal: upgradeProposal(old) };
    let rejectSend: ((error: Error) => void) | undefined;
    const sending = new Promise<void>((_resolve, reject) => { rejectSend = reject; });
    const harness = makeHarness(
      [workEntry(old, pending)],
      async () => "输入反馈意见",
      { editor: async () => "请补测试", sendUserMessage: () => sending },
    );
    harness.handlers.get("session_start")!({ reason: "startup" }, harness.ctx);

    const review = handleDgoalCommand("review", harness.pi, harness.ctx);
    for (let turn = 0; turn < 10 && harness.sent.length === 0; turn += 1) await Promise.resolve();
    expect(harness.sent).toHaveLength(1);
    const newer = executionGoal({
      updatedAt: 99,
      workList: { ...structuredClone(old.workList!), revision: 6 },
      contract: {
        ...structuredClone(old.contract!),
        id: "run-newer-after-feedback",
        revision: 6,
        transitions: [{ to: "execution", at: 30, revision: 6 }],
      },
    });
    harness.entries.push(workEntry(newer));
    harness.handlers.get("session_tree")!({}, harness.ctx);
    rejectSend!(new Error("old feedback queue failed"));
    await review;

    expect(__getGoalForTest()).toMatchObject({ status: "active", updatedAt: 99, contract: { id: "run-newer-after-feedback" } });
    expect(__getPendingProposalForTest()).toBeUndefined();
    expect((harness.entries.at(-1)!.data as { goal: GoalState }).goal).toMatchObject({ contract: { id: "run-newer-after-feedback" } });
    expect(harness.notifications.join("\n")).not.toContain("old feedback queue failed");
  });

  test("an old review cannot release the lock owned by a newer review of the same proposal object", async () => {
    const goal = pendingGoal();
    const pending = { goalId: goal.id, proposal: proposal() };
    let releaseFirst: ((choice: string | undefined) => void) | undefined;
    let releaseSecond: ((choice: string | undefined) => void) | undefined;
    const choices = [
      new Promise<string | undefined>((resolve) => { releaseFirst = resolve; }),
      new Promise<string | undefined>((resolve) => { releaseSecond = resolve; }),
      Promise.resolve(undefined),
    ];
    const harness = makeHarness([workEntry(goal, pending)], () => choices.shift()!);
    harness.handlers.get("session_start")!({ reason: "startup" }, harness.ctx);

    const first = handleDgoalCommand("review", harness.pi, harness.ctx);
    await Promise.resolve();
    harness.handlers.get("session_tree")!({}, harness.ctx);
    const second = handleDgoalCommand("review", harness.pi, harness.ctx);
    await Promise.resolve();
    expect(harness.getSelectCalls()).toBe(2);

    releaseFirst!(undefined);
    await first;
    await handleDgoalCommand("review", harness.pi, harness.ctx);
    expect(harness.getSelectCalls()).toBe(2);
    expect(harness.notifications.at(-1)).toContain("已经打开");

    releaseSecond!(undefined);
    await second;
  });
});
