// ADR 0033：启动不再运行独立背景摘要；主 agent 在 proposal 中可选提交 contextSummary。
import { describe, expect, test } from "bun:test";

import { __getGoalForTest, __resetGoalForTest, __setApiForTest, __setContextSummarizerOverrideForTest, __startGoalForTest } from "../index.ts";

function makeCtx(priorText: string) {
  return {
    cwd: "/tmp", isIdle: () => true, abort: () => {}, ui: { confirm: async () => true, notify: () => {}, setStatus: () => {} },
    sessionManager: { getBranch: () => priorText ? [{ type: "message", message: { role: "user", content: [{ type: "text", text: priorText }] } }] : [] },
  };
}

describe("proposal 主导背景固化（ADR 0033）", () => {
  test("独立摘要失败不阻断启动，直接投递 proposal", async () => {
    __resetGoalForTest();
    __setApiForTest({ appendEntry: () => {} } as never);
    __setContextSummarizerOverrideForTest(async () => ({ summary: "", aborted: false, error: "模型不可用" }));
    const sent: string[] = [];
    await __startGoalForTest("测试目标", { sendUserMessage: async (msg: string) => void sent.push(msg) } as never, makeCtx("前文") as never);
    expect(__getGoalForTest()?.status).toBe("pending");
    expect(__getGoalForTest()?.contextSummary).toBeUndefined();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("phase_plan 或 goal_plan");
  });
});
