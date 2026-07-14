// 反馈环：agent 主动暂停出口（dgoal_pause / pauseReason=agent_blocked）。
// 场景：agent 卡在"需要用户决策才能继续"的死锁（如验收条件冲突），没有主动出口时
// 只能靠连续 3 轮不调工具消极触发 no_progress（被 continuation 催着空转烧 token）。
// dgoal_pause 给 agent 一个结构化出口：立即 paused(agent_blocked)，不等 3 轮。
import { beforeEach, describe, expect, test } from "bun:test";

import {
  __executeDgoalPauseForTest,
  __getGoalForTest,
  __resetGoalForTest,
  __resumeGoalForTest,
  __setApiForTest,
  __setGoalForTest,
  type DgoalContext,
  type ExtensionAPI,
  type GoalState,
} from "../index.ts";
import dgoal, { buildHeadingLine } from "../index.ts";

function makeActiveGoal(status: GoalState["status"] = "active"): GoalState {
  return {
    id: "g-agent-pause",
    objective: "测 agent 主动暂停出口",
    status,
    startedAt: 1,
    updatedAt: 1,
    iteration: 0,
  };
}

function mockCtx(notifications: string[] = []): DgoalContext {
  return {
    ui: {
      setStatus: () => {},
      notify: (msg: string) => { notifications.push(msg); },
      custom: () => {},
    },
    cwd: "/tmp",
  } as unknown as DgoalContext;
}

function mockPi(): ExtensionAPI {
  return {
    sendUserMessage: () => {},
    events: { emit: () => {} },
  } as unknown as ExtensionAPI;
}

