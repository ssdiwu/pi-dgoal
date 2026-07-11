// 验收 1 反馈环：连续 N 轮无工具调用自动暂停续跑，可观察推进重置计数。
// agent_end 是事件处理器；核心判定逻辑抽成纯函数 decideNoProgressPause 供测试。
import { describe, expect, test } from "bun:test";

import { decideNoProgressPause, MAX_NO_PROGRESS_TURNS } from "../index.ts";

describe("验收 1 · 无进展续跑熔断判定（纯函数）", () => {
  test("有工具调用：计数清零，不暂停", () => {
    const r = decideNoProgressPause({ hadToolExecution: true, consecutiveNoProgress: 2 });
    expect(r.pause).toBe(false);
    expect(r.newCount).toBe(0);
  });

  test("无工具调用、未达阈值：计数+1，不暂停", () => {
    const r = decideNoProgressPause({ hadToolExecution: false, consecutiveNoProgress: 1 });
    expect(r.pause).toBe(false);
    expect(r.newCount).toBe(2);
  });

  test("无工具调用、达到阈值（3 轮）：暂停", () => {
    const r = decideNoProgressPause({ hadToolExecution: false, consecutiveNoProgress: MAX_NO_PROGRESS_TURNS - 1 });
    expect(r.pause).toBe(true);
    expect(r.newCount).toBe(MAX_NO_PROGRESS_TURNS);
  });

  test("阈值后一轮仍无工具：保持暂停", () => {
    const r = decideNoProgressPause({ hadToolExecution: false, consecutiveNoProgress: MAX_NO_PROGRESS_TURNS });
    expect(r.pause).toBe(true);
  });

  test("暂停后恢复工具调用：计数清零", () => {
    const r = decideNoProgressPause({ hadToolExecution: true, consecutiveNoProgress: MAX_NO_PROGRESS_TURNS });
    expect(r.pause).toBe(false);
    expect(r.newCount).toBe(0);
  });

  test("阈值常量明确（=3）", () => {
    expect(MAX_NO_PROGRESS_TURNS).toBe(3);
  });
});
