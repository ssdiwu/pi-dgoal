import { describe, expect, test } from "bun:test";

import { capPriorDiscussionText } from "../index.ts";

describe("capPriorDiscussionText", () => {
  test("does not truncate a long single message under the total cap", () => {
    const longBody = "甲".repeat(900);
    const result = capPriorDiscussionText([`[用户] ${longBody}`], 50 * 1024);

    expect(result).toContain(longBody);
    expect(result).not.toContain("Input truncated");
  });

  test("caps oversized discussion by dropping older complete messages", () => {
    const latest = `[助手] latest ${"乙".repeat(600)}`;
    const lines = Array.from({ length: 80 }, (_, index) => `[用户] message-${index} ${"丙".repeat(600)}`);
    const result = capPriorDiscussionText([...lines, latest], 50 * 1024);

    expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(50 * 1024);
    expect(result.startsWith("[Input truncated: ")).toBe(true);
    expect(result).toContain("bytes omitted");
    expect(result).toContain(latest);
  });

  test("caps a latest message that alone exceeds the total cap", () => {
    const oversizedLatest = `[用户] latest ${"丁".repeat(30_000)}`;
    const result = capPriorDiscussionText([oversizedLatest], 50 * 1024);

    expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(50 * 1024);
    expect(result.startsWith("[Input truncated: ")).toBe(true);
    expect(result).toContain("bytes omitted");
    expect(result).toContain("from latest message");
    expect(result).toContain("丁".repeat(100));
    expect(result).not.toEqual(oversizedLatest);
  });
});
