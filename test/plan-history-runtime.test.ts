import { beforeEach, describe, expect, test } from "bun:test";
import {
  __getGoalForTest,
  __resetGoalForTest,
  archivePlanRun,
  buildPlanHistoryDetailLines,
  buildPlanHistoryListLines,
  executionPlanTool,
  handleDgoalCommand,
  PlanStatusDialog,
  registerDgoal,
  renderPlanLines,
  workReadTool,
  workUpdateTool,
} from "../index.ts";

type Entry = { type: "custom"; customType: string; data: unknown };

function makeHarness() {
  const entries: Entry[] = [];
  const handlers = new Map<string, Function>();
  const notifications: Array<[string, string | undefined]> = [];
  let historyConfirmation = true;
  const ctx = {
    cwd: process.cwd(),
    ui: {
      setStatus: () => {},
      setWidget: () => {},
      notify: (message: string, level?: string) => notifications.push([message, level]),
      getToolsExpanded: () => false,
      onTerminalInput: () => () => {},
      confirm: async () => historyConfirmation,
    },
    sessionManager: { getBranch: () => entries },
    isIdle: () => true,
    hasPendingMessages: () => false,
  } as never;
  const pi = {
    registerTool: () => {},
    registerCommand: () => {},
    on: (name: string, handler: Function) => handlers.set(name, handler),
    events: { emit: () => {} },
    appendEntry: (customType: string, data: unknown) => entries.push({ type: "custom", customType, data }),
    sendUserMessage: () => {},
  } as never;
  registerDgoal(pi);
  return {
    entries,
    handlers,
    notifications,
    ctx,
    pi,
    setHistoryConfirmation(value: boolean) { historyConfirmation = value; },
  };
}

async function execute(tool: { execute: Function }, params: Record<string, unknown>, ctx: unknown) {
  return tool.execute("call", params, undefined, undefined, ctx);
}

function historyRecords(entries: Entry[]) {
  const entry = entries.filter((candidate) => candidate.customType === "dgoal-plan-history-v1").at(-1);
  return ((entry?.data as { records?: unknown[] } | undefined)?.records ?? []) as any[];
}

function mockTheme() {
  return { fg: (_color: string, text: string) => text, bold: (text: string) => text };
}

beforeEach(() => {
  __resetGoalForTest();
});

