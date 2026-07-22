// 双层活性反馈环：无工具硬熔断 + 有活动但无持久进展软熔断。
// 判定只消费宿主结构化事件，不读取 LLM 文本或 bash 命令语义。
import { describe, expect, test } from "bun:test";

import {
  buildContinuationProgressNudge,
  decideNoProgressPause,
  MAX_NO_PROGRESS_TURNS,
  MAX_STALLED_PROGRESS_TURNS,
} from "../index.ts";

describe("验收 1 · 无进展续跑熔断判定（纯函数）", () => {
  test("持久进展：两类计数都清零", () => {
    const result = decideNoProgressPause({
      hadToolExecution: true,
      hadDurableProgress: true,
      consecutiveNoProgress: 2,
      consecutiveNoDurableProgress: 7,
    });
    expect(result).toMatchObject({ pause: false, newCount: 0, newNoDurableProgressCount: 0 });
  });

  test("只有工具活动：硬计数清零，软停滞继续累计", () => {
    const result = decideNoProgressPause({
      hadToolExecution: true,
      hadDurableProgress: false,
      consecutiveNoProgress: 2,
      consecutiveNoDurableProgress: 3,
    });
    expect(result).toMatchObject({ pause: false, newCount: 0, newNoDurableProgressCount: 4 });
  });

  test("完全空转：两类计数同时累计", () => {
    const result = decideNoProgressPause({
      hadToolExecution: false,
      hadDurableProgress: false,
      consecutiveNoProgress: 1,
      consecutiveNoDurableProgress: 1,
    });
    expect(result).toMatchObject({ pause: false, newCount: 2, newNoDurableProgressCount: 2 });
  });

  test("连续 3 轮无工具优先触发硬熔断", () => {
    const result = decideNoProgressPause({
      hadToolExecution: false,
      hadDurableProgress: false,
      consecutiveNoProgress: MAX_NO_PROGRESS_TURNS - 1,
      consecutiveNoDurableProgress: MAX_STALLED_PROGRESS_TURNS - 1,
    });
    expect(result).toMatchObject({ pause: true, pauseKind: "no_tool" });
  });

  test("连续 8 轮仅活动触发软熔断", () => {
    const result = decideNoProgressPause({
      hadToolExecution: true,
      hadDurableProgress: false,
      consecutiveNoProgress: 0,
      consecutiveNoDurableProgress: MAX_STALLED_PROGRESS_TURNS - 1,
    });
    expect(result).toMatchObject({ pause: true, pauseKind: "activity_only" });
  });

  test("动态续跑提示只依据计数升级", () => {
    expect(buildContinuationProgressNudge(1, 1)).toContain("上一轮没有调用工具");
    expect(buildContinuationProgressNudge(2, 2)).toContain("结构化暂停");
    expect(buildContinuationProgressNudge(0, 4)).toContain("不要重复读取");
    expect(buildContinuationProgressNudge(0, 0)).toBe("");
  });

  test("阈值常量明确", () => {
    expect(MAX_NO_PROGRESS_TURNS).toBe(3);
    expect(MAX_STALLED_PROGRESS_TURNS).toBe(8);
  });
});
