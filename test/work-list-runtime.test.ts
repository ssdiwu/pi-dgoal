import { beforeEach, describe, expect, test } from "bun:test";
import {
  __getGoalForTest,
  __resetGoalForTest,
  __setApiForTest,
  __setGoalForTest,
  loadGoal,
  registerDgoal,
  workCreateTool,
  workListTool,
  workReadTool,
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
      setStatus: () => {},
      setWidget: () => {},
      notify: () => {},
      getToolsExpanded: () => false,
      onTerminalInput: () => () => {},
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
    sendUserMessage: (message: string) => { sent.push(message); },
  } as never;
  registerDgoal(pi);
  return { entries, sent, handlers, ctx, pi };
}

async function execute(tool: { execute: Function }, params: Record<string, unknown>, ctx: unknown) {
  return tool.execute("call", params, undefined, undefined, ctx);
}

beforeEach(() => {
  __resetGoalForTest();
  __setApiForTest(undefined);
});

describe("soft Work List runtime", () => {
  test("work_list persists one Goal/Work List without a hidden Phase", async () => {
    const harness = makeHarness();
    const result = await execute(workListTool, {
      objective: "整理迁移事实",
      description: "先形成软性工作集，不启动 Until Done。",
      items: [{ subject: "读取实现" }],
      phases: [],
    }, harness.ctx);
    expect(result.details).toMatchObject({ itemCount: 1, phaseCount: 0, revision: 0 });
    const goal = __getGoalForTest()!;
    expect(goal.plan).toBeUndefined();
    expect(goal.planType).toBeUndefined();
    expect(goal.contract).toBeUndefined();
    expect(goal.workList).toMatchObject({
      items: [{ id: 1, subject: "读取实现", status: "pending" }],
      phases: [],
      nextItemId: 2,
      nextPhaseId: 1,
      revision: 0,
    });
    expect(harness.entries.at(-1)?.customType).toBe(WORK_STATE_ENTRY_TYPE);
  });

  test("four Work tools create, read and update root items plus real Phases", async () => {
    const harness = makeHarness();
    await execute(workListTool, {
      objective: "交付切片",
      description: "先用软清单组织真实边界。",
      items: [{ subject: "前置" }],
      phases: [],
    }, harness.ctx);
    await execute(workCreateTool, { target: "phase", subject: "实现", description: "真实阶段" }, harness.ctx);
    const created = await execute(workCreateTool, {
      target: "item",
      phaseId: 1,
      subject: "编码",
      description: "实现可复验输出。",
      deliverables: [{ target: "src/output.ts", description: "输出可读取" }],
    }, harness.ctx);
    expect(created.details).toMatchObject({ target: "item", revision: 2 });
    const read = await execute(workReadTool, { target: "list" }, harness.ctx);
    expect(read.content[0].text).toContain("phase #1");
    expect(read.content[0].text).toContain("#2 编码");
    expect(read.content[0].text).toContain("实现可复验输出。");
    expect(read.content[0].text).toContain("src/output.ts");
    const readItem = await execute(workReadTool, { target: "item", id: 2 }, harness.ctx);
    expect(readItem.content[0].text).toContain("实现可复验输出。");
    expect(readItem.content[0].text).toContain("输出可读取");
    await execute(workUpdateTool, { target: "item", id: 2, status: "in_progress" }, harness.ctx);
    await execute(workUpdateTool, { target: "item", id: 2, status: "done", evidence: "read src/output.ts", deliverableEvidence: [{ target: "src/output.ts", evidence: "文件内容匹配" }] }, harness.ctx);
    const phaseDone = await execute(workUpdateTool, { target: "phase", id: 1, status: "done" }, harness.ctx);
    expect(phaseDone.details).toMatchObject({ target: "phase", revision: 5 });
    expect(__getGoalForTest()?.workList?.phases[0].status).toBe("done");
    const readDonePhase = await execute(workReadTool, { target: "phase", id: 1 }, harness.ctx);
    expect(readDonePhase.content[0].text).toContain("read src/output.ts");
    expect(readDonePhase.content[0].text).toContain("文件内容匹配");
  });

  test("soft Work List restores across a real turn/compact but never sends continuation", async () => {
    const harness = makeHarness();
    await execute(workListTool, {
      objective: "跨回合保留",
      description: "清单保留，但不强行续跑。",
      items: [{ subject: "等待下一条真实输入" }],
      phases: [],
    }, harness.ctx);
    const agentEnd = harness.handlers.get("agent_end")!;
    await agentEnd({ messages: [{ role: "assistant", stopReason: "stop" }] }, harness.ctx);
    expect(harness.sent).toEqual([]);
    expect(__getGoalForTest()?.status).toBe("active");

    __resetGoalForTest();
    const compact = harness.handlers.get("session_compact")!;
    await compact({ willRetry: false }, harness.ctx);
    expect(__getGoalForTest()?.objective).toBe("跨回合保留");
    expect(harness.sent).toEqual([]);
  });

  test("new-generation tombstone prevents an old dgoal-plan-v2 entry from reviving", () => {
    const oldGoal = {
      id: "old",
      objective: "旧目标",
      description: "旧说明",
      status: "active",
      planType: "task",
      startedAt: 1,
      updatedAt: 1,
      iteration: 0,
      plan: {
        phases: [{ id: 1, subject: "旧", description: "旧", status: "pending", tasks: [{ id: 1, subject: "旧项", description: "旧项", status: "pending" }] }],
        nextId: 2,
        revision: 0,
      },
    };
    const ctx = {
      sessionManager: {
        getBranch: () => [
          { type: "custom", customType: "dgoal-plan-v2", data: { goal: oldGoal } },
          { type: "custom", customType: WORK_STATE_ENTRY_TYPE, data: { goal: null } },
        ],
      },
    } as never;
    expect(loadGoal(ctx)).toBeUndefined();
  });

  test("last terminal Work Item auto-closes a soft Work List, clears persistence, and asks the agent to summarize", async () => {
    const harness = makeHarness();
    await execute(workListTool, {
      objective: "轻量完成",
      description: "不建立 Plan Contract。",
      items: [{ subject: "完成即可" }],
      phases: [],
    }, harness.ctx);
    await execute(workUpdateTool, { target: "item", id: 1, status: "in_progress" }, harness.ctx);
    const done = await execute(workUpdateTool, { target: "item", id: 1, status: "done" }, harness.ctx);
    expect(done.details).toMatchObject({ status: "done", archived: false, autoClosed: true });
    expect(done.content[0].text).toContain("dgoal 完成信号");
    expect(done.content[0].text).toContain("直接回复用户");
    expect(done.terminate).toBeUndefined();
    expect(__getGoalForTest()).toBeUndefined();
    expect(harness.entries.filter((entry) => entry.customType === "dgoal-plan-history-v1")).toHaveLength(0);
    expect((harness.entries.at(-1)?.data as { goal?: unknown }).goal).toBeNull();
  });

  test("soft Work List with a real Phase waits for explicit Phase done, then auto-closes with feedback", async () => {
    const harness = makeHarness();
    await execute(workListTool, {
      objective: "阶段完成",
      description: "Phase 仍必须显式收口。",
      items: [],
      phases: [{ subject: "实现", description: "完成一个真实阶段。", items: [{ subject: "编码" }] }],
    }, harness.ctx);
    await execute(workUpdateTool, { target: "item", id: 1, status: "in_progress" }, harness.ctx);
    await execute(workUpdateTool, { target: "item", id: 1, status: "done" }, harness.ctx);
    expect(__getGoalForTest()?.workList?.phases[0].status).toBe("in_progress");
    const done = await execute(workUpdateTool, { target: "phase", id: 1, status: "done" }, harness.ctx);
    expect(done.details).toMatchObject({ status: "done", archived: false, autoClosed: true });
    expect(done.content[0].text).toContain("dgoal 完成信号");
    expect(__getGoalForTest()).toBeUndefined();
  });

  test("explicit close of a restored all-terminal soft Work List returns the supplied summary before clearing", async () => {
    const harness = makeHarness();
    __setGoalForTest({
      id: "restored-soft",
      objective: "审查剩余规范",
      description: "模拟旧 session 中已耗尽但仍 active 的软清单。",
      status: "active",
      startedAt: 1,
      updatedAt: 1,
      iteration: 0,
      workList: { items: [{ id: 1, subject: "汇总结论", status: "done" }], phases: [], nextItemId: 2, nextPhaseId: 1, revision: 12 },
    });
    const done = await execute(workUpdateTool, {
      target: "goal",
      status: "done",
      summary: "还有同类问题，但只应修改活跃主仓。",
      verification: "路径、Git 状态和项目入口已核验。",
      whatChanged: ["未修改任何文件", "完成分类"],
    }, harness.ctx);
    expect(done.content[0].text).toContain("还有同类问题，但只应修改活跃主仓");
    expect(done.content[0].text).toContain("路径、Git 状态和项目入口已核验");
    expect(done.content[0].text).toContain("直接回复用户");
    expect(done.terminate).toBeUndefined();
    expect(__getGoalForTest()).toBeUndefined();
    expect((harness.entries.at(-1)?.data as { goal?: unknown }).goal).toBeNull();
  });
});
