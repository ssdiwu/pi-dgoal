import { describe, expect, test } from "bun:test";

import { __parseCommandForTest, __setI18nForTest, __startGoalForTest, buildProposePrompt, BARE_START_OBJECTIVE, type LoopGoal } from "../index.ts";

describe("/dgoal command aliases", () => {
  test("status uses full word and single-letter alias; bare /dgoal now starts (承接前文)", () => {
    // v0.5.2 切片8：裸 /dgoal（空 args）走启动闸门承接前文，不再落到 status
    expect(__parseCommandForTest("")).toEqual({ kind: "start", objective: "" });
    expect(__parseCommandForTest("status")).toEqual({ kind: "status" });
    expect(__parseCommandForTest("s")).toEqual({ kind: "status" });
  });

  test("pause/resume/clear support full word and single-letter aliases", () => {
    expect(__parseCommandForTest("pause")).toEqual({ kind: "pause" });
    expect(__parseCommandForTest("p")).toEqual({ kind: "pause" });
    expect(__parseCommandForTest("resume")).toEqual({ kind: "resume" });
    expect(__parseCommandForTest("r")).toEqual({ kind: "resume" });
    expect(__parseCommandForTest("clear")).toEqual({ kind: "clear" });
    expect(__parseCommandForTest("c")).toEqual({ kind: "clear" });
  });

  test("stop is no longer treated as clear", () => {
    expect(__parseCommandForTest("stop")).toEqual({ kind: "start", objective: "stop" });
  });
});

describe("v0.5.2 切片8 · 裸 /dgoal 承接前文启动", () => {
  test("buildProposePrompt 承接版：objective 为占位时发承接指令，要求 agent 归纳 objective", () => {
    const goal: LoopGoal = {
      id: "g", objective: BARE_START_OBJECTIVE, status: "pending",
      startedAt: 1, updatedAt: 1, iteration: 0,
      contextSummary: "前文讨论了对齐的方案",
    } as LoopGoal;
    const prompt = buildProposePrompt(goal);
    expect(prompt).toContain("承接前文");
    expect(prompt).toContain("归纳");
    expect(prompt).toContain("objective 必须是你归纳出的明确目标");
    expect(prompt).toContain("前文讨论了对齐的方案");
  });

  test("buildProposePrompt 普通版：objective 明确时不发承接指令", () => {
    const goal: LoopGoal = {
      id: "g", objective: "修好测试", status: "pending",
      startedAt: 1, updatedAt: 1, iteration: 0,
    } as LoopGoal;
    const prompt = buildProposePrompt(goal);
    expect(prompt).toContain("修好测试");
    expect(prompt).not.toContain("承接前文");
    expect(prompt).not.toContain("归纳");
  });

  test("裸 /dgoal 无前文可承接时：只提示，不硬启动 pending goal", async () => {
    const notes: string[] = [];
    const writes: unknown[] = [];
    const ctx = {
      sessionManager: { getEntries: () => [] },
      ui: {
        notify: (msg: string) => notes.push(msg),
        setStatus: () => { throw new Error("should not set status"); },
      },
    } as never;
    const pi = { appendEntry: (...args: unknown[]) => writes.push(args) } as never;
    await __startGoalForTest("", pi, ctx);
    expect(notes.at(-1)).toContain("无前文共识可承接");
    expect(writes).toHaveLength(0);
  });

  test("裸 /dgoal 无前文提示走 i18n：英文 bundle 可覆盖", async () => {
    __setI18nForTest({
      t: (key: string) => key.endsWith(".notify.noPriorDiscussionForBareStart")
        ? "There is no prior aligned discussion to carry."
        : undefined,
    });
    try {
      const notes: string[] = [];
      const ctx = {
        sessionManager: { getEntries: () => [] },
        ui: {
          notify: (msg: string) => notes.push(msg),
          setStatus: () => {},
        },
      } as never;
      await __startGoalForTest("", {} as never, ctx);
      expect(notes.at(-1)).toBe("There is no prior aligned discussion to carry.");
    } finally {
      __setI18nForTest(undefined);
    }
  });
});
