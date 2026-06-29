import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

    expect(result.config).toEqual({ auditorModel: "anthropic/claude-sonnet-4" });
    expect(result.issues).toEqual([]);
    expect(result.anyConfigFileExists).toBe(true);
  });

  test("ignores project config when project is not trusted", async () => {
    const { cwd, agentDir } = makeTempProject();
    writeFileSync(join(agentDir, "pi-dgoal.json"), JSON.stringify({ auditorModel: "openai/gpt-5-mini" }, null, 2));
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "pi-dgoal.json"), JSON.stringify({ auditorModel: "anthropic/claude-sonnet-4" }, null, 2));

    const result = await loadDgoalConfig({ cwd, isProjectTrusted: () => false }, { agentDir });

    expect(result.config).toEqual({ auditorModel: "openai/gpt-5-mini" });
    expect(result.issues).toEqual([]);
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

  test("shows a one-time hint when no config file exists anywhere", async () => {
    const { cwd, agentDir } = makeTempProject();

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
    expect(notifications[0].level).toBe("info");
    expect(notifications[0].message).toContain("pi-dgoal.json");

    // 第二次调用不再重复提示（去重）
    await resolveAuditorModelId(
      {
        cwd,
        isProjectTrusted: () => true,
        model: { provider: "openai", id: "gpt-5" } as any,
        ui: { notify: (message: string, level: "info" | "warning" | "error") => notifications.push({ message, level }) } as any,
      },
      { agentDir },
    );
    expect(notifications).toHaveLength(1);
  });

  test("normalizes auditorModel only for provider/model strings", () => {
    expect(normalizeAuditorModelId(" openai/gpt-5 ")).toBe("openai/gpt-5");
    expect(normalizeAuditorModelId("gpt-5")).toBeUndefined();
    expect(normalizeAuditorModelId("/gpt-5")).toBeUndefined();
    expect(normalizeAuditorModelId("openai/")).toBeUndefined();
  });
});
