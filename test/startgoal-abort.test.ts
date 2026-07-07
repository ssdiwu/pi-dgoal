// /dgoal 启动暂停当前 LLM 工作的测试（issue 2）。
// 根因：startGoal 此前不 abort 当前 agent turn（clearGoal 有 ctx.abort，startGoal 没有）。
// 修复：startGoal 入口若 !isIdle 则 ctx.abort；并用 startGoalInProgress 标志包住
// pending 创建→propose 投递整段，抑制被中断 turn 的 agent_end 触发 handleStartupGate 双发 propose。
import { describe, expect, test } from "bun:test";

import {
  __isStartGoalInProgressForTest,
  __resetGoalForTest,
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
    expect(sent[0]).toContain("dgoal_propose");
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

  test("startGoal 投递 propose 恰好一次（不双发）", async () => {
    __resetGoalForTest();
    const sent: string[] = [];
    const pi = { sendUserMessage: async (msg: string) => void sent.push(msg) } as never;
    const ctx = makeCtx({ isIdle: false, abort: () => {} });

    await __startGoalForTest("测试目标", pi, ctx as never);

    // 即使 abort 了，startGoal 自己只投递一次 propose；agent_end 的双发由 flag 抑制
    const proposeCount = sent.filter((m) => m.includes("dgoal_propose")).length;
    expect(proposeCount).toBe(1);
  });
});