describe("Plan Run History", () => {
  test("done archive is append-only, report-free, readable after session reload, and clear requires confirmation", async () => {
    const harness = makeHarness();
    await execute(executionPlanTool, {
      objective: "归档已完成计划",
      description: "以完成证据生成只读历史。",
      items: [{
        subject: "交付历史能力",
        description: "完成实现并保存结构化证据。",
        deliverables: [{ target: "test/plan-history-runtime.test.ts", description: "测试通过。" }],
      }],
      phases: [],
    }, harness.ctx);
    await execute(workUpdateTool, { target: "item", id: 1, status: "in_progress" }, harness.ctx);
    await execute(workUpdateTool, {
      target: "item",
      id: 1,
      status: "done",
      evidence: "bun test passed",
      deliverableEvidence: [{ target: "test/plan-history-runtime.test.ts", evidence: "6 tests passed" }],
    }, harness.ctx);
    const done = await execute(workUpdateTool, {
      target: "goal",
      status: "done",
      summary: "历史能力完成",
      verification: "bun test test/plan-history-runtime.test.ts",
      whatChanged: ["新增 append-only history"],
      userReview: "可在 /dgoal s 的 History tab 查看",
    }, harness.ctx);

    expect(done.details).toMatchObject({ status: "done", profile: "execution" });
    expect(__getGoalForTest()).toBeUndefined();
    const records = historyRecords(harness.entries);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      terminalReason: "done",
      summary: "历史能力完成",
      verification: "bun test test/plan-history-runtime.test.ts",
      contract: { profile: "execution" },
    });
    const serialized = JSON.stringify(records[0]);
    expect(serialized).not.toContain('"report"');
    expect(serialized).not.toContain('"feedback"');
    expect(serialized).not.toContain('"auditHistory"');
    expect(serialized).toContain("bun test passed");

    __resetGoalForTest();
    harness.handlers.get("session_start")?.({ reason: "reload" }, harness.ctx);
    const reloaded = await execute(workReadTool, { target: "history" }, harness.ctx);
    expect(reloaded.details).toMatchObject({ target: "history", count: 1 });
    expect(reloaded.content[0].text).toContain("归档已完成计划");

    harness.setHistoryConfirmation(false);
    await handleDgoalCommand("history clear", harness.pi, harness.ctx);
    expect((await execute(workReadTool, { target: "history" }, harness.ctx)).details.count).toBe(1);

    harness.setHistoryConfirmation(true);
    await handleDgoalCommand("history clear", harness.pi, harness.ctx);
    expect((await execute(workReadTool, { target: "history" }, harness.ctx)).details.count).toBe(0);
    expect(historyRecords(harness.entries)).toEqual([]);
  });

  test("superseded and cleared plans archive once in session order", async () => {
    const harness = makeHarness();
    await execute(executionPlanTool, {
      objective: "旧执行目标",
      description: "会被新目标显式替换。",
      items: [{ subject: "旧工作", description: "只用于验证 superseded。" }],
      phases: [],
    }, harness.ctx);
    const first = __getGoalForTest()!;
    archivePlanRun(first, "superseded");
    archivePlanRun(first, "superseded");
    expect(historyRecords(harness.entries)).toHaveLength(1);

    await execute(executionPlanTool, {
      objective: "新执行目标",
      description: "替换后成为唯一 active Plan Run。",
      items: [{ subject: "新工作", description: "只用于验证 cleared。" }],
      phases: [],
    }, harness.ctx);
    expect(historyRecords(harness.entries)).toHaveLength(1);
    await handleDgoalCommand("clear", harness.pi, harness.ctx);

    const records = historyRecords(harness.entries);
    expect(records).toHaveLength(2);
    expect(records.map((record) => [record.objective, record.terminalReason])).toEqual([
      ["旧执行目标", "superseded"],
      ["新执行目标", "cleared"],
    ]);
    expect(new Set(records.map((record) => record.id)).size).toBe(2);
  });

  test("loader rejects history containing feedback, auditor report, or audit transcript fields", async () => {
    const harness = makeHarness();
    await execute(executionPlanTool, {
      objective: "生成合法历史",
      description: "随后注入禁止持久化字段。",
      items: [{ subject: "待清理", description: "用于生成 cleared 记录。" }],
      phases: [],
    }, harness.ctx);
    await handleDgoalCommand("clear", harness.pi, harness.ctx);
    const invalid = structuredClone(historyRecords(harness.entries)[0]);
    invalid.contract.auditHistory = [{ raw: "hidden transcript" }];
    invalid.contract.goalCheck = { status: "rejected", revision: 0, report: "raw auditor report" };
    invalid.workList.phases = [{
      id: 1,
      subject: "非法 Phase",
      description: "含禁止反馈。",
      status: "pending",
      items: [],
      feedback: { report: "raw feedback" },
    }];
    harness.entries.push({ type: "custom", customType: "dgoal-plan-history-v1", data: { records: [invalid] } });

    __resetGoalForTest();
    harness.handlers.get("session_start")?.({ reason: "reload" }, harness.ctx);
    const read = await execute(workReadTool, { target: "history" }, harness.ctx);
    expect(read.details).toMatchObject({ target: "history", count: 0 });
  });

  test("history builders and unified modal expose Current/History without resume actions", async () => {
    const harness = makeHarness();
    await execute(executionPlanTool, {
      objective: "统一状态视图",
      description: "Current 与 History 共用一个 modal。",
      items: [{ subject: "展示 Work Item", description: "详情页显示完整说明。" }],
      phases: [],
    }, harness.ctx);
    archivePlanRun(__getGoalForTest()!, "superseded");
    const records = historyRecords(harness.entries);

    expect(buildPlanHistoryListLines(records as any)[0]).toMatchObject({ type: "history", target: { kind: "history" } });
    expect(buildPlanHistoryDetailLines(records[0] as any).join("\n")).toContain("Plan Run：");
    expect(buildPlanHistoryDetailLines(records[0] as any).join("\n").toLowerCase()).not.toContain("resume");
    expect(renderPlanLines(__getGoalForTest(), { expandTasks: true }, 100).join("\n")).toContain("展示 Work Item");

    const dialog = new PlanStatusDialog(__getGoalForTest(), mockTheme() as any, () => {});
    const current = dialog.render(100).join("\n");
    expect(current).toContain("Current");
    expect(current).toContain("展示 Work Item");
    dialog.handleInput("\r");
    expect(dialog.render(100).join("\n")).toContain("详情页显示完整说明");
    dialog.handleInput("\u001b");
    dialog.handleInput("\t");
    const history = dialog.render(100).join("\n");
    expect(history).toContain("History 1");
    expect(history).toContain("统一状态视图");
    dialog.handleInput("\r");
    const detail = dialog.render(100).join("\n");
    expect(detail).toContain("Plan Run：");
    expect(detail.toLowerCase()).not.toContain("resume");
  });
});
