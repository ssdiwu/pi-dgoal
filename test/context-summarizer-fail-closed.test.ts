// 覆盖背景总结候选链 fail-closed（ADR 0027）：所有候选失败时清理 pending、持久化 null、不发 propose。
import { describe, expect, test } from "bun:test";

import {
  __getGoalForTest,
  __resetGoalForTest,
  __setApiForTest,
  __setContextSummarizerOverrideForTest,
  __startGoalForTest,
} from "../index.ts";

function makeApi() {
  const writes: Array<{ type: string; data: { goal: unknown } }> = [];
  const api = {
    appendEntry: (type: string, data: { goal: unknown }) => void writes.push({ type, data }),
  };
  return { api, writes };
}

function makeCtx(priorText: string) {
  return {
    cwd: "/tmp",
    isIdle: () => true,
    abort: () => {},
    ui: { confirm: async () => true, notify: () => {}, setStatus: () => {} },
    sessionManager: {
      getBranch: () => priorText
        ? [{ type: "message", message: { role: "user", content: [{ type: "text", text: priorText }] } }]
        : [],
    },
  };
}

describe("背景总结候选链 fail-closed（ADR 0027）", () => {
  test("全部候选失败：清理 pending、persistGoal(null)、不发 propose prompt", async () => {
    __resetGoalForTest();
    const { api, writes } = makeApi();
    __setApiForTest(api as never);
    __setContextSummarizerOverrideForTest(async () => ({ summary: "", aborted: false, error: "模型不可用" }));

    const sent: string[] = [];
    const pi = { sendUserMessage: async (msg: string) => void sent.push(msg) } as never;
    const ctx = makeCtx("之前讨论过验收标准 X");

    await __startGoalForTest("测试目标", pi, ctx as never);

    expect(__getGoalForTest()).toBeUndefined();
    const lastWrite = writes.at(-1);
    expect(lastWrite?.data.goal).toBeNull();
    expect(sent).toHaveLength(0);
  });

  test("成功返回摘要：继续 propose 启动闸门", async () => {
    __resetGoalForTest();
    const { api } = makeApi();
    __setApiForTest(api as never);
    __setContextSummarizerOverrideForTest(async () => ({ summary: "关键约束：必须支持中文", aborted: false }));

    const sent: string[] = [];
    const pi = { sendUserMessage: async (msg: string) => void sent.push(msg) } as never;
    const ctx = makeCtx("之前讨论过验收标准 X");

    await __startGoalForTest("测试目标", pi, ctx as never);

    expect(__getGoalForTest()?.contextSummary).toBe("关键约束：必须支持中文");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("dgoal_propose");
  });

  test("无额外背景：不报错仍启动", async () => {
    __resetGoalForTest();
    const { api } = makeApi();
    __setApiForTest(api as never);
    __setContextSummarizerOverrideForTest(async () => ({ summary: "无额外背景", aborted: false }));

    const sent: string[] = [];
    const pi = { sendUserMessage: async (msg: string) => void sent.push(msg) } as never;
    const ctx = makeCtx("之前讨论过");

    await __startGoalForTest("测试目标", pi, ctx as never);
    expect(__getGoalForTest()?.contextSummary).toBeUndefined();
    expect(sent).toHaveLength(1);
  });
});
