import { beforeEach, describe, expect, test } from "bun:test";
import {
  __getGoalForTest,
  __getRuntimeStateForTest,
  __resetGoalForTest,
  __setApiForTest,
  executionPlanTool,
  loadGoal,
  registerDgoal,
  workListTool,
  workUpdateTool,
  WORK_STATE_ENTRY_TYPE,
} from "../index.ts";

type Entry = { type: "custom"; customType: string; data: unknown };

function makeHarness() {
  const entries: Entry[] = [];
  const sent: string[] = [];
  const handlers = new Map<string, Function>();
  const ctx = {
    cwd: process.cwd(),
    ui: {
      setStatus: () => {}, setWidget: () => {}, notify: () => {},
      getToolsExpanded: () => false, onTerminalInput: () => () => {},
    },
    sessionManager: { getBranch: () => entries },
    isIdle: () => true,
    hasPendingMessages: () => false,
  } as never;
  const pi = {
    registerTool: () => {}, registerCommand: () => {},
    on: (name: string, handler: Function) => handlers.set(name, handler),
    events: { emit: () => {} },
    appendEntry: (customType: string, data: unknown) => entries.push({ type: "custom", customType, data }),
    sendUserMessage: (message: string) => { sent.push(message); },
  } as never;
  registerDgoal(pi);
  return { entries, sent, handlers, ctx };
}

async function execute(tool: { execute: Function }, params: Record<string, unknown>, ctx: unknown) {
  return tool.execute("call", params, undefined, undefined, ctx);
}

async function settleTurn(harness: ReturnType<typeof makeHarness>, stopReason: string, prompt = "继续") {
  await harness.handlers.get("before_agent_start")!({ prompt, systemPrompt: "system" }, harness.ctx);
  await harness.handlers.get("agent_end")!({ messages: [{ role: "assistant", stopReason }] }, harness.ctx);
}

beforeEach(() => {
  __resetGoalForTest();
  __setApiForTest(undefined);
});

