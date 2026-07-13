// 审核器配额错误（纯文本 usage limit）应触发候选回退，每个候选只尝试一次。
import { describe, expect, test } from "bun:test";

import { classifyAuditorFailure, hasQuotaErrorHint, type AuditorResult } from "../index.ts";

function result(error: string, errorInfo: AuditorResult["errorInfo"]): AuditorResult {
  return {
    approved: false,
    aborted: false,
    output: "",
    error,
    errorInfo,
    modelId: "openai-codex/gpt-5.6-sol:high",
  };
}

describe("审核器配额错误候选回退", () => {
  test("Codex usage limit exhausted 文本错误 → fallback", () => {
    const r = result("Codex error: The usage limit has been reached", { kind: "unknown" });
    expect(classifyAuditorFailure(r)).toBe("fallback");
  });

  test("quota exceeded → fallback", () => {
    const r = result("OpenAI error: Quota exceeded for current plan", { kind: "unknown" });
    expect(classifyAuditorFailure(r)).toBe("fallback");
  });

  test("rate limit exceeded → fallback；普通 rate limit 描述不回退", () => {
    expect(classifyAuditorFailure(result("Rate limit exceeded, retry later", { kind: "unknown" }))).toBe("fallback");
    expect(classifyAuditorFailure(result("rate limit is 100 requests/minute", { kind: "unknown" }))).toBe("fallback");
  });

  test("高置信 quota 文本检测", () => {
    expect(hasQuotaErrorHint("usage limit has been reached")).toBe(true);
    expect(hasQuotaErrorHint("insufficient quota")).toBe(true);
    expect(hasQuotaErrorHint("quota exceeded")).toBe(true);
    expect(hasQuotaErrorHint("you have hit your usage limit")).toBe(true);
    expect(hasQuotaErrorHint("context length exceeded")).toBe(false);
    expect(hasQuotaErrorHint("billing address invalid")).toBe(false);
    expect(hasQuotaErrorHint("credit card declined")).toBe(false);
    expect(hasQuotaErrorHint("quota field invalid")).toBe(false);
    expect(hasQuotaErrorHint("plan limit field invalid")).toBe(false);
    expect(hasQuotaErrorHint("rate limit configuration invalid")).toBe(false);
    expect(hasQuotaErrorHint("usage limit metadata missing")).toBe(false);
    expect(hasQuotaErrorHint("configuration invalid: rate limit")).toBe(false);
    expect(hasQuotaErrorHint("metadata missing - usage limit")).toBe(false);
    expect(hasQuotaErrorHint("rate limit is 100 requests/minute")).toBe(false);
    expect(hasQuotaErrorHint("configuration invalid: maximum rate limit")).toBe(false);
    expect(hasQuotaErrorHint("metadata missing: maximum usage limit")).toBe(false);
    expect(hasQuotaErrorHint("plan limit maximum field invalid")).toBe(false);
    expect(hasQuotaErrorHint("rate limit has a maximum of 100 requests/minute")).toBe(false);
    expect(hasQuotaErrorHint("rate limit configuration invalid: too many fields")).toBe(false);
    expect(hasQuotaErrorHint("usage limit metadata missing; retries exhausted")).toBe(false);
    expect(hasQuotaErrorHint("plan limit field invalid; retry budget exhausted")).toBe(false);
    expect(hasQuotaErrorHint("random network failure")).toBe(false);
    expect(hasQuotaErrorHint("")).toBe(false);
  });

  test("业务 REJECTED 不变，不回退", () => {
    const r: AuditorResult = {
      approved: false,
      aborted: false,
      output: "<REJECTED>\n some reason",
      error: "",
      errorInfo: { kind: "unknown" },
    };
    expect(classifyAuditorFailure(r)).toBe("decision");
  });

  test("未知非配额错误也只尝试一次后切候选", () => {
    const r = result("something weird happened", { kind: "unknown" });
    expect(classifyAuditorFailure(r)).toBe("fallback");
  });
});
