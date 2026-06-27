// v0.5.2 切片4 · 事件流化审核器的事件识别纯函数测试
// 见 doc/40-版本实施方案/41-v0.5.2-建检反馈闭环增强实施方案.md
// 关键：thinking/toolcall 事件被正确识别为活性，不再被误判为空闲超时
import { afterEach, describe, expect, test } from "bun:test";
import { __setI18nForTest, classifyCheckEvent, CHECK_IDLE_TIMEOUT_SECONDS, formatCheckLivenessLine, isAuditorError, runCheckWithRetry, summarizeCheckProgress, type AuditorResult } from "../index.ts";

const msg = (type: string, evt: Record<string, unknown>) =>
  JSON.stringify({ type, assistantMessageEvent: evt });

const messageEnd = (text: string) =>
  JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }] } });

afterEach(() => {
  __setI18nForTest(undefined);
});

describe("v0.5.2 · classifyCheckEvent 事件识别", () => {
  test("thinking_start/delta/end 都识别为 thinking 活性", () => {
    expect(classifyCheckEvent(msg("message_update", { type: "thinking_start" }))?.liveness).toBe("thinking");
    expect(classifyCheckEvent(msg("message_update", { type: "thinking_delta", delta: "..." }))?.liveness).toBe("thinking");
    expect(classifyCheckEvent(msg("message_update", { type: "thinking_end" }))?.liveness).toBe("thinking");
  });

  test("toolcall_start/delta/end 都识别为 tool_running 活性，并带 toolName", () => {
    expect(classifyCheckEvent(msg("message_update", { type: "toolcall_start" }))?.liveness).toBe("tool_running");
    const withName = classifyCheckEvent(msg("message_update", { type: "toolcall_start", toolName: "read" }));
    expect(withName?.liveness).toBe("tool_running");
    expect(withName?.toolName).toBe("read");
    expect(classifyCheckEvent(msg("message_update", { type: "toolcall_delta", toolName: "bash" }))?.toolName).toBe("bash");
    expect(classifyCheckEvent(msg("message_update", { type: "toolcall_end" }))?.liveness).toBe("tool_running");
  });

  test("text_delta 识别为 report_streaming 并带 delta", () => {
    const r = classifyCheckEvent(msg("message_update", { type: "text_delta", delta: "## 验收" }));
    expect(r?.liveness).toBe("report_streaming");
    expect(r?.delta).toBe("## 验收");
  });

  test("message_end 提取完整 text 并标记 isMessageEnd", () => {
    const r = classifyCheckEvent(messageEnd("## 验收结论\n<APPROVED>"));
    expect(r?.liveness).toBe("report_streaming");
    expect(r?.isMessageEnd).toBe(true);
    expect(r?.text).toContain("<APPROVED>");
  });

  test("空行返回 null", () => {
    expect(classifyCheckEvent("")).toBeNull();
    expect(classifyCheckEvent("   ")).toBeNull();
  });

  test("非 JSON 行返回 null（不抛）", () => {
    expect(classifyCheckEvent("not a json line")).toBeNull();
  });

  test("未识别的 event.type 返回 null", () => {
    expect(classifyCheckEvent(JSON.stringify({ type: "unknown_event" }))).toBeNull();
    expect(classifyCheckEvent(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "weird_type" } }))).toBeNull();
  });

  test("覆盖所有有效事件类型——任一都应返回非 null（重置 idle timer 的依据）", () => {
    const events = [
      msg("message_update", { type: "thinking_start" }),
      msg("message_update", { type: "thinking_delta" }),
      msg("message_update", { type: "thinking_end" }),
      msg("message_update", { type: "toolcall_start" }),
      msg("message_update", { type: "toolcall_delta" }),
      msg("message_update", { type: "toolcall_end" }),
      msg("message_update", { type: "text_delta", delta: "x" }),
      messageEnd("final"),
    ];
    for (const e of events) {
      expect(classifyCheckEvent(e)).not.toBeNull();
    }
  });
});

describe("v0.5.2 · 超时秒单位与可见倍计时口径", () => {
  test("CHECK_IDLE_TIMEOUT_SECONDS 以秒为单位，值为 120（未来可下调，本版 2 分钟）", () => {
    expect(CHECK_IDLE_TIMEOUT_SECONDS).toBe(120);
    expect(typeof CHECK_IDLE_TIMEOUT_SECONDS).toBe("number");
  });
});

