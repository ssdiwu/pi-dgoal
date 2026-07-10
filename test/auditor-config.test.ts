import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, promises as fsPromises, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  __resetDgoalConfigNotifiedForTest,
  getDgoalConfigPaths,
  loadDgoalConfig,
  normalizeAuditorModelId,
  resolveAuditorModelId,
} from "../index.ts";

const tmpRoots: string[] = [];

function makeTempProject() {
  const root = mkdtempSync(join(tmpdir(), "pi-dgoal-config-"));
  tmpRoots.push(root);
  const cwd = join(root, "project");
  const agentDir = join(root, "agent");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(agentDir, { recursive: true });
  return { root, cwd, agentDir };
}

afterEach(() => {
  mock.restore();
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
  __resetDgoalConfigNotifiedForTest();
});

describe("dgoal auditor config", () => {
  test("computes global and project config paths", () => {
    const paths = getDgoalConfigPaths("/repo/app", "/Users/demo/.pi/agent");

    expect(paths).toEqual({
      globalPath: "/Users/demo/.pi/agent/pi-dgoal.json",
      projectPath: "/repo/app/.pi/pi-dgoal.json",
    });
  });

  test("loads trusted project config over global config", async () => {
    const { cwd, agentDir } = makeTempProject();
    writeFileSync(join(agentDir, "pi-dgoal.json"), JSON.stringify({ auditorModel: "openai/gpt-5-mini" }, null, 2));
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "pi-dgoal.json"), JSON.stringify({ auditorModel: "anthropic/claude-sonnet-4" }, null, 2));

    const result = await loadDgoalConfig({ cwd, isProjectTrusted: () => true }, { agentDir });

    expect(result.globalConfig).toEqual({ auditorModel: "openai/gpt-5-mini" });
    expect(result.projectConfig).toEqual({ auditorModel: "anthropic/claude-sonnet-4" });
    expect(result).not.toHaveProperty("config");
    expect(result.issues).toEqual([]);
    expect(result.anyConfigFileExists).toBe(true);
  });

  test("ignores project config when project is not trusted", async () => {
    const { cwd, agentDir } = makeTempProject();
    writeFileSync(join(agentDir, "pi-dgoal.json"), JSON.stringify({ auditorModel: "openai/gpt-5-mini" }, null, 2));
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "pi-dgoal.json"), JSON.stringify({ auditorModel: "anthropic/claude-sonnet-4" }, null, 2));

    const result = await loadDgoalConfig({ cwd, isProjectTrusted: () => false }, { agentDir });

    expect(result.globalConfig).toEqual({ auditorModel: "openai/gpt-5-mini" });
    expect(result.projectConfig).toEqual({});
    expect(result).not.toHaveProperty("config");
    expect(result.issues).toEqual([]);
  });

  test("resolves phase and goal auditor models independently with thinking suffixes", async () => {
    const { cwd, agentDir } = makeTempProject();
    writeFileSync(join(agentDir, "pi-dgoal.json"), JSON.stringify({
      phaseAuditorModel: "openai-codex/gpt-5.6-sol:medium",
      goalAuditorModel: "openai-codex/gpt-5.6-sol:xhigh",
    }, null, 2));
    const notifications: { message: string; level: string }[] = [];
    const ctx = {
      cwd,
      isProjectTrusted: () => true,
      model: { provider: "openai", id: "gpt-5" } as any,
      ui: { notify: (message: string, level: "info" | "warning" | "error") => notifications.push({ message, level }) } as any,
    };

    expect(await resolveAuditorModelId(ctx, { agentDir, scope: "phase" })).toBe("openai-codex/gpt-5.6-sol:medium");
    expect(await resolveAuditorModelId(ctx, { agentDir, scope: "goal" })).toBe("openai-codex/gpt-5.6-sol:xhigh");

    const reloadedCtx = { ...ctx, model: { provider: "anthropic", id: "claude-sonnet-4" } as any };
    expect(await resolveAuditorModelId(reloadedCtx, { agentDir, scope: "phase" })).toBe("openai-codex/gpt-5.6-sol:medium");
    expect(await resolveAuditorModelId(reloadedCtx, { agentDir, scope: "goal" })).toBe("openai-codex/gpt-5.6-sol:xhigh");
    expect(notifications).toEqual([]);
  });

  test("warns once for each invalid config field", async () => {
    const { cwd, agentDir } = makeTempProject();
    writeFileSync(join(agentDir, "pi-dgoal.json"), JSON.stringify({
      phaseAuditorModel: 123,
      goalAuditorModel: false,
    }));
    const notifications: { message: string; level: string }[] = [];
    const ctx = {
      cwd,
      isProjectTrusted: () => true,
      model: { provider: "openai", id: "gpt-5" } as any,
      ui: { notify: (message: string, level: "info" | "warning" | "error") => notifications.push({ message, level }) } as any,
    };

    expect(await resolveAuditorModelId(ctx, { agentDir, scope: "phase" })).toBe("openai/gpt-5");
    expect(await resolveAuditorModelId(ctx, { agentDir, scope: "goal" })).toBe("openai/gpt-5");
    expect(notifications).toEqual([
      { message: expect.stringContaining("phaseAuditorModel"), level: "warning" },
      { message: expect.stringContaining("goalAuditorModel"), level: "warning" },
    ]);

    await resolveAuditorModelId(ctx, { agentDir, scope: "phase" });
    await resolveAuditorModelId(ctx, { agentDir, scope: "goal" });
    expect(notifications).toHaveLength(2);
  });

  test("suppresses the selection hint when a config issue is present", async () => {
    const { cwd, agentDir } = makeTempProject();
    writeFileSync(join(agentDir, "pi-dgoal.json"), JSON.stringify({ phaseAuditorModel: "bad-phase-id" }));
    const notifications: { message: string; level: string }[] = [];
    const ctx = {
      cwd,
      isProjectTrusted: () => true,
      model: { provider: "openai", id: "gpt-5" } as any,
      ui: { notify: (message: string, level: "info" | "warning" | "error") => notifications.push({ message, level }) } as any,
    };

    // goalAuditorModel 未配置 → 有效值为 null/unset；但同文件 phaseAuditorModel 非法产生 issue → 只发 warning，不发 hint。
    expect(await resolveAuditorModelId(ctx, { agentDir, scope: "goal" })).toBe("openai/gpt-5");
    expect(notifications).toEqual([
      { message: expect.stringContaining("phaseAuditorModel"), level: "warning" },
    ]);
    expect(notifications.some((n) => n.level === "info")).toBe(false);
  });

  test("applies project source precedence before scoped-key precedence", async () => {
    const { cwd, agentDir } = makeTempProject();
    writeFileSync(join(agentDir, "pi-dgoal.json"), JSON.stringify({ phaseAuditorModel: "global/phase:medium" }));
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "pi-dgoal.json"), JSON.stringify({ auditorModel: "project/shared:high" }));

    const modelId = await resolveAuditorModelId(
      {
        cwd,
        isProjectTrusted: () => true,
        model: { provider: "openai", id: "gpt-5" } as any,
        ui: { notify: () => {} } as any,
      },
      { agentDir, scope: "phase" },
    );

    expect(modelId).toBe("project/shared:high");
  });

  test("falls back to current model when auditorModel is invalid and warns once", async () => {
    const { cwd, agentDir } = makeTempProject();
    writeFileSync(join(agentDir, "pi-dgoal.json"), JSON.stringify({ auditorModel: "bad-model-id" }, null, 2));

    const notifications: { message: string; level: string }[] = [];
    const modelId = await resolveAuditorModelId(
      {
        cwd,
        isProjectTrusted: () => true,
        model: { provider: "openai", id: "gpt-5" } as any,
        ui: { notify: (message: string, level: "info" | "warning" | "error") => notifications.push({ message, level }) } as any,
      },
      { agentDir },
    );

    expect(modelId).toBe("openai/gpt-5");
    expect(notifications).toHaveLength(1);
    expect(notifications[0].level).toBe("warning");
    expect(notifications[0].message).toContain("auditorModel");
  });

  test("falls back and warns when a provider segment contains a colon", async () => {
    const { cwd, agentDir } = makeTempProject();
    writeFileSync(join(agentDir, "pi-dgoal.json"), JSON.stringify({ phaseAuditorModel: "openai:foo/gpt:xhigh" }));
    const notifications: { message: string; level: string }[] = [];

    const modelId = await resolveAuditorModelId(
      {
        cwd,
        isProjectTrusted: () => true,
        model: { provider: "openai", id: "gpt-5" } as any,
        ui: { notify: (message: string, level: "info" | "warning" | "error") => notifications.push({ message, level }) } as any,
      },
      { agentDir, scope: "phase" },
    );

    expect(modelId).toBe("openai/gpt-5");
    expect(notifications).toEqual([{ message: expect.stringContaining("phaseAuditorModel"), level: "warning" }]);
  });

  test("falls back and warns when a model ID contains a control character", async () => {
    const { cwd, agentDir } = makeTempProject();
    writeFileSync(join(agentDir, "pi-dgoal.json"), JSON.stringify({ phaseAuditorModel: "openai/gpt\u0000x" }));
    const notifications: { message: string; level: string }[] = [];

    const modelId = await resolveAuditorModelId(
      {
        cwd,
        isProjectTrusted: () => true,
        model: { provider: "openai", id: "gpt-5" } as any,
        ui: { notify: (message: string, level: "info" | "warning" | "error") => notifications.push({ message, level }) } as any,
      },
      { agentDir, scope: "phase" },
    );

    expect(modelId).toBe("openai/gpt-5");
    expect(notifications).toEqual([{ message: expect.stringContaining("phaseAuditorModel"), level: "warning" }]);
  });

  test("creates a null template, falls back, and shows a one-time hint when no config exists", async () => {
    const { cwd, agentDir } = makeTempProject();
    const configPath = join(agentDir, "pi-dgoal.json");
    const notifications: { message: string; level: string }[] = [];
    const ctx = {
      cwd,
      isProjectTrusted: () => true,
      model: { provider: "openai", id: "gpt-5" } as any,
      ui: { notify: (message: string, level: "info" | "warning" | "error") => notifications.push({ message, level }) } as any,
    };

    expect(await resolveAuditorModelId(ctx, { agentDir })).toBe("openai/gpt-5");
    expect(existsSync(configPath)).toBe(true);
    expect(JSON.parse(readFileSync(configPath, "utf-8"))).toMatchObject({
      phaseAuditorModel: null,
      goalAuditorModel: null,
      $comment: expect.any(String),
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].level).toBe("info");
    expect(notifications[0].message).toContain("pi-dgoal.json");

    // 模板未填时，每个 Pi 进程首次审核提示；同一进程去重。
    expect(await resolveAuditorModelId(ctx, { agentDir })).toBe("openai/gpt-5");
    expect(notifications).toHaveLength(1);
  });

  test("uses scoped null as an explicit inherited-model override over global config", async () => {
    const { cwd, agentDir } = makeTempProject();
    writeFileSync(join(agentDir, "pi-dgoal.json"), JSON.stringify({
      phaseAuditorModel: "global/phase:medium",
      goalAuditorModel: "global/goal:xhigh",
    }));
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "pi-dgoal.json"), JSON.stringify({
      phaseAuditorModel: null,
      goalAuditorModel: null,
    }));

    const loaded = await loadDgoalConfig({ cwd, isProjectTrusted: () => true }, { agentDir });
    expect(loaded.globalConfig).toEqual({
      phaseAuditorModel: "global/phase:medium",
      goalAuditorModel: "global/goal:xhigh",
    });
    expect(loaded.projectConfig).toEqual({ phaseAuditorModel: null, goalAuditorModel: null });
    expect(loaded).not.toHaveProperty("config");
    expect(loaded.issues).toEqual([]);

    const notifications: { message: string; level: string }[] = [];
    const ctx = {
      cwd,
      isProjectTrusted: () => true,
      model: { provider: "openai", id: "gpt-5" } as any,
      ui: { notify: (message: string, level: "info" | "warning" | "error") => notifications.push({ message, level }) } as any,
    };

    expect(await resolveAuditorModelId(ctx, { agentDir, scope: "phase" })).toBe("openai/gpt-5");
    expect(await resolveAuditorModelId(ctx, { agentDir, scope: "goal" })).toBe("openai/gpt-5");
    expect(notifications).toEqual([{ message: expect.stringContaining("phaseAuditorModel"), level: "info" }]);
  });

  test("uses an existing concrete global config without overwriting or hinting", async () => {
    const { cwd, agentDir } = makeTempProject();
    const configPath = join(agentDir, "pi-dgoal.json");
    const original = JSON.stringify({ auditorModel: "openai/gpt-5-mini" }, null, 2);
    writeFileSync(configPath, original);
    const notifications: { message: string; level: string }[] = [];

    const ctx = {
      cwd,
      isProjectTrusted: () => true,
      model: { provider: "openai", id: "gpt-5" } as any,
      ui: { notify: (message: string, level: "info" | "warning" | "error") => notifications.push({ message, level }) } as any,
    };

    expect(await resolveAuditorModelId(ctx, { agentDir, scope: "phase" })).toBe("openai/gpt-5-mini");
    expect(await resolveAuditorModelId(ctx, { agentDir, scope: "goal" })).toBe("openai/gpt-5-mini");
    expect(readFileSync(configPath, "utf-8")).toBe(original);
    expect(notifications).toEqual([]);
  });

  test("falls back without blocking when the template write fails", async () => {
    const { cwd, agentDir } = makeTempProject();
    const notifications: { message: string; level: string }[] = [];
    spyOn(fsPromises, "writeFile").mockRejectedValueOnce(Object.assign(new Error("simulated disk full"), { code: "ENOSPC" }));

    const modelId = await resolveAuditorModelId(
      {
        cwd,
        isProjectTrusted: () => true,
        model: { provider: "openai", id: "gpt-5" } as any,
        ui: { notify: (message: string, level: "info" | "warning" | "error") => notifications.push({ message, level }) } as any,
      },
      { agentDir },
    );

    expect(modelId).toBe("openai/gpt-5");
    expect(notifications).toEqual([{ message: expect.stringContaining("无法创建审核器配置模板"), level: "warning" }]);
    expect(existsSync(join(agentDir, "pi-dgoal.json"))).toBe(false);
  });

  test("keeps resolving when ui.notify throws", async () => {
    const { cwd, agentDir } = makeTempProject();
    const boom = new Error("notify boom");
    let throws = 0;
    const ctx = {
      cwd,
      isProjectTrusted: () => true,
      model: { provider: "openai", id: "gpt-5" } as any,
      ui: { notify: () => { throws += 1; throw boom; } } as any,
    };

    // 无配置场景会同时触发 hint；ui.notify 拖错不能阻断选模或中断审核。
    expect(await resolveAuditorModelId(ctx, { agentDir, scope: "phase" })).toBe("openai/gpt-5");
    expect(throws).toBeGreaterThan(0);
    // 重复调用仍不抛、仍返回会话模型（去重 + 容错）
    expect(await resolveAuditorModelId(ctx, { agentDir, scope: "goal" })).toBe("openai/gpt-5");
  });

  test("normalizes Pi-native auditor model IDs without passing unsafe characters to spawn", () => {
    expect(normalizeAuditorModelId(" openai/gpt-5 ")).toBe("openai/gpt-5");
    expect(normalizeAuditorModelId(" openai-codex/gpt-5.6-sol:xhigh ")).toBe("openai-codex/gpt-5.6-sol:xhigh");
    expect(normalizeAuditorModelId("gpt-5")).toBeUndefined();
    expect(normalizeAuditorModelId("/gpt-5")).toBeUndefined();
    expect(normalizeAuditorModelId("openai/")).toBeUndefined();
    // provider 不能含空白或冒号；model ID 允许 Pi 原生路径和 tag。
    expect(normalizeAuditorModelId("openai /gpt-5")).toBeUndefined();
    expect(normalizeAuditorModelId("openai/ gpt-5")).toBeUndefined();
    expect(normalizeAuditorModelId("openai:x/gpt")).toBeUndefined();
    expect(normalizeAuditorModelId(":/gpt")).toBeUndefined();
    expect(normalizeAuditorModelId("openai:foo/gpt:xhigh")).toBeUndefined();
    expect(normalizeAuditorModelId("custom/org/name:tag")).toBe("custom/org/name:tag");
    expect(normalizeAuditorModelId("custom/org/name:tag:high")).toBe("custom/org/name:tag:high");
    expect(normalizeAuditorModelId("ollama/qwen2.5-coder:7b")).toBe("ollama/qwen2.5-coder:7b");
    expect(normalizeAuditorModelId("openrouter/anthropic/claude-sonnet-4")).toBe("openrouter/anthropic/claude-sonnet-4");
    // 空路径段、空 tag、控制字符会在 spawn 前被诊断并降级。
    expect(normalizeAuditorModelId("openai//gpt-5")).toBeUndefined();
    expect(normalizeAuditorModelId("openai/gpt-5/")).toBeUndefined();
    expect(normalizeAuditorModelId("openai/gpt-5:")).toBeUndefined();
    expect(normalizeAuditorModelId("openai/gpt-5::high")).toBeUndefined();
    expect(normalizeAuditorModelId("openai/gpt\u0000x")).toBeUndefined();
    expect(normalizeAuditorModelId("openai/gpt\u001fx")).toBeUndefined();
    expect(normalizeAuditorModelId("openai/gpt\u007fx")).toBeUndefined();
    expect(normalizeAuditorModelId("openai/gpt\nx")).toBeUndefined();
  });
});
