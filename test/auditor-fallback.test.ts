import { describe, expect, test } from "bun:test";

import {
  __getGoalForTest,
  __recordAuditorCandidateResultForTest,
  __resetGoalForTest,
  __selectAuditorCandidatesForTest,
  __setApiForTest,
  __setGoalForTest,
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
  test("persists a healthy fallback and reuses it after reload", () => {
    const writes: any[] = [];
    __setApiForTest({ appendEntry: (_type: string, data: unknown) => writes.push(data) });
    __setGoalForTest({
      id: "candidate-state",
      objective: "candidate state",
      status: "active",
      startedAt: 1,
      updatedAt: 1,
      iteration: 0,
    } as never);

    __recordAuditorCandidateResultForTest("goal", {
      approved: true,
      aborted: false,
      output: "<APPROVED>",
      modelId: "backup/model",
      attempts: [
        { modelId: "primary/model", attempt: 1, outcome: "fallback" },
        { modelId: "backup/model", attempt: 1, outcome: "approved" },
      ],
    });

    expect(__getGoalForTest()?.auditorCandidates?.goal).toEqual({
      selectedModelId: "backup/model",
      failedModelIds: ["primary/model"],
    });
    expect(writes.at(-1)?.goal?.auditorCandidates?.goal.selectedModelId).toBe("backup/model");

    const reloaded = JSON.parse(JSON.stringify(__getGoalForTest()));
    __setGoalForTest(reloaded);
    expect(__selectAuditorCandidatesForTest("goal", ["primary/model", "backup/model", "third/model"])).toEqual([
      "backup/model",
      "third/model",
    ]);
    __resetGoalForTest();
  });

  test("候选 1/2 故障后候选 3 形成结论，并在 reload 后复用候选 3", async () => {
    const writes: unknown[] = [];
    __setApiForTest({ appendEntry: (_type: string, data: unknown) => writes.push(data) });
    __setGoalForTest({
      id: "candidate-chain-3",
      objective: "candidate chain",
      status: "active",
      startedAt: 1,
      updatedAt: 1,
      iteration: 0,
    } as never);

    const firstCalls: string[] = [];
    const first = await runCheckWithRetry({
      modelIds: __selectAuditorCandidatesForTest("goal", ["candidate/1", "candidate/2", "candidate/3"]),
      run: async (modelId) => {
        firstCalls.push(modelId!);
        return modelId === "candidate/3"
          ? { approved: true, aborted: false, output: "<APPROVED>", modelId }
          : failed({ kind: "network", code: "ECONNRESET" });
      },
    });
    expect(firstCalls).toEqual(["candidate/1", "candidate/2", "candidate/3"]);
    expect(first.modelId).toBe("candidate/3");
    __recordAuditorCandidateResultForTest("goal", first);

    const reloaded = JSON.parse(JSON.stringify(__getGoalForTest()));
    __setGoalForTest(reloaded);
    const secondCalls: string[] = [];
    const second = await runCheckWithRetry({
      modelIds: __selectAuditorCandidatesForTest("goal", ["candidate/1", "candidate/2", "candidate/3"]),
      run: async (modelId) => {
        secondCalls.push(modelId!);
        return { approved: true, aborted: false, output: "<APPROVED>", modelId };
      },
    });
    expect(secondCalls).toEqual(["candidate/3"]);
    __recordAuditorCandidateResultForTest("goal", second);
    expect(__getGoalForTest()?.auditorCandidates?.goal).toEqual({
      selectedModelId: "candidate/3",
      failedModelIds: ["candidate/1", "candidate/2"],
    });
    expect(writes.length).toBeGreaterThanOrEqual(2);
    __resetGoalForTest();
  });

  test("classifies only structured fallback errors", () => {
    expect(classifyAuditorFailure(failed({ kind: "http", status: 401 }))).toBe("fallback");
    expect(classifyAuditorFailure(failed({ kind: "http", status: 429 }))).toBe("fallback");
    expect(classifyAuditorFailure(failed({ kind: "http", status: 503 }))).toBe("fallback");
    expect(classifyAuditorFailure(failed({ kind: "network", code: "ECONNRESET" }))).toBe("fallback");
    expect(classifyAuditorFailure(failed({ kind: "timeout" }))).toBe("fallback");

    expect(classifyAuditorFailure(failed({ kind: "http", status: 400 }))).toBe("fallback");
    expect(classifyAuditorFailure({ approved: false, aborted: true, output: "", errorInfo: { kind: "aborted" } })).toBe("stop");
    expect(classifyAuditorFailure({ approved: false, aborted: false, output: "<REJECTED>", errorInfo: { kind: "http", status: 503 } })).toBe("decision");
    expect(classifyAuditorFailure({ approved: true, aborted: false, output: "<APPROVED>", error: "WebSocket error", errorInfo: { kind: "network", code: "ECONNRESET" } })).toBe("decision");
    expect(classifyAuditorFailure({ approved: false, aborted: false, output: "", error: "HTTP 429", errorInfo: { kind: "unknown" } })).toBe("fallback");
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

  test("moves partial output to the next candidate without retrying the same model", async () => {
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
      "backup/model:medium",
    ]);
    expect(calls[0].partialFeedback).toBeUndefined();
    expect(calls[1].partialFeedback).toContain("partial review 1");
    expect(calls[1].partialFeedback).toContain("partial review 1");
    expect(result.modelId).toBe("backup/model:medium");
    expect(result.attempts).toEqual([
      expect.objectContaining({ modelId: "primary/model:high", outcome: "partial_retry", attempt: 1 }),
      expect.objectContaining({ modelId: "backup/model:medium", outcome: "approved", attempt: 1 }),
    ]);
    expect(updates.at(-1)).toEqual(expect.objectContaining({
      auditorModel: "primary/model:high",
      nextAuditorModel: "backup/model:medium",
      transition: "candidate_fallback",
      auditorAttempts: expect.arrayContaining([expect.objectContaining({ outcome: "partial_retry", attempt: 1 })]),
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
      expect.objectContaining({ failureKind: "exit", exitCode: 2, error: "pi exited", attempt: 1 }),
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

  test("does not change candidates for rejected, but switches once for protocol errors and stops on interruption", async () => {
    const cases: Array<{ result: AuditorResult; expectedModels: string[] }> = [
      { result: { approved: false, aborted: false, output: "<REJECTED>", errorInfo: { kind: "http", status: 503 } }, expectedModels: ["primary/model:high"] },
      { result: failed({ kind: "http", status: 400 }, "bad request"), expectedModels: ["primary/model:high", "backup/model:medium"] },
      { result: { approved: false, aborted: true, output: "", errorInfo: { kind: "aborted" } }, expectedModels: ["primary/model:high"] },
    ];
    for (const { result, expectedModels } of cases) {
      const calls: string[] = [];
      const finalResult = await runCheckWithRetry({
        modelIds: ["primary/model:high", "backup/model:medium"],
        run: async (modelId) => {
          calls.push(modelId!);
          return result;
        },
      });
      expect(calls).toEqual(expectedModels);
      expect(finalResult).toEqual(expect.objectContaining(result));
    }
  });
});