describe("Execution Plan runtime", () => {
  test("direct flat Execution Plan has no hidden Phase and closes with planned evidence", async () => {
    const harness = makeHarness();
    const created = await execute(executionPlanTool, {
      objective: "完成交付",
      description: "持续推进直到有可复验结果。",
      items: [{
        subject: "生成文件",
        description: "生成并验证交付文件。",
        deliverables: [{ target: "out.txt", description: "内容正确" }],
      }],
      phases: [],
    }, harness.ctx);
    expect(created.details).toMatchObject({ profile: "execution", itemCount: 1, phaseCount: 0, revision: 0 });
    const goal = __getGoalForTest()!;
    expect(goal.plan).toBeUndefined();
    expect(goal.workList?.phases).toEqual([]);
    expect(goal.contract?.profile).toBe("execution");

    await execute(workUpdateTool, { target: "item", id: 1, status: "in_progress" }, harness.ctx);
    const missingEvidence = await execute(workUpdateTool, { target: "item", id: 1, status: "done" }, harness.ctx);
    expect(missingEvidence.details.error).toContain("evidence");
    const missingDeliverableEvidence = await execute(workUpdateTool, {
      target: "item", id: 1, status: "done", evidence: "read out.txt",
    }, harness.ctx);
    expect(missingDeliverableEvidence.details.error).toContain("every declared deliverable");
    await execute(workUpdateTool, {
      target: "item", id: 1, status: "done", evidence: "read out.txt",
      deliverableEvidence: [{ target: "out.txt", evidence: "内容匹配" }],
    }, harness.ctx);
    const incompleteReview = await execute(workUpdateTool, { target: "goal", status: "done" }, harness.ctx);
    expect(incompleteReview.details.error).toBe("completion review required");
    const done = await execute(workUpdateTool, {
      target: "goal", status: "done", summary: "已生成文件", verification: "读取内容通过",
    }, harness.ctx);
    expect(done.details).toMatchObject({ status: "done", profile: "execution", archived: true });
    expect(done.content[0].text).toContain("dgoal 完成信号");
    expect(done.content[0].text).toContain("直接回复用户");
    expect(done.terminate).toBeUndefined();
    expect((harness.entries.at(-1)?.data as { goal?: unknown }).goal).toBeNull();
    expect(__getGoalForTest()).toBeUndefined();
  });

  test("soft Work List upgrades atomically in the same Goal and Plan Run starts once", async () => {
    const harness = makeHarness();
    await execute(workListTool, {
      objective: "同一目标",
      description: "先轻量跟踪。",
      items: [{ subject: "模糊候选" }],
      phases: [],
    }, harness.ctx);
    const before = __getGoalForTest()!;
    const result = await execute(executionPlanTool, {
      objective: "同一目标",
      description: "证据确认后持续完成。",
      items: [{ subject: "可执行项", description: "执行并提供证据。" }],
      phases: [],
    }, harness.ctx);
    const after = __getGoalForTest()!;
    expect(result.content[0].text).toContain("已升级");
    expect(after.id).toBe(before.id);
    expect(after.startedAt).toBe(before.startedAt);
    expect(after.contract?.transitions).toEqual([{
      to: "execution", at: after.contract?.startedAt, revision: 1,
    }]);
    expect(after.workList?.revision).toBe(1);
  });


  test("invalid Execution replacement does not archive the still-active Plan Run", async () => {
    const harness = makeHarness();
    await execute(executionPlanTool, {
      objective: "保留旧执行计划",
      description: "新输入无效时旧计划仍然有效。",
      items: [{ subject: "旧工作", description: "继续执行旧工作。" }],
      phases: [],
    }, harness.ctx);
    const before = structuredClone(__getGoalForTest()!);

    const rejected = await execute(executionPlanTool, {
      objective: "无效的新目标",
      description: "缺少任何 Work Item，应在产生归档前被拒绝。",
      items: [],
      phases: [],
    }, harness.ctx);

    expect(rejected.details.error).toBe("invalid execution plan");
    expect(__getGoalForTest()).toEqual(before);
    expect(__getRuntimeStateForTest().planHistory).toEqual([]);
    expect(harness.entries.some((entry) => entry.customType === "dgoal-plan-history-v1")).toBe(false);
  });
  test("Execution Plan persists and restores from dgoal-work-v1", async () => {
    const harness = makeHarness();
    await execute(executionPlanTool, {
      objective: "恢复执行",
      description: "结构状态跨会话恢复。",
      items: [{ subject: "继续项", description: "恢复后继续。" }],
      phases: [],
    }, harness.ctx);
    expect(harness.entries.at(-1)?.customType).toBe(WORK_STATE_ENTRY_TYPE);
    __resetGoalForTest();
    const restored = loadGoal(harness.ctx as never);
    expect(restored?.contract?.profile).toBe("execution");
    expect(restored?.workList?.items[0].subject).toBe("继续项");
  });

  test("normal agent end schedules continuation for Execution Plan", async () => {
    const harness = makeHarness();
    await execute(executionPlanTool, {
      objective: "持续执行",
      description: "直到显式完成。",
      items: [{ subject: "推进", description: "执行实际动作。" }],
      phases: [],
    }, harness.ctx);
    await settleTurn(harness, "stop", "用户任务");
    expect(harness.sent).toHaveLength(1);
    expect(harness.sent[0]).toContain("Execution Plan");
    expect(harness.sent[0]).toContain("work_update");
  });

  test("three no-tool turns pause Execution Plan through the existing hard fuse", async () => {
    const harness = makeHarness();
    await execute(executionPlanTool, {
      objective: "检测空转",
      description: "空转必须熔断。",
      items: [{ subject: "执行", description: "需要真实工具动作。" }],
      phases: [],
    }, harness.ctx);
    let prompt = "用户任务";
    for (let index = 0; index < 3; index += 1) {
      await settleTurn(harness, "stop", prompt);
      prompt = harness.sent.at(-1) ?? prompt;
    }
    expect(__getGoalForTest()).toMatchObject({ status: "paused", pauseReason: "no_progress" });
    expect(__getRuntimeStateForTest()).toMatchObject({ consecutiveNoProgressTurns: 3 });
    const planRunId = __getGoalForTest()?.contract?.id;
    const recovered = await execute(executionPlanTool, {
      objective: "检测空转",
      description: "按新证据重组后继续。",
      items: [{ subject: "改走有效路径", description: "直接执行可持久推进的动作。" }],
      phases: [],
    }, harness.ctx);
    expect(recovered.content[0].text).toContain("已重组");
    expect(__getGoalForTest()).toMatchObject({ status: "active" });
    expect(__getGoalForTest()?.contract?.id).toBe(planRunId);
    expect(__getRuntimeStateForTest()).toMatchObject({ consecutiveNoProgressTurns: 0, consecutiveNoDurableProgressTurns: 0 });
  });

  test("eight activity-only turns pause, while a successful write resets the soft fuse", async () => {
    const harness = makeHarness();
    await execute(executionPlanTool, {
      objective: "检测活动空转",
      description: "只读不能无限掩盖无持久进展。",
      items: [{ subject: "实现", description: "需要真实写入。" }],
      phases: [],
    }, harness.ctx);
    let prompt = "用户任务";
    for (let index = 0; index < 4; index += 1) {
      await harness.handlers.get("before_agent_start")!({ prompt, systemPrompt: "system" }, harness.ctx);
      harness.handlers.get("tool_execution_start")!({ toolCallId: `read-${index}`, toolName: "read", args: { path: "README.md" } }, harness.ctx);
      harness.handlers.get("tool_execution_end")!({ toolCallId: `read-${index}`, toolName: "read", isError: false, result: {} });
      await harness.handlers.get("agent_end")!({ messages: [{ role: "assistant", stopReason: "stop" }] }, harness.ctx);
      prompt = harness.sent.at(-1) ?? prompt;
    }
    expect(__getRuntimeStateForTest().consecutiveNoDurableProgressTurns).toBe(4);

    await harness.handlers.get("before_agent_start")!({ prompt, systemPrompt: "system" }, harness.ctx);
    harness.handlers.get("tool_execution_start")!({ toolCallId: "write-1", toolName: "write", args: { path: "tmp.txt" } }, harness.ctx);
    harness.handlers.get("tool_execution_end")!({ toolCallId: "write-1", toolName: "write", isError: false, result: {} });
    await harness.handlers.get("agent_end")!({ messages: [{ role: "assistant", stopReason: "stop" }] }, harness.ctx);
    expect(__getRuntimeStateForTest().consecutiveNoDurableProgressTurns).toBe(0);
    prompt = harness.sent.at(-1) ?? prompt;

    for (let index = 0; index < 8; index += 1) {
      await harness.handlers.get("before_agent_start")!({ prompt, systemPrompt: "system" }, harness.ctx);
      harness.handlers.get("tool_execution_start")!({ toolCallId: `later-${index}`, toolName: "read", args: { path: "README.md" } }, harness.ctx);
      harness.handlers.get("tool_execution_end")!({ toolCallId: `later-${index}`, toolName: "read", isError: false, result: {} });
      await harness.handlers.get("agent_end")!({ messages: [{ role: "assistant", stopReason: "stop" }] }, harness.ctx);
      prompt = harness.sent.at(-1) ?? prompt;
    }
    expect(__getGoalForTest()).toMatchObject({ status: "paused", pauseReason: "no_progress" });
    expect(__getRuntimeStateForTest().consecutiveNoDurableProgressTurns).toBe(8);
  });

  test("model_error recovery is bound to the next real user input for Execution Plan", async () => {
    const harness = makeHarness();
    await execute(executionPlanTool, {
      objective: "错误恢复",
      description: "瞬时错误重试后保留计划。",
      items: [{ subject: "继续", description: "恢复后继续。" }],
      phases: [],
    }, harness.ctx);
    let prompt = "用户任务";
    for (let index = 0; index < 5; index += 1) {
      await settleTurn(harness, "error", prompt);
      prompt = harness.sent.at(-1) ?? prompt;
    }
    expect(__getGoalForTest()).toMatchObject({ status: "paused", pauseReason: "model_error" });
    const input = harness.handlers.get("input")!;
    input({ source: "interactive", text: "继续处理", streamingBehavior: undefined });
    await harness.handlers.get("before_agent_start")!({ prompt: "继续处理", systemPrompt: "system" }, harness.ctx);
    expect(__getGoalForTest()).toMatchObject({ status: "active" });
    expect(__getGoalForTest()?.contract?.profile).toBe("execution");
  });
});
