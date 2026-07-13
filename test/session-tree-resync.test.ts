// session_tree 事件重同步测试。
// 根因：/tree（navigateTree）原地切 session 分支，不发 session_start，只发 session_tree。
// pi-dgoal 此前未监听 session_tree，导致 currentGoal 停在旧分支、overlay 显示陈旧状态
// （阶段明明完成了还显示未完成，计时器也冻住）。修复：session_start / session_tree 共用 resyncGoalFromSession。
import { describe, expect, test } from "bun:test";

import {
  __getGoalForTest,
  __resetGoalForTest,
  __setGoalForTest,
  resyncGoalFromSession,
  type GoalState,
  type Phase,
  type Task,
  type TaskPlan,
} from "../index.ts";

function task(id: number, subject: string, status: Task["status"] = "pending"): Task {
  return { id, subject, status };
}
function phase(id: number, subject: string, tasks: Task[], status: Phase["status"] = "pending"): Phase {
  return { id, subject, tasks, status };
}
function makeGoal(overrides: Partial<GoalState> = {}): GoalState {
  const plan: TaskPlan = { phases: [phase(1, "p1", [task(1, "a")])], nextId: 2 };
  return {
    id: "g1",
    objective: "测目标",
    status: "active",
    startedAt: 1,
    updatedAt: 1,
    iteration: 0,
    plan,
    ...overrides,
  };
}

function makeCtx(entries: Array<{ type?: string; customType?: string; data?: unknown }>, ui?: Partial<{ setStatus: () => void }>) {
  return {
    cwd: "/tmp",
    ui: { confirm: async () => true, notify: () => {}, setStatus: ui?.setStatus ?? (() => {}) },
    sessionManager: { getBranch: () => entries },
  };
}

function dgoalEntry(goal: GoalState) {
  return { type: "custom", customType: "dgoal-goal-vnext", data: { goal } };
}

describe("session_tree 重同步（resyncGoalFromSession）", () => {
  test("tree 到含更新 goal 状态的分支 → currentGoal 反映新分支状态", () => {
    __resetGoalForTest();
    // tree 之前：currentGoal 是旧状态（phase 1 pending）
    const staleGoal = makeGoal();
    __setGoalForTest(staleGoal);

    // tree 之后：新分支的 goal 已推进（phase 1 completed，task done）
    const newGoal = makeGoal({
      plan: { phases: [phase(1, "p1", [task(1, "a", "done")], "completed")], nextId: 2 },
      updatedAt: 999,
    });
    resyncGoalFromSession(makeCtx([dgoalEntry(newGoal)]) as never);

    // currentGoal 应被重新 load 成新分支的状态（不再停在 staleGoal）
    const after = __getGoalForTest();
    expect(after).not.toBe(staleGoal);
    expect(after?.updatedAt).toBe(999);
    expect(after?.plan?.phases[0].status).toBe("completed");
    expect(after?.plan?.phases[0].tasks[0].status).toBe("done");
  });

  test("tree 到无 goal 的分支 → currentGoal 清空", () => {
    __resetGoalForTest();
    __setGoalForTest(makeGoal()); // tree 之前有 goal

    resyncGoalFromSession(makeCtx([]) as never); // 新分支无 dgoal-goal-vnext entry

    expect(__getGoalForTest()).toBeUndefined();
  });

  test("tree 到 done 状态 goal 的分支 → 不恢复（loadGoal 沿用既有行为）", () => {
    __resetGoalForTest();
    __setGoalForTest(makeGoal());

    const doneGoal = makeGoal({ status: "done" });
    resyncGoalFromSession(makeCtx([dgoalEntry(doneGoal)]) as never);

    // done/pending 状态 loadGoal 不返回 → currentGoal 清空
    expect(__getGoalForTest()).toBeUndefined();
  });

  test("UI 抛错不阻断状态重同步（TUI 边界防护）", () => {
    __resetGoalForTest();
    const newGoal = makeGoal({ updatedAt: 555 });
    // setStatus 抛错模拟 TUI 渲染崩溃（如 Spacer is not defined）
    const ctx = {
      cwd: "/tmp",
      ui: { confirm: async () => true, notify: () => {}, setStatus: () => { throw new Error("TUI boom"); } },
      sessionManager: { getBranch: () => [dgoalEntry(newGoal)] },
    };
    // 不应抛出——currentGoal 已在 setStatus 之前 load 完
    expect(() => resyncGoalFromSession(ctx as never)).not.toThrow();
    expect(__getGoalForTest()?.updatedAt).toBe(555);
  });
});
