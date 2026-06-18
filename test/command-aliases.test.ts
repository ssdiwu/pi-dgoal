import { describe, expect, test } from "bun:test";

import { __parseCommandForTest } from "../index.ts";

describe("/dgoal command aliases", () => {
  test("status supports empty input, full word, and single-letter alias", () => {
    expect(__parseCommandForTest("")).toEqual({ kind: "status" });
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
