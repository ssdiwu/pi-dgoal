// 验收 2/3/4 反馈环：paused/missing/pending 状态下工具的可读与可写边界。
// 回归 paused 与 missing 分流：paused 只能读，missing 才返回 noGoal。
import { beforeEach, describe, expect, test } from "bun:test";

import {
  __executeDgoalCheckForTest,
  __executeDgoalDoneForTest,
  __executeDgoalPlanForTest,
  __getGoalForTest,
  __pauseGoalForTest,
  __resetGoalForTest,
  __setGoalForTest,
  type GoalState,
  type Phase,
  type Task,
  type TaskPlan,
} from "../index.ts";

function task(id: number, subject: string, status: Task["status"] = "pending", extra: Partial<Task> = {}): Task {
  return { id, subject, status, ...extra };
}
function phase(id: number, subject: string, tasks: Task[], status: Phase["status"] = "pending"): Phase {
  return { id, subject, tasks, status };
}

function plan(): TaskPlan {
  return {
    phases: [
      phase(1, "阶段一", [task(1, "待办")], "in_progress"),
      phase(2, "阶段二", [task(2, "待办")], "pending"),
    ],
    nextId: 3,
  };
}

function baseGoal(overrides: Partial<GoalState>): GoalState {
  return {
    id: "g-paused",
    objective: "测 paused 诊断",
    status: "active",
    startedAt: 1,
    updatedAt: 1,
    iteration: 0,
    plan: plan(),
    ...overrides,
  };
}

const PAUSED_USER_ABORT = baseGoal({ status: "paused", pauseReason: "user_abort" });
const PAUSED_MODEL_ERROR = baseGoal({ status: "paused", pauseReason: "model_error" });
const ACTIVE = baseGoal({ status: "active" });

function text(result: { content?: Array<{ type?: string; text?: string }> }): string {
  return String(result.content?.[0]?.text ?? "");
}

describe("paused 状态工具诊断（验收 2/3/4）", () => {
  beforeEach(() => {
    __resetGoalForTest();
  });

  test("paused goal: dgoal_plan list 应允许只读并返回 plan 内容（不报 noGoal）", async () => {
    __setGoalForTest(PAUSED_USER_ABORT);
    const r = await __executeDgoalPlanForTest({ action: "list" });
    const body = text(r);
    expect(body).not.toContain("没有进行中的");
    // 只读应返回实际 plan 内容
    expect(body).toContain("待办");
  });

  test("paused goal: dgoal_plan get 应允许只读", async () => {
    __setGoalForTest(PAUSED_USER_ABORT);
    const r = await __executeDgoalPlanForTest({ action: "get", id: 1 });
    const body = text(r);
    expect(body).not.toContain("没有进行中的");
    expect(body).toContain("待办");
  });

  test("paused goal: dgoal_plan create 应拒绝并提示 resume（不报 noGoal）", async () => {
    __setGoalForTest(PAUSED_USER_ABORT);
    const r = await __executeDgoalPlanForTest({ action: "create", phaseId: 1, subject: "新任务" });
    const body = text(r);
    expect(body).not.toContain("没有进行中的");
    expect(body).toMatch(/暂停|paused/i);
    expect(body).toMatch(/\/dgoal resume/);
  });

  test("paused goal: dgoal_plan update 应拒绝并提示 resume", async () => {
    __setGoalForTest(PAUSED_USER_ABORT);
    const r = await __executeDgoalPlanForTest({ action: "update", id: 1, status: "in_progress" });
    const body = text(r);
    expect(body).not.toContain("没有进行中的");
    expect(body).toMatch(/暂停|paused/i);
    expect(body).toMatch(/\/dgoal resume/);
  });

  test("paused goal: dgoal_check 应拒绝并提示 resume（不报 noGoal）", async () => {
    __setGoalForTest(PAUSED_USER_ABORT);
    const r = await __executeDgoalCheckForTest({ phaseId: 1 });
    const body = text(r);
    expect(body).not.toContain("没有进行中的");
    expect(body).toMatch(/暂停|paused/i);
    expect(body).toMatch(/\/dgoal resume/);
  });

  test("paused goal: dgoal_done 应拒绝并提示 resume（不继续走终审/越闸门）", async () => {
    __setGoalForTest(PAUSED_USER_ABORT);
    const r = await __executeDgoalDoneForTest({ summary: "s", verification: "v" });
    const body = text(r);
    expect(body).not.toMatch(/越终审推进|gate.?jump/i);
    expect(body).toMatch(/暂停|paused/i);
    expect(body).toMatch(/\/dgoal resume/);
  });

  test("paused 结果应包含 pauseReason（user_abort / model_error 可区分）", async () => {
    __setGoalForTest(PAUSED_USER_ABORT);
    const rUser = await __executeDgoalCheckForTest({ phaseId: 1 });
    const bodyUser = text(rUser);
    expect(bodyUser).toMatch(/user_abort|用户中断|user abort/i);

    __setGoalForTest(PAUSED_MODEL_ERROR);
    const rModel = await __executeDgoalCheckForTest({ phaseId: 1 });
    const bodyModel = text(rModel);
    expect(bodyModel).toMatch(/model_error|模型错误|model error/i);
  });
});

