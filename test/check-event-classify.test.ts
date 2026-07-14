// v0.5.2 切片4 · 事件流化审核器的事件识别纯函数测试
// 见 doc/40-版本实施方案/41-v0.5.2-建检反馈闭环增强实施方案.md
// 关键：thinking/toolcall 事件被正确识别为活性，不再被误判为空闲超时
import { afterEach, describe, expect, test } from "bun:test";
import { __setI18nForTest, classifyCheckEvent, CHECK_IDLE_TIMEOUT_SECONDS, CHECK_TOOL_IDLE_TIMEOUT_SECONDS, GOAL_AUDIT_TOTAL_TIMEOUT_SECONDS, PHASE_AUDIT_TOTAL_TIMEOUT_SECONDS, formatCheckLivenessLine, getAuditTotalTimeoutMs, getCheckIdleTimeoutMs, isAuditorError, runCheckWithRetry, summarizeCheckProgress, type AuditorResult } from "../index.ts";

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

  test("tool_execution 事件保持工具执行活性，避免长 bash 被误判为模型空闲", () => {
    const start = classifyCheckEvent(JSON.stringify({ type: "tool_execution_start", toolName: "bash" }));
    const update = classifyCheckEvent(JSON.stringify({ type: "tool_execution_update", toolName: "bash" }));
    const end = classifyCheckEvent(JSON.stringify({ type: "tool_execution_end", toolName: "bash" }));
    expect(start).toEqual(expect.objectContaining({ liveness: "tool_running", toolName: "bash" }));
    expect(update).toEqual(expect.objectContaining({ liveness: "tool_running", toolName: "bash" }));
    expect(end).toEqual(expect.objectContaining({ liveness: "thinking", toolName: "bash" }));
  });

  test("message_end 提取完整 text 并标记 isMessageEnd", () => {
    const r = classifyCheckEvent(messageEnd("## 验收结论\n<APPROVED>"));
    expect(r?.liveness).toBe("report_streaming");
    expect(r?.isMessageEnd).toBe(true);
    expect(r?.text).toContain("<APPROVED>");
  });

  test("message_end 只从结构化 diagnostics 提取可回退错误，不猜 errorMessage 文本", () => {
    const structured = classifyCheckEvent(JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        content: [],
        stopReason: "error",
        errorMessage: "upstream rate limited",
        diagnostics: [{ type: "provider_failure", error: { code: 429 } }],
      },
    }));
    expect(structured?.errorInfo).toEqual({ kind: "http", status: 429 });

    const strictProviderEnvelope = classifyCheckEvent(JSON.stringify({
      type: "message_end",
      message: { role: "assistant", content: [], stopReason: "error", errorMessage: "401: {\"code\":\"401\",\"message\":\"invalid key\"}" },
    }));
    expect(strictProviderEnvelope?.errorInfo).toEqual({ kind: "http", status: 401 });

    const textOnly = classifyCheckEvent(JSON.stringify({
      type: "message_end",
      message: { role: "assistant", content: [], stopReason: "error", errorMessage: "HTTP 429 rate limited" },
    }));
    expect(textOnly?.errorInfo).toBeUndefined();
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
      JSON.stringify({ type: "tool_execution_start", toolName: "bash" }),
      JSON.stringify({ type: "tool_execution_update", toolName: "bash" }),
      JSON.stringify({ type: "tool_execution_end", toolName: "bash" }),
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
  test("模型空闲为 180 秒，工具执行扩展到 1800 秒", () => {
    expect(CHECK_IDLE_TIMEOUT_SECONDS).toBe(180);
    expect(CHECK_TOOL_IDLE_TIMEOUT_SECONDS).toBe(1_800);
    expect(getCheckIdleTimeoutMs("thinking", CHECK_IDLE_TIMEOUT_SECONDS * 1_000)).toBe(180_000);
    expect(getCheckIdleTimeoutMs("tool_running", CHECK_IDLE_TIMEOUT_SECONDS * 1_000)).toBe(1_800_000);
  });

  test("phase 与 goal 使用不同的整轮审核预算", () => {
    expect(PHASE_AUDIT_TOTAL_TIMEOUT_SECONDS).toBe(900);
    expect(GOAL_AUDIT_TOTAL_TIMEOUT_SECONDS).toBe(1_800);
    expect(getAuditTotalTimeoutMs("phase")).toBe(900_000);
    expect(getAuditTotalTimeoutMs("goal")).toBe(1_800_000);
  });
});

