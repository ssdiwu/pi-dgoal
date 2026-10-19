import { beforeEach, describe, expect, test } from "bun:test";
import { convertToLlm } from "@earendil-works/pi-coding-agent";
import dgoal, { __getGoalForTest, __resetGoalForTest, __setGoalForTest, workUpdateTool, type GoalState } from "../index.ts";

const handlers: Record<string, (event: any, ctx: any) => any> = {};
dgoal({ registerTool: () => {}, registerCommand: () => {}, on: (name: string, handler: any) => { handlers[name] = handler; }, appendEntry: () => {}, events: { emit: () => {} } } as never);
const ctx = { cwd: "/tmp", ui: {}, sessionManager: { getBranch: () => [] } } as never;

function goal(): GoalState {
  return {
    id: "cache-goal", objective: "修复缓存", description: "保持历史消息前缀稳定", status: "active", startedAt: 1, updatedAt: 1, iteration: 0,
    workList: { items: [{ id: 1, subject: "验证", description: "复验实际投影", status: "in_progress" }], phases: [], nextItemId: 2, nextPhaseId: 1, revision: 0 },
    contract: { id: "cache-run", profile: "execution", startedAt: 1, revision: 0, transitions: [{ to: "execution", at: 1, revision: 0 }] },
  };
}

async function modelContext(messages: any[] = []) {
  const projected = await handlers.context?.({ messages }, ctx);
  return projected?.messages ?? messages;
}

describe("plan context uses message tail while the system prefix stays stable", () => {
  beforeEach(__resetGoalForTest);

  test("public Work Item updates change only the ephemeral model context", async () => {
    __setGoalForTest(goal());
    const first = await handlers.before_agent_start({ prompt: "开始", systemPrompt: "base" }, ctx);
    const history = [{ role: "user", content: "开始", timestamp: 1 }];
    const original = structuredClone(history);
    const before = await modelContext(history);
    expect(JSON.stringify(convertToLlm(before))).toContain("in_progress");
    const update = await workUpdateTool.execute("test", { target: "item", id: 1, status: "done", evidence: "bun test" }, undefined, undefined, ctx);
    expect(update.isError).not.toBe(true);
    const second = await handlers.before_agent_start({ prompt: "继续", systemPrompt: "base" }, ctx);
    expect(first.systemPrompt).toBe(second.systemPrompt);
    expect(first.systemPrompt).not.toContain("修复缓存");
    expect(first.message).toBeUndefined();
    const after = await modelContext(history);
    const llm = JSON.stringify(convertToLlm(after));
    expect(llm).toContain("bun test");
    expect(llm).toContain("[done]");
    expect(history).toEqual(original);
    expect(after).toHaveLength(history.length + 1);
    expect(before.at(-1).customType).toBe("dgoal-plan-context");
  });

  test("repeated requests drop old dgoal snapshots and preserve other extensions", async () => {
    __setGoalForTest(goal());
    const foreign = { role: "custom", customType: "another-extension", content: "保留", display: false, timestamp: 1 };
    const old = { role: "custom", customType: "dgoal-plan-context", content: "旧目标", display: false, timestamp: 1 };
    const history = [foreign, old];
    const first = await modelContext(history);
    const second = await modelContext(first);
    expect(second.filter((message: any) => message.customType === "dgoal-plan-context")).toHaveLength(1);
    expect(second[0]).toEqual(foreign);
    expect(JSON.stringify(second)).not.toContain("旧目标");
    expect(history).toEqual([foreign, old]);
  });

  test("pause, clear and branch resync never leave active instructions in model context", async () => {
    __setGoalForTest(goal());
    const active = await modelContext();
    __setGoalForTest({ ...goal(), status: "paused", pauseReason: "user_abort" });
    const paused = await modelContext(active);
    expect(JSON.stringify(paused)).not.toContain("持续推进直到显式完成");
    __setGoalForTest(undefined);
    const empty = await modelContext(active);
    expect(empty).toEqual([]);
    expect(__getGoalForTest()).toBeUndefined();
    const branch = { ...goal(), id: "new-branch", objective: "新分支目标" };
    await handlers.session_tree({}, { ...ctx, sessionManager: { getBranch: () => [{ type: "custom", customType: "dgoal-work-v1", data: { goal: branch } }] } });
    const switched = await modelContext(active);
    expect(JSON.stringify(switched)).toContain("新分支目标");
    expect(JSON.stringify(switched)).not.toContain("修复缓存");
  });
});
