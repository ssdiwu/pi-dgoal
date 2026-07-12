// schema 层集成测试：验证 dgoal_plan / dgoal_propose 的 prepareArguments 钩子
// 能把模型 stringify 的数组参数（"[]" / "[1,2]"）coerce 回 number[]，
// 且 coerce 后的输出通过严格 schema（Type.Array(Type.Number())）的 Value.Check。
//
// 背景：pi 主程序 dispatch 顺序为 prepareArguments → validateToolArguments。
// 模型若把 blockedBy 序列化成字符串 "[]"，未经 prepareArguments 会被
// TypeBox Value.Convert 转成类数组结构后报 blockedBy.0: must be number。
// prepareArguments 是框架为"校验前规整模型坏输入"提供的接缝。
import { describe, expect, test } from "bun:test";
import { Compile } from "typebox/compile";

import { __dgoalPlanToolDefForTest, __dgoalProposeToolDefForTest } from "../index.ts";

function passesStrictSchema(toolDef: ReturnType<typeof __dgoalPlanToolDefForTest>, args: Record<string, unknown>): boolean {
  // 模拟 pi-agent-core prepareToolCallArguments → validateToolArguments：
  // 1. prepareArguments 规整；2. 严格 schema Check（Value.Convert 对已干净的数组是 no-op）。
  const prepared = (toolDef.prepareArguments ?? ((x: unknown) => x as never))(args) as Record<string, unknown>;
  const validator = Compile(toolDef.parameters);
  return validator.Check(prepared);
}

describe("prepareArguments schema 接缝 · dgoal_plan", () => {
  const toolDef = __dgoalPlanToolDefForTest();

  test("blockedBy 字符串空数组 → coerce 后过严格 schema", () => {
    expect(passesStrictSchema(toolDef, { action: "create", phaseId: 1, subject: "b", blockedBy: "[]" })).toBe(true);
  });

  test("blockedBy 字符串 '[1,2]' → coerce 后过严格 schema", () => {
    expect(passesStrictSchema(toolDef, { action: "create", phaseId: 1, subject: "b", blockedBy: "[1,2]" })).toBe(true);
  });

  test("addBlockedBy 字符串 '[1]' → coerce 后过严格 schema", () => {
    expect(passesStrictSchema(toolDef, { action: "update", id: 2, addBlockedBy: "[1]" })).toBe(true);
  });

  test("removeBlockedBy 字符串 '[1]' → coerce 后过严格 schema", () => {
    expect(passesStrictSchema(toolDef, { action: "update", id: 2, removeBlockedBy: "[1]" })).toBe(true);
  });

  test("真实数组不被 prepareArguments 改动", () => {
    const args = { action: "create", phaseId: 1, subject: "b", blockedBy: [1, 2] };
    const prepared = toolDef.prepareArguments!(args) as Record<string, unknown>;
    expect(prepared.blockedBy).toEqual([1, 2]);
    expect(prepared).toBe(args); // 同引用（无变更时原样返回）
  });

  test("省略 blockedBy 不报错", () => {
    expect(passesStrictSchema(toolDef, { action: "create", phaseId: 1, subject: "b" })).toBe(true);
  });

  test("prepareArguments 输出 coercing 后的 blockedBy 为真实数组", () => {
    const prepared = toolDef.prepareArguments!({ action: "create", phaseId: 1, subject: "b", blockedBy: "[1,2]" }) as Record<string, unknown>;
    expect(Array.isArray(prepared.blockedBy)).toBe(true);
    expect(prepared.blockedBy).toEqual([1, 2]);
  });
});

describe("prepareArguments schema 接缝 · dgoal_propose", () => {
  const toolDef = __dgoalProposeToolDefForTest();
  const criterion = { criterion: "测试通过", evidence: "npm test" };
  const baseProposal = (blockedBy: unknown) => ({
    objective: "o",
    verification: "完成验证",
    acceptanceCriteria: [criterion],
    phases: [{ subject: "p1", acceptanceCriteria: [criterion], tasks: [{ subject: "t1" }, { subject: "t2", blockedBy }] }],
  });

  test("tasks[].blockedBy 字符串 '[1]' → coerce 后过严格 schema", () => {
    expect(passesStrictSchema(toolDef, baseProposal("[1]"))).toBe(true);
  });

  test("tasks[].blockedBy 字符串空数组 → coerce 后过严格 schema", () => {
    expect(passesStrictSchema(toolDef, baseProposal("[]"))).toBe(true);
  });

  test("tasks[].blockedBy 真实数组保持不变", () => {
    const args = baseProposal([1]);
    const prepared = toolDef.prepareArguments!(args) as Record<string, unknown>;
    const phases = prepared.phases as Array<{ tasks: Array<{ blockedBy?: number[] }> }>;
    expect(phases[0].tasks[1].blockedBy).toEqual([1]);
  });

  test("无 tasks 的 phase 不报错", () => {
    expect(passesStrictSchema(toolDef, {
      objective: "o",
      verification: "v",
      acceptanceCriteria: [{ criterion: "完成", evidence: "npm test" }],
      phases: [{ subject: "p", acceptanceCriteria: [{ criterion: "完成", evidence: "npm test" }] }],
    })).toBe(true);
  });
});
