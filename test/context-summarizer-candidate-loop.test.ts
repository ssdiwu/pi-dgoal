// ADR 0033 removed the independent context-summarizer candidate loop.
import { describe, expect, test } from "bun:test";
import { resolveContextSummarizerModelCandidates } from "../index.ts";

describe("背景摘要候选链已移除（ADR 0033）", () => {
  test("兼容 helper 仅返回当前会话模型，不读取配置候选", async () => {
    expect(await resolveContextSummarizerModelCandidates({ model: { provider: "openai", id: "gpt-5" } })).toEqual(["openai/gpt-5"]);
  });
});