describe("rejected goal 可被用户显式暂停", () => {
  beforeEach(() => __resetGoalForTest());

  test("/dgoal pause 在 rejected 状态写入 user_abort", () => {
    __setGoalForTest(baseGoal({ status: "rejected", rejectedCount: 1 }));
    __pauseGoalForTest({ ui: { setStatus: () => {}, notify: () => {} } } as never);
    expect(__getGoalForTest()?.status).toBe("paused");
    expect(__getGoalForTest()?.pauseReason).toBe("user_abort");
  });

  test("/dgoal pause 的 UI 抛错不阻断状态持久化", () => {
    __setGoalForTest(baseGoal({ status: "rejected", rejectedCount: 1 }));
    expect(() => __pauseGoalForTest({ ui: {
      setStatus: () => { throw new Error("Spacer is not defined"); },
      notify: () => { throw new Error("notify boom"); },
      custom: () => { throw new Error("custom boom"); },
    } } as never)).not.toThrow();
    expect(__getGoalForTest()?.status).toBe("paused");
    expect(__getGoalForTest()?.pauseReason).toBe("user_abort");
  });
});

describe("pending goal 不可完成（启动闸门保护）", () => {
  beforeEach(() => {
    __resetGoalForTest();
  });

  test("pending goal: dgoal_done 返回 noGoal，不绕过启动闸门", async () => {
    __setGoalForTest(baseGoal({ status: "pending" }));
    const r = await __executeDgoalDoneForTest({ summary: "s", verification: "v" });
    const body = text(r);
    expect(body).toContain("没有");
    expect((r as { details?: Record<string, unknown> }).details?.error).toBe("goal not mutable");
  });
});

describe("missing 与 active 状态不回归（验收 2 分流）", () => {

  beforeEach(() => {
    __resetGoalForTest();
  });

  test("missing goal: dgoal_plan 返回 noGoal（不是 paused）", async () => {
    const r = await __executeDgoalPlanForTest({ action: "list" });
    const body = text(r);
    expect(body).toContain("没有进行中的");
    expect(body).not.toMatch(/\/dgoal resume/);
  });

  test("missing goal: dgoal_check 返回 noGoal（不是 paused）", async () => {
    const r = await __executeDgoalCheckForTest({ phaseId: 1 });
    const body = text(r);
    expect(body).toContain("没有进行中的");
    expect(body).not.toMatch(/\/dgoal resume/);
  });

  test("active goal: dgoal_plan list 正常工作（paused 改动不破坏 active 路径）", async () => {
    __setGoalForTest(ACTIVE);
    const r = await __executeDgoalPlanForTest({ action: "list" });
    const body = text(r);
    expect(body).toContain("待办");
    expect(body).not.toContain("没有进行中的");
  });
});
