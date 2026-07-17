// /dgoal 启动暂停当前 LLM 工作的测试（issue 2）。
// 根因：startGoal 此前不 abort 当前 agent turn（clearGoal 有 ctx.abort，startGoal 没有）。
// 修复：startGoal 入口若 !isIdle 则 ctx.abort；并用 startGoalInProgress 标志包住
// pending 创建→propose 投递整段，抑制被中断 turn 的 agent_end 触发 handleStartupGate 双发 propose。
import { describe, expect, test } from "bun:test";

import {
  __executePlanProposalForTest,
  __getGoalForTest,
  __getPendingProposalForTest,
  __isStartGoalInProgressForTest,
  __resetGoalForTest,
  __resumeGoalForTest,
  __setGoalForTest,
  __startGoalForTest,
  type GoalState,
} from "../index.ts";

function makeCtx(opts: { isIdle: boolean; abort?: () => void }) {
  return {
    cwd: "/tmp",
    isIdle: () => opts.isIdle,
    abort: opts.abort,
    ui: { confirm: async () => true, notify: () => {}, setStatus: () => {} },
    // 空 entries：extractPriorDiscussion 返回空 → 跳过 summarizeContext（可控、不依赖子进程）
    sessionManager: { getBranch: () => [] },
  };
}

describe("/dgoal 启动暂停当前 LLM（startGoal abort）", () => {
  test("agent 非 idle 时 → 调用 ctx.abort 暂停当前 LLM 工作", async () => {
    __resetGoalForTest();
    let aborted = 0;
    const sent: string[] = [];
    const pi = { sendUserMessage: async (msg: string) => void sent.push(msg) } as never;
    const ctx = makeCtx({ isIdle: false, abort: () => { aborted += 1; } });

    await __startGoalForTest("测试目标", pi, ctx as never);

    expect(aborted).toBe(1);
    // propose prompt 仍正常投递一次
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("phase_plan 或 goal_plan");
  });

  test("startGoal 的 status/notify 抛错时仍投递 propose prompt", async () => {
    __resetGoalForTest();
    const sent: string[] = [];
    const pi = { sendUserMessage: async (msg: string) => void sent.push(msg) } as never;
    const ctx = {
      cwd: "/tmp",
      isIdle: () => true,
      abort: () => {},
      ui: {
        confirm: async () => true,
        notify: () => { throw new Error("UI notify failed"); },
        setStatus: () => { throw new Error("UI status failed"); },
      },
      sessionManager: { getBranch: () => [] },
    };
    await __startGoalForTest("启动 UI 容错", pi, ctx as never);
    expect(__getGoalForTest()?.status).toBe("pending");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("phase_plan 或 goal_plan");
  });

  test("agent idle 时 → 不调用 ctx.abort", async () => {
    __resetGoalForTest();
    let aborted = 0;
    const sent: string[] = [];
    const pi = { sendUserMessage: async (msg: string) => void sent.push(msg) } as never;
    const ctx = makeCtx({ isIdle: true, abort: () => { aborted += 1; } });

    await __startGoalForTest("测试目标", pi, ctx as never);

    expect(aborted).toBe(0);
    expect(sent).toHaveLength(1);
  });

  test("startGoal 结束后 startGoalInProgress 标志清零（不卡死 handleStartupGate）", async () => {
    __resetGoalForTest();
    const pi = { sendUserMessage: async () => {} } as never;
    const ctx = makeCtx({ isIdle: false, abort: () => {} });

    expect(__isStartGoalInProgressForTest()).toBe(false);
    await __startGoalForTest("测试目标", pi, ctx as never);
    // 正常完成后必须清零，否则 agent_end 的 pending 分支被永久抑制 → 启动闸门锁死
    expect(__isStartGoalInProgressForTest()).toBe(false);
  });

  test("语义预审用户中断时 goal 仍为 pending 且没有 active proposal", async () => {
    __resetGoalForTest();
    __setGoalForTest({ id: "semantic-abort", objective: "测试目标", description: "等待提案确认。", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 });
    const result = await __executePlanProposalForTest({
      objective: "测试目标",
      description: "验证中断边界，不扩张范围。",
      verification: "bun test",
      acceptanceCriteria: [{ criterion: "测试通过", evidence: "bun test" }],
      phases: [{ subject: "阶段", description: "完成中断路径验证。", acceptanceCriteria: [{ criterion: "测试通过", evidence: "bun test" }] }],
    }, { signal: AbortSignal.abort() });
    expect(result.details?.error).toBe("semantic review technical error");
    expect(result.isError).toBe(true);
    expect(__getGoalForTest()?.status).toBe("pending");
    expect(__getPendingProposalForTest()).toBeUndefined();
  });

  test("resumeGoal 的 status/overlay 抛错时仍投递 resume prompt", async () => {
    __resetGoalForTest();
    __setGoalForTest({ id: "resume-ui-throw", objective: "恢复 UI 容错", status: "paused", pauseReason: "user_abort", startedAt: 1, updatedAt: 1, iteration: 0 });
    const sent: string[] = [];
    const pi = { sendUserMessage: async (msg: string) => void sent.push(msg) } as never;
    const ctx = {
      ui: {
        notify: () => {},
        setStatus: () => { throw new Error("UI status failed"); },
      },
      cwd: "/tmp",
    };
    await __resumeGoalForTest(pi, ctx as never);
    expect(__getGoalForTest()?.status).toBe("active");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("恢复当前 goal Plan");
  });

  test("resume prompt 发送失败时回到原 paused 状态，避免假 active", async () => {
    __resetGoalForTest();
    __setGoalForTest({
      id: "resume-send-failed",
      objective: "恢复失败保护",
      status: "paused",
      pauseReason: "agent_blocked",
      pauseReasonDetail: "等待用户决策",
      startedAt: 1,
      updatedAt: 2,
      pauseStartedAt: 2,
      iteration: 0,
    });
    const pi = { sendUserMessage: async () => { throw new Error("queue unavailable"); } } as never;
    const ctx = { cwd: "/tmp", ui: { notify: () => {}, setStatus: () => {} } };
    await __resumeGoalForTest(pi, ctx as never);
    expect(__getGoalForTest()).toMatchObject({
      status: "paused",
      pauseReason: "agent_blocked",
      pauseReasonDetail: "等待用户决策",
    });
    expect(typeof __getGoalForTest()?.pauseStartedAt).toBe("number");
  });

  test("startGoal 投递 propose 恰好一次（不双发）", async () => {
    __resetGoalForTest();
    const sent: string[] = [];
    const pi = { sendUserMessage: async (msg: string) => void sent.push(msg) } as never;
    const ctx = makeCtx({ isIdle: false, abort: () => {} });

    await __startGoalForTest("测试目标", pi, ctx as never);

    // 即使 abort 了，startGoal 自己只投递一次 propose；agent_end 的双发由 flag 抑制
    const proposeCount = sent.filter((m) => m.includes("phase_plan 或 goal_plan")).length;
    expect(proposeCount).toBe(1);
  });
});
