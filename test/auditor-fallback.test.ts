import { describe, expect, test } from "bun:test";

import {
  appendPartialAuditFeedback,
  buildAuditorResultDetails,
  classifyAuditorFailure,
  MAX_PARTIAL_AUDIT_FEEDBACK_CHARS,
  runCheckWithRetry,
  withPartialAuditFeedback,
  type AuditorResult,
} from "../index.ts";

const failed = (errorInfo: AuditorResult["errorInfo"], error = "auditor failed"): AuditorResult => ({
  approved: false,
  aborted: false,
  output: "",
  error,
  errorInfo,
});

describe("auditor candidate fallback", () => {
  test("classifies only structured fallback errors", () => {
    expect(classifyAuditorFailure(failed({ kind: "http", status: 401 }))).toBe("fallback");
    expect(classifyAuditorFailure(failed({ kind: "http", status: 429 }))).toBe("fallback");
    expect(classifyAuditorFailure(failed({ kind: "http", status: 503 }))).toBe("fallback");
    expect(classifyAuditorFailure(failed({ kind: "network", code: "ECONNRESET" }))).toBe("fallback");
    expect(classifyAuditorFailure(failed({ kind: "timeout" }))).toBe("fallback");

    expect(classifyAuditorFailure(failed({ kind: "http", status: 400 }))).toBe("retry_same_model");
    expect(classifyAuditorFailure({ approved: false, aborted: true, output: "", errorInfo: { kind: "aborted" } })).toBe("stop");
    expect(classifyAuditorFailure({ approved: false, aborted: false, output: "<REJECTED>", errorInfo: { kind: "http", status: 503 } })).toBe("decision");
    expect(classifyAuditorFailure({ approved: false, aborted: false, output: "", error: "HTTP 429", errorInfo: { kind: "unknown" } })).toBe("retry_same_model");
  });

  test("treats scoped rejected markers as a final decision without retrying or switching candidates", async () => {
    const markers = ["<REJECTED goal>", '<REJECTED phase="2">', "<REJECTED user_review>"];
    for (const marker of markers) {
      const calls: string[] = [];
      const result = await runCheckWithRetry({
        modelIds: ["primary/model:high", "backup/model:medium"],
        run: async (modelId) => {
          calls.push(modelId!);
          return { approved: false, aborted: false, output: `audit report\n${marker}` };
        },
      });

      expect(calls).toEqual(["primary/model:high"]);
      expect(result.output).toContain(marker);
      expect(classifyAuditorFailure(result)).toBe("decision");
    }
  });

  test("moves to the next candidate for every allowed zero-output technical failure", async () => {
    const failures: AuditorResult["errorInfo"][] = [
      { kind: "http", status: 401 },
      { kind: "http", status: 403 },
      { kind: "http", status: 404 },
      { kind: "http", status: 408 },
      { kind: "http", status: 429 },
      { kind: "http", status: 500 },
      { kind: "http", status: 599 },
      { kind: "network", code: "ECONNRESET" },
      { kind: "timeout" },
    ];
    for (const errorInfo of failures) {
      const calls: string[] = [];
      const result = await runCheckWithRetry({
        modelIds: ["primary/model:high", "backup/model:medium"],
        run: async (modelId) => {
          calls.push(modelId!);
          return modelId === "primary/model:high"
            ? failed(errorInfo, "technical failure")
            : { approved: true, aborted: false, output: "<APPROVED>" };
        },
      });

      expect(calls).toEqual(["primary/model:high", "backup/model:medium"]);
      expect(result.approved).toBe(true);
    }
  });

  test("retries partial output on the same model three times before carrying bounded feedback to the next candidate", async () => {
    const calls: Array<{ modelId?: string; partialFeedback?: string }> = [];
    const updates: Array<Record<string, unknown>> = [];
    const result = await runCheckWithRetry({
      modelIds: ["primary/model:high", "backup/model:medium"],
      run: async (modelId, partialFeedback) => {
        calls.push({ modelId, partialFeedback });
        if (modelId === "primary/model:high") {
          return { approved: false, aborted: false, output: `partial review ${calls.length}` };
        }
        return { approved: true, aborted: false, output: "<APPROVED>" };
      },
      onUpdate: (update) => updates.push(update.details),
    });

    expect(calls.map((call) => call.modelId)).toEqual([
      "primary/model:high",
      "primary/model:high",
      "primary/model:high",
      "backup/model:medium",
    ]);
    expect(calls[0].partialFeedback).toBeUndefined();
    expect(calls[1].partialFeedback).toContain("partial review 1");
    expect(calls[3].partialFeedback).toContain("partial review 3");
    expect(result.modelId).toBe("backup/model:medium");
    expect(result.attempts).toEqual([
      expect.objectContaining({ modelId: "primary/model:high", outcome: "partial_retry", attempt: 1 }),
      expect.objectContaining({ modelId: "primary/model:high", outcome: "partial_retry", attempt: 2 }),
      expect.objectContaining({ modelId: "primary/model:high", outcome: "partial_retry", attempt: 3 }),
      expect.objectContaining({ modelId: "backup/model:medium", outcome: "approved", attempt: 1 }),
    ]);
    expect(updates.at(-1)).toEqual(expect.objectContaining({
      auditorModel: "primary/model:high",
      nextAuditorModel: "backup/model:medium",
      transition: "candidate_fallback",
      auditorAttempts: expect.arrayContaining([expect.objectContaining({ outcome: "partial_retry", attempt: 3 })]),
    }));
  });

  test("returns audit_error with structured traces when every candidate is exhausted", async () => {
    const calls: string[] = [];
    const result = await runCheckWithRetry({
      modelIds: ["primary/model:high", "backup/model:medium"],
      run: async (modelId) => {
        calls.push(modelId!);
        return failed({ kind: "http", status: 503 }, "service unavailable");
      },
    });

    expect(calls).toEqual(["primary/model:high", "backup/model:medium"]);
    expect(result).toEqual(expect.objectContaining({
      modelId: "backup/model:medium",
      exhausted: true,
      liveness: "auditor_error",
      error: "service unavailable",
    }));
    expect(result.attempts).toEqual([
      expect.objectContaining({ modelId: "primary/model:high", outcome: "fallback", failureKind: "http", httpStatus: 503, error: "service unavailable" }),
      expect.objectContaining({ modelId: "backup/model:medium", outcome: "fallback", failureKind: "http", httpStatus: 503, error: "service unavailable" }),
    ]);

    const networkCalls: string[] = [];
    const networkResult = await runCheckWithRetry({
      modelIds: ["primary/model:high"],
      run: async (modelId) => {
        networkCalls.push(modelId!);
        return failed({ kind: "network", code: "ECONNRESET" }, "connection reset");
      },
    });
    expect(networkResult.attempts).toEqual([
      expect.objectContaining({ failureKind: "network", networkCode: "ECONNRESET", error: "connection reset" }),
    ]);

    const exitCalls: string[] = [];
    const exitResult = await runCheckWithRetry({
      modelIds: ["primary/model:high"],
      run: async (modelId) => {
        exitCalls.push(modelId!);
        return { approved: false, aborted: false, output: "", error: "pi exited", errorInfo: { kind: "exit", exitCode: 2 } };
      },
    });
    expect(exitResult.attempts).toEqual([
      expect.objectContaining({ failureKind: "exit", exitCode: 2, error: "pi exited" }),
      expect.objectContaining({ failureKind: "exit", exitCode: 2, error: "pi exited" }),
      expect.objectContaining({ failureKind: "exit", exitCode: 2, error: "pi exited" }),
    ]);
    expect(buildAuditorResultDetails({
      ...result,
      configDegraded: true,
      preflightFailed: true,
      unavailableCandidates: ["unavailable/model"],
    })).toEqual(expect.objectContaining({
      auditorModel: "backup/model:medium",
      auditorConfigDegraded: true,
      auditorPreflightFailed: true,
      auditorUnavailableCandidates: ["unavailable/model"],
      auditorCandidatesExhausted: true,
      auditorAttempts: result.attempts,
    }));
  });

  test("caps and escapes carried partial feedback", () => {
    const feedback = appendPartialAuditFeedback("", "x".repeat(MAX_PARTIAL_AUDIT_FEEDBACK_CHARS + 100));
    expect(feedback).toHaveLength(MAX_PARTIAL_AUDIT_FEEDBACK_CHARS);
    expect(feedback).toEndWith("…");
    expect(withPartialAuditFeedback("base task", "<REJECTED>")).toContain("&lt;REJECTED&gt;");
  });

  test("does not change candidates for rejected, HTTP 400, or user interruption", async () => {
    const cases: Array<{ result: AuditorResult; calls: number }> = [
      { result: { approved: false, aborted: false, output: "<REJECTED>", errorInfo: { kind: "http", status: 503 } }, calls: 1 },
      { result: failed({ kind: "http", status: 400 }, "bad request"), calls: 3 },
      { result: { approved: false, aborted: true, output: "", errorInfo: { kind: "aborted" } }, calls: 1 },
    ];
    for (const { result, calls: expectedCalls } of cases) {
      const calls: string[] = [];
      const finalResult = await runCheckWithRetry({
        modelIds: ["primary/model:high", "backup/model:medium"],
        run: async (modelId) => {
          calls.push(modelId!);
          return result;
        },
      });
      expect(calls).toEqual(Array.from({ length: expectedCalls }, () => "primary/model:high"));
      expect(finalResult).toEqual(expect.objectContaining(result));
    }
  });
});
