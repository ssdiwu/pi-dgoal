// ADR 0051：真实注册事件链下的 Execution Plan 活性熔断与恢复。
import { beforeEach, describe, expect, test } from "bun:test";

import dgoal, {
  __clearActiveGoalForTest,
  __getGoalForTest,
  __getRuntimeStateForTest,
  __resetGoalForTest,
  __setGoalForTest,
  __setRuntimeStateForTest,
  __startGoalForTest,
  type DgoalContext,
  type ExtensionAPI,
  type GoalState,
} from "../index.ts";

function activeExecutionGoal(): GoalState {
  return {
    id: "g-no-progress",
    objective: "测无进展熔断",
    description: "验证自动续跑的双层活性保护。",
    status: "active",
    startedAt: 1,
    updatedAt: 1,
    iteration: 0,
    workList: {
      items: [{ id: 1, subject: "任务一", description: "推进实际工作。", status: "in_progress" }],
      phases: [],
      nextItemId: 2,
      nextPhaseId: 1,
      revision: 1,
    },
    contract: { id: "run-no-progress", profile: "execution", startedAt: 1, revision: 1, transitions: [{ to: "execution", at: 1, revision: 1 }] },
  };
}

function pausedExecutionGoal(): GoalState {
  return {
    ...activeExecutionGoal(),
    status: "paused",
    pauseReason: "model_error",
    pauseStartedAt: 2,
    pausedTotalMs: 10,
    workList: {
      items: [{ id: 1, subject: "任务一", description: "保留已完成事实。", status: "done", evidence: "保留证据" }],
      phases: [],
      nextItemId: 2,
      nextPhaseId: 1,
      revision: 7,
    },
    contract: { ...activeExecutionGoal().contract!, revision: 7 },
  };
}

function captureHandlers() {
  const handlers: Record<string, (event: unknown, ctx?: unknown) => unknown> = {};
  const pi = {
    registerTool: () => {},
    registerCommand: () => {},
    on: (event: string, handler: (event: unknown, ctx?: unknown) => unknown) => { handlers[event] = handler; },
    events: { emit: () => {} },
    sendUserMessage: () => {},
    appendEntry: () => {},
  } as unknown as ExtensionAPI;
  dgoal(pi);
  return { pi, handlers };
}

const { pi: mockPi, handlers } = captureHandlers();

function mockCtx(): DgoalContext {
  return {
    ui: { setStatus: () => {}, setWidget: () => {}, notify: () => {}, custom: () => {} },
    cwd: "/tmp",
    isIdle: () => true,
    hasPendingMessages: () => false,
    sessionManager: { getBranch: () => [] },
  } as unknown as DgoalContext;
}

async function runTurn(opts: { toolName?: string; toolError?: boolean; stopReason?: string } = {}, ctx = mockCtx()) {
  await handlers["before_agent_start"]({ prompt: "", systemPrompt: "" }, ctx);
  if (opts.toolName) {
    const args = opts.toolName === "read" || opts.toolName === "write" ? { path: "README.md" } : {};
    handlers["tool_execution_start"]({ toolCallId: "c1", toolName: opts.toolName, args }, ctx);
    handlers["tool_execution_end"]({ toolCallId: "c1", toolName: opts.toolName, args, result: { content: [], details: {} }, isError: Boolean(opts.toolError) }, ctx);
  }
  await handlers["agent_end"]({ messages: [{ role: "assistant", stopReason: opts.stopReason ?? "stop", content: [] }] }, ctx);
}

