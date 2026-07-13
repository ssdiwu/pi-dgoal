// 覆盖 /dgoal help 命令路由：冷启动 / paused 投递 help prompt；active / pending 仅 notify。
// 见 ADR 0020、doc/术语表.md「冷启动」「用户激活边界」。
import { describe, expect, test } from "bun:test";

import {
  __handleDgoalCommandForTest,
  __resetGoalForTest,
  __setGoalForTest,
  type GoalState,
} from "../index.ts";

function makeCtx() {
  const notify: Array<{ text: string; level: string }> = [];
  return {
    cwd: "/tmp",
    isIdle: () => true,
    ui: { confirm: async () => true, notify: (text: string, level: string) => void notify.push({ text, level }), setStatus: () => {} },
    sessionManager: { getBranch: () => [] },
    _notify: notify,
  };
}

function baseGoal(status: GoalState["status"]): GoalState {
  return {
    id: "g-help",
    objective: "help routing goal",
    status,
    startedAt: 1,
    updatedAt: 1,
    iteration: 0,
    plan: { phases: [{ id: 1, subject: "p", status: "pending", tasks: [{ id: 2, subject: "t", status: "pending" }] }], nextId: 3 },
  } as never;
}

describe("/dgoal help 命令路由（ADR 0020）", () => {
  test("冷启动（无 goal）：投递 help prompt，不 notify", async () => {
    __resetGoalForTest();
    const sent: string[] = [];
    const pi = { sendUserMessage: async (msg: string) => void sent.push(msg) } as never;
    const ctx = makeCtx();
    await __handleDgoalCommandForTest("help", pi, ctx as never);
    expect(sent).toHaveLength(1);
    expect(ctx._notify).toHaveLength(0);
  });

  test("paused：投递 help prompt", async () => {
    __resetGoalForTest();
    __setGoalForTest({ ...baseGoal("paused"), pauseReason: "user_abort" } as never);
    const sent: string[] = [];
    const pi = { sendUserMessage: async (msg: string) => void sent.push(msg) } as never;
    const ctx = makeCtx();
    await __handleDgoalCommandForTest("h", pi, ctx as never);
    expect(sent).toHaveLength(1);
    expect(ctx._notify).toHaveLength(0);
  });

  test("active：仅 notify helpActive，不投递 prompt", async () => {
    __resetGoalForTest();
    __setGoalForTest(baseGoal("active") as never);
    const sent: string[] = [];
    const pi = { sendUserMessage: async (msg: string) => void sent.push(msg) } as never;
    const ctx = makeCtx();
    await __handleDgoalCommandForTest("help", pi, ctx as never);
    expect(sent).toHaveLength(0);
    expect(ctx._notify).toHaveLength(1);
    expect(ctx._notify[0].text).toContain("help");
  });

  test("pending（启动中）：仅 notify helpActive，不投递 prompt", async () => {
    __resetGoalForTest();
    __setGoalForTest(baseGoal("pending") as never);
    const sent: string[] = [];
    const pi = { sendUserMessage: async (msg: string) => void sent.push(msg) } as never;
    const ctx = makeCtx();
    await __handleDgoalCommandForTest("help", pi, ctx as never);
    expect(sent).toHaveLength(0);
    expect(ctx._notify).toHaveLength(1);
  });
});