describe("v0.5.2 · 结果三态与 auditor_error 重试", () => {
  test("isAuditorError：approved 不是异常；有报告无 error 的 rejected 不是异常；aborted/error/无输出是异常", () => {
    expect(isAuditorError({ approved: true, aborted: false, output: "ok" })).toBe(false);
    expect(isAuditorError({ approved: false, aborted: false, output: "## 报告" })).toBe(false);
    expect(isAuditorError({ approved: false, aborted: true, output: "" })).toBe(true);
    expect(isAuditorError({ approved: false, aborted: false, output: "", error: "timeout" })).toBe(true);
    expect(isAuditorError({ approved: false, aborted: false, output: "", error: "启动失败" })).toBe(true);
  });

  test("runCheckWithRetry：approved 立即返回，不重试", async () => {
    let calls = 0;
    const result = await runCheckWithRetry({
      run: async () => { calls++; return { approved: true, aborted: false, output: "通过" } as AuditorResult; },
    });
    expect(calls).toBe(1);
    expect(result.approved).toBe(true);
  });

  test("runCheckWithRetry：rejected 立即返回，不重试", async () => {
    let calls = 0;
    const result = await runCheckWithRetry({
      run: async () => { calls++; return { approved: false, aborted: false, output: "未通过报告" } as AuditorResult; },
    });
    expect(calls).toBe(1);
    expect(result.approved).toBe(false);
    expect(result.output).toBe("未通过报告");
  });

  test("runCheckWithRetry：auditor_error 重试 3 次全失败才返回，liveness=auditor_error", async () => {
    let calls = 0;
    const updates: Array<{ attempt?: number; liveness?: string }> = [];
    const result = await runCheckWithRetry({
      run: async () => { calls++; return { approved: false, aborted: false, output: "", error: `timeout#${calls}` } as AuditorResult; },
      onUpdate: (u) => { updates.push(u.details as { attempt?: number; liveness?: string }); },
    });
    expect(calls).toBe(3); // 3 次全失败
    expect(result.liveness).toBe("auditor_error");
    expect(result.error).toBe("timeout#3");
    // 重试过程透传 attempt 次数（第 1、2 次失败后发出，第 3 次失败不再发）
    expect(updates.map((u) => u.attempt)).toEqual([1, 2]);
    expect(updates.every((u) => u.liveness === "auditor_error")).toBe(true);
  });

  test("runCheckWithRetry：前 2 次 auditor_error，第 3 次 approved → 停止重试，返回 approved", async () => {
    let calls = 0;
    const result = await runCheckWithRetry({
      run: async () => {
        calls++;
        if (calls < 3) return { approved: false, aborted: false, output: "", error: `timeout#${calls}` } as AuditorResult;
        return { approved: true, aborted: false, output: "通过" } as AuditorResult;
      },
    });
    expect(calls).toBe(3);
    expect(result.approved).toBe(true);
  });
});

describe("v0.5.2 · 建检运行时文案 i18n", () => {
  test("formatCheckLivenessLine 默认中文：思考中 + 空闲倒计时", () => {
    expect(formatCheckLivenessLine({ liveness: "thinking", idleLeft: 113, idleTotal: 120 })).toBe("[思考中] · 空闲 113s/120s");
  });

  test("formatCheckLivenessLine 可被英文 i18n 覆盖", () => {
    __setI18nForTest({
      t: (key: string, params?: Record<string, string | number>) => {
        const map: Record<string, string> = {
          "dgoal.check.liveness.thinking": "thinking",
          "dgoal.check.liveness.idle": `idle ${params?.left}s/${params?.total}s`,
        };
        return map[key];
      },
    });
    expect(formatCheckLivenessLine({ liveness: "thinking", idleLeft: 113, idleTotal: 120 })).toBe("[thinking] · idle 113s/120s");
  });

  test("summarizeCheckProgress 默认中文：无输出时返回占位", () => {
    expect(summarizeCheckProgress("")).toBe("(审核进行中，尚无文本输出)");
  });

  test("summarizeCheckProgress 可被英文 i18n 覆盖", () => {
    __setI18nForTest({
      t: (key: string) => key === "dgoal.check.progress.noText" ? "(audit running, no text output yet)" : undefined,
    });
    expect(summarizeCheckProgress("")).toBe("(audit running, no text output yet)");
  });

  test("runCheckWithRetry 的固定重试壳子文案可被英文 i18n 覆盖", async () => {
    __setI18nForTest({
      t: (key: string, params?: Record<string, string | number>) =>
        key === "dgoal.tool.check.retrying" ? `[auditor error · retry ${params?.attempt}/${params?.total}] ${params?.error}` : undefined,
    });
    const texts: string[] = [];
    await runCheckWithRetry({
      run: async () => ({ approved: false, aborted: false, output: "", error: "timeout" }),
      onUpdate: (u) => texts.push(String(u.content?.[0]?.text ?? "")),
    });
    expect(texts[0]).toBe("[auditor error · retry 1/3] timeout");
  });
});