describe("Execution Plan liveness integration", () => {
  beforeEach(__resetGoalForTest);

  test("only a real non-streaming user directive grants one-shot /dgoal authorization", async () => {
    handlers["input"]({ source: "extension", text: "请用 dgoal 完成任务" });
    expect(__getRuntimeStateForTest().naturalLanguageStartAuthorized).toBe(false);
    handlers["input"]({ source: "interactive", streamingBehavior: "followUp", text: "请用 dgoal 完成任务" });
    expect(__getRuntimeStateForTest().naturalLanguageStartAuthorized).toBe(false);
    handlers["input"]({ source: "interactive", text: "请用 dgoal 完成任务" });
    expect(__getRuntimeStateForTest().naturalLanguageStartAuthorized).toBe(true);
    const guided = await handlers["before_agent_start"]({ prompt: "请用 dgoal 完成任务", systemPrompt: "base" }, mockCtx()) as { systemPrompt?: string };
    expect(guided.systemPrompt).toContain("<dgoal_natural_language_start>");
    handlers["input"]({ source: "interactive", text: "dgoal 是什么？" });
    expect(__getRuntimeStateForTest().naturalLanguageStartAuthorized).toBe(false);
  });

  test("three consecutive no-tool turns trigger the hard no_progress fuse", async () => {
    __setGoalForTest(activeExecutionGoal());
    await runTurn();
    await runTurn();
    expect(__getGoalForTest()?.status).toBe("active");
    await runTurn();
    expect(__getGoalForTest()).toMatchObject({ status: "paused", pauseReason: "no_progress" });
    expect(__getRuntimeStateForTest().consecutiveNoProgressTurns).toBe(3);
  });

  test("read-only activity cannot mask eight turns without durable progress", async () => {
    __setGoalForTest(activeExecutionGoal());
    for (let i = 0; i < 7; i += 1) await runTurn({ toolName: "read" });
    expect(__getGoalForTest()?.status).toBe("active");
    await runTurn({ toolName: "read" });
    expect(__getGoalForTest()).toMatchObject({ status: "paused", pauseReason: "no_progress" });
    expect(__getRuntimeStateForTest().consecutiveNoDurableProgressTurns).toBe(8);
  });

  test("a successful write resets both liveness streaks", async () => {
    __setGoalForTest(activeExecutionGoal());
    await runTurn({ toolName: "read" });
    await runTurn({ toolName: "read" });
    await runTurn({ toolName: "write" });
    expect(__getRuntimeStateForTest().consecutiveNoProgressTurns).toBe(0);
    expect(__getRuntimeStateForTest().consecutiveNoDurableProgressTurns).toBe(0);
    expect(__getGoalForTest()?.status).toBe("active");
  });

  test("the fifth consecutive model error pauses the Execution Plan", async () => {
    const goal = activeExecutionGoal();
    __setGoalForTest(goal);
    for (let i = 0; i < 4; i += 1) await handlers["agent_end"]({ messages: [{ role: "assistant", stopReason: "error", content: [] }] }, mockCtx());
    expect(__getGoalForTest()?.status).toBe("active");
    await handlers["agent_end"]({ messages: [{ role: "assistant", stopReason: "error", content: [] }] }, mockCtx());
    expect(__getGoalForTest()).toMatchObject({ status: "paused", pauseReason: "model_error" });
  });

  test("the next exact real user input resumes the same Execution Plan once", async () => {
    const paused = pausedExecutionGoal();
    __setGoalForTest(paused);
    __setRuntimeStateForTest({ consecutiveErrors: 4, consecutiveNoProgressTurns: 2, consecutiveNoDurableProgressTurns: 7 });
    handlers["input"]({ source: "extension", text: "继续" });
    await handlers["before_agent_start"]({ prompt: "继续", systemPrompt: "base" }, mockCtx());
    expect(__getGoalForTest()?.status).toBe("paused");

    handlers["input"]({ source: "interactive", text: "继续当前任务" });
    expect(__getRuntimeStateForTest().executionPlanModelErrorRecovery).toEqual({ goalId: paused.id, input: "继续当前任务" });
    const guided = await handlers["before_agent_start"]({ prompt: "继续当前任务", systemPrompt: "base" }, mockCtx()) as { systemPrompt?: string };
    expect(__getGoalForTest()).toMatchObject({ id: paused.id, status: "active", workList: { revision: 7, items: [{ evidence: "保留证据" }] } });
    expect(__getRuntimeStateForTest()).toMatchObject({ executionPlanModelErrorRecovery: undefined, consecutiveErrors: 0, consecutiveNoProgressTurns: 0, consecutiveNoDurableProgressTurns: 0 });
    expect(guided.systemPrompt).toContain("当前 Plan Contract：execution");
  });

  test("a higher assurance model_error pause is never auto-resumed", async () => {
    const paused = pausedExecutionGoal();
    __setGoalForTest({ ...paused, contract: { ...paused.contract!, profile: "goal_check", transitions: [{ to: "goal_check", at: 1, revision: 7 }] } });
    handlers["input"]({ source: "interactive", text: "继续" });
    await handlers["before_agent_start"]({ prompt: "继续", systemPrompt: "base" }, mockCtx());
    expect(__getGoalForTest()).toMatchObject({ status: "paused", pauseReason: "model_error", contract: { profile: "goal_check" } });
    expect(__getRuntimeStateForTest().executionPlanModelErrorRecovery).toBeUndefined();
  });

  test("clear and start reset liveness counters", async () => {
    __setGoalForTest(activeExecutionGoal());
    __setRuntimeStateForTest({ consecutiveNoProgressTurns: 2, consecutiveNoDurableProgressTurns: 7 });
    __clearActiveGoalForTest(mockCtx());
    expect(__getRuntimeStateForTest()).toMatchObject({ consecutiveNoProgressTurns: 0, consecutiveNoDurableProgressTurns: 0 });

    __setRuntimeStateForTest({ consecutiveNoProgressTurns: 2, consecutiveNoDurableProgressTurns: 7 });
    await __startGoalForTest("新目标", mockPi, { ...mockCtx(), isIdle: () => true } as DgoalContext);
    expect(__getRuntimeStateForTest()).toMatchObject({ consecutiveNoProgressTurns: 0, consecutiveNoDurableProgressTurns: 0 });
  });
});