describe("agent 主动暂停出口 · dgoal_pause", () => {
  beforeEach(() => {
    __resetGoalForTest();
  });

  test("active goal 调 dgoal_pause：立即 paused(agent_blocked) 并记录原因", async () => {
    __setGoalForTest(makeActiveGoal("active"));
    const notifications: string[] = [];
    const ctx = mockCtx(notifications);

    const result = await __executeDgoalPauseForTest({ reason: "冻结验收条件与目标互斥，需用户重新确认" }, ctx);

    const goal = __getGoalForTest();
    expect(goal?.status).toBe("paused");
    expect(goal?.pauseReason).toBe("agent_blocked");
    expect(goal?.pauseReasonDetail).toBe("冻结验收条件与目标互斥，需用户重新确认");
    // 暂停后这一轮应终止，不让 agent 继续空转。
    expect(result.terminate).toBe(true);
    // 用户通知必须携带 agent 给的原因，让用户知道为什么停。
    expect(notifications.some((n) => n.includes("冻结验收条件与目标互斥"))).toBe(true);
  });

  test("rejected goal 同样可主动暂停（isGoalMutable 覆盖 active/rejected）", async () => {
    __setGoalForTest(makeActiveGoal("rejected"));
    const ctx = mockCtx();

    await __executeDgoalPauseForTest({ reason: "卡住" }, ctx);

    const goal = __getGoalForTest();
    expect(goal?.status).toBe("paused");
    expect(goal?.pauseReason).toBe("agent_blocked");
  });

  test("空白 reason 被拒绝且不暂停 goal", async () => {
    __setGoalForTest(makeActiveGoal());
    const result = await __executeDgoalPauseForTest({ reason: "  \n  " }, mockCtx());

    expect(result.isError).toBe(true);
    expect(__getGoalForTest()?.status).toBe("active");
  });

  test("超长 reason 被拒绝且不写入 goal", async () => {
    __setGoalForTest(makeActiveGoal());
    const result = await __executeDgoalPauseForTest({ reason: "x".repeat(2_001) }, mockCtx());

    expect(result.isError).toBe(true);
    expect(__getGoalForTest()?.status).toBe("active");
  });

  test("已 paused goal 调 dgoal_pause：返回原暂停原因与 detail，不覆盖原状态", async () => {
    const goal = makeActiveGoal("paused");
    goal.pauseReason = "agent_blocked";
    goal.pauseReasonDetail = "需要用户确认冻结验收条件";
    __setGoalForTest(goal);

    const result = await __executeDgoalPauseForTest({ reason: "再次尝试暂停" }, mockCtx());

    expect(result.terminate).toBe(true);
    expect(result.content[0]?.text).toContain("需要用户确认冻结验收条件");
    expect(result.details.pauseReasonDetail).toBe("需要用户确认冻结验收条件");
    expect(__getGoalForTest()?.pauseReason).toBe("agent_blocked");
  });

  test("paused 状态标题展示 agent_blocked 的 detail", () => {
    const goal = {
      ...makeActiveGoal("paused"),
      plan: { phases: [], nextId: 1 },
      pauseReason: "agent_blocked" as const,
      pauseReasonDetail: "需要用户确认冻结验收条件",
    };

    expect(buildHeadingLine(goal)).toContain("需要用户确认冻结验收条件");
  });

  test("无 goal 调 dgoal_pause：返回 noGoal 提示，不 crash", async () => {
    const ctx = mockCtx();
    const result = await __executeDgoalPauseForTest({ reason: "无目标也要停" }, ctx);
    expect(result.terminate).toBe(true);
    expect(__getGoalForTest()).toBeUndefined();
  });

  test("pending goal 调 dgoal_pause：不可暂停（启动闸门阶段未进入执行）", async () => {
    __setGoalForTest(makeActiveGoal("pending"));
    const ctx = mockCtx();

    await __executeDgoalPauseForTest({ reason: "启动阶段想停" }, ctx);

    const goal = __getGoalForTest();
    expect(goal?.status).toBe("pending");
    expect(goal?.pauseReason).toBeUndefined();
  });

  test("agent_blocked resume 后 no_progress 计数清零，agent 重新获得完整空转预算", async () => {
    __setGoalForTest(makeActiveGoal("active"));
    const ctx = mockCtx();
    await __executeDgoalPauseForTest({ reason: "死锁" }, ctx);
    expect(__getGoalForTest()?.pauseReason).toBe("agent_blocked");

    await __resumeGoalForTest(mockPi(), ctx);

    const goal = __getGoalForTest();
    expect(goal?.status).toBe("active");
    expect(goal?.pauseReason).toBeUndefined();
    expect(goal?.pauseReasonDetail).toBeUndefined();
  });

  test("UI 抛错时 agent_blocked 仍先持久化 paused 状态", async () => {
    const writes: Array<{ goal?: GoalState }> = [];
    __setApiForTest({ appendEntry: (_type, data) => writes.push(data as { goal?: GoalState }) });
    __setGoalForTest(makeActiveGoal());
    const throwingCtx = {
      ui: {
        setStatus: () => { throw new Error("Spacer is not defined"); },
        notify: () => { throw new Error("notify boom"); },
        custom: () => { throw new Error("custom boom"); },
      },
      cwd: "/tmp",
    } as unknown as DgoalContext;

    try {
      const result = await __executeDgoalPauseForTest({ reason: "需要用户决策" }, throwingCtx);
      expect(result.terminate).toBe(true);
      expect(__getGoalForTest()?.status).toBe("paused");
      expect(writes.at(-1)?.goal?.pauseReason).toBe("agent_blocked");
    } finally {
      __setApiForTest(undefined);
    }
  });

  test("dgoal_pause 工具被注册到 Pi（agent 可见，不只靠 no_progress 兜底）", () => {
    const tools: string[] = [];
    const pi = {
      registerTool: (tool: { name: string }) => { tools.push(tool.name); },
      registerCommand: () => {},
      on: () => {},
      events: { emit: () => {} },
    } as unknown as ExtensionAPI;
    dgoal(pi);
    expect(tools).toContain("dgoal_pause");
    expect(tools).toContain("dgoal_done");
  });
});
