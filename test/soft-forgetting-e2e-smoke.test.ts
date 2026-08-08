// ADR 0051：完成 Phase 的明细在持续 Plan Contract context 中软遗忘。
import { beforeEach, describe, expect, test } from "bun:test";

import {
  __getGoalForTest,
  __resetGoalForTest,
  __setApiForTest,
  buildPlanContractContext,
  executionPlanTool,
  workUpdateTool,
} from "../index.ts";

const ctx = {
  cwd: process.cwd(),
  ui: { setStatus: () => {}, setWidget: () => {}, notify: () => {} },
  sessionManager: { getBranch: () => [] },
} as never;

async function execute(tool: { execute: Function }, params: Record<string, unknown>) {
  return tool.execute("call", params, undefined, undefined, ctx);
}

beforeEach(() => {
  __resetGoalForTest();
  __setApiForTest({ appendEntry: () => {} });
});

describe("Work List soft forgetting e2e", () => {
  test("explicitly done Phase keeps its heading but hides member Work Item details", async () => {
    await execute(executionPlanTool, {
      objective: "软遗忘 smoke",
      description: "控制持续上下文体积。",
      items: [],
      phases: [
        { subject: "阶段一", description: "完成第一阶段。", items: [{ subject: "任务甲", description: "完成甲。" }, { subject: "任务乙", description: "完成乙。" }] },
        { subject: "阶段二", description: "继续第二阶段。", items: [{ subject: "任务丙", description: "完成丙。" }] },
      ],
    });
    for (const step of [
      { target: "item", id: 1, status: "in_progress" },
      { target: "item", id: 1, status: "done", evidence: "ev-甲" },
      { target: "item", id: 2, status: "in_progress" },
      { target: "item", id: 2, status: "done", evidence: "ev-乙" },
    ]) {
      expect((await execute(workUpdateTool, step)).details?.error).toBeUndefined();
    }

    let block = buildPlanContractContext(__getGoalForTest()!);
    expect(block).toContain("任务甲");
    expect(block).toContain("ev-甲");
    expect(block).toContain("任务乙");
    expect(block).toContain("ev-乙");

    expect((await execute(workUpdateTool, { target: "phase", id: 1, status: "done" })).details?.error).toBeUndefined();
    block = buildPlanContractContext(__getGoalForTest()!);
    expect(block).toContain("phase #1 [done] 阶段一");
    expect(block).not.toContain("任务甲");
    expect(block).not.toContain("任务乙");
    expect(block).not.toContain("ev-甲");
    expect(block).not.toContain("ev-乙");
    expect(block).toContain("phase #2 [pending] 阶段二");
    expect(block).toContain("任务丙");
  });

  test("done Work Item remains visible while its Phase is still active", async () => {
    await execute(executionPlanTool, {
      objective: "当前 Phase 保留证据",
      description: "未收口阶段继续提供执行上下文。",
      items: [],
      phases: [{ subject: "进行中阶段", description: "继续推进。", items: [{ subject: "已完成任务", description: "先完成。" }, { subject: "待办任务", description: "稍后完成。" }] }],
    });
    await execute(workUpdateTool, { target: "item", id: 1, status: "in_progress" });
    await execute(workUpdateTool, { target: "item", id: 1, status: "done", evidence: "内 done 证据" });
    const block = buildPlanContractContext(__getGoalForTest()!);
    expect(block).toContain("已完成任务");
    expect(block).toContain("内 done 证据");
    expect(block).toContain("待办任务");
  });
});