describe("v0.5.2 · 结果三态与 auditor_error 重试", () => {
  test("isAuditorError：approved 或明确 REJECTED 不是异常；缺终止标记的部分输出、aborted/error/无输出是异常", () => {
    expect(isAuditorError({ approved: true, aborted: false, output: "ok" })).toBe(false);
    expect(isAuditorError({ approved: false, aborted: false, output: "## 报告\n<REJECTED>" })).toBe(false);
    expect(isAuditorError({ approved: false, aborted: false, output: "## 未完成报告" })).toBe(true);
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

  test("runCheckWithRetry：明确 rejected 立即返回，不重试", async () => {
    let calls = 0;
    const result = await runCheckWithRetry({
      run: async () => { calls++; return { approved: false, aborted: false, output: "未通过报告\n<REJECTED>" } as AuditorResult; },
    });
    expect(calls).toBe(1);
    expect(result.approved).toBe(false);
    expect(result.output).toBe("未通过报告\n<REJECTED>");
  });

  test("runCheckWithRetry：单候选技术错误只调用一次后返回 auditor_error", async () => {
    let calls = 0;
    const result = await runCheckWithRetry({
      run: async () => { calls++; return { approved: false, aborted: false, output: "", error: "timeout" } as AuditorResult; },
    });
    expect(calls).toBe(1);
    expect(result.liveness).toBe("auditor_error");
    expect(result.error).toBe("timeout");
  });

  test("runCheckWithRetry：候选 1 故障后候选 2 给出结论", async () => {
    const calls: string[] = [];
    const result = await runCheckWithRetry({
      modelIds: ["primary/model", "backup/model"],
      run: async (modelId) => {
        calls.push(modelId!);
        if (modelId === "primary/model") return { approved: false, aborted: false, output: "", error: "timeout" } as AuditorResult;
        return { approved: true, aborted: false, output: "<APPROVED>" } as AuditorResult;
      },
    });
    expect(calls).toEqual(["primary/model", "backup/model"]);
    expect(result.approved).toBe(true);
  });
});

describe("v0.5.2 · 建检运行时文案 i18n", () => {
  test("formatCheckLivenessLine 默认中文：思考中 + 空闲倒计时", () => {
    expect(formatCheckLivenessLine({ liveness: "thinking", idleLeft: 173, idleTotal: 180 })).toBe("[思考中] · 空闲 173s/180s");
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
    expect(formatCheckLivenessLine({ liveness: "thinking", idleLeft: 173, idleTotal: 180 })).toBe("[thinking] · idle 173s/180s");
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

  test("runCheckWithRetry 的候选切换文案可被英文 i18n 覆盖", async () => {
    __setI18nForTest({
      t: (key: string, params?: Record<string, string | number>) =>
        key === "dgoal.tool.check.candidateFallback" ? `[fallback ${params?.from}->${params?.to}]` : undefined,
    });
    const texts: string[] = [];
    await runCheckWithRetry({
      modelIds: ["primary/model", "backup/model"],
      run: async (modelId) => modelId === "primary/model"
        ? { approved: false, aborted: false, output: "", error: "timeout" }
        : { approved: true, aborted: false, output: "<APPROVED>" },
      onUpdate: (u) => texts.push(String(u.content?.[0]?.text ?? "")),
    });
    expect(texts[0]).toBe("[fallback primary/model->backup/model]");
  });
});
