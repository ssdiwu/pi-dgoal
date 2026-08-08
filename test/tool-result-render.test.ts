import { beforeEach, describe, expect, test } from "bun:test";
import {
  __resetGoalForTest,
  executionPlanTool,
  goalCheckTool,
  goalPlanTool,
  phaseCheckTool,
  stagedPlanTool,
  workCreateTool,
  workListTool,
  workReadTool,
  workUpdateTool,
} from "../index.ts";

const tools = [workListTool, executionPlanTool, goalPlanTool, stagedPlanTool, workCreateTool, workReadTool, workUpdateTool, phaseCheckTool, goalCheckTool];
const theme = { fg: (_: string, text: string) => text };
const ctx = { cwd: process.cwd(), ui: { setStatus: () => {}, setWidget: () => {}, notify: () => {} }, sessionManager: { getBranch: () => [] } } as never;
const expandedText = (tool: { renderResult: Function }, result: unknown) => tool.renderResult(result, { expanded: true, isPartial: false }, theme, { isError: false }).render(120).join("\n");

describe("public tool result projection", () => {
  beforeEach(__resetGoalForTest);

  test("all nine public tools collapse errors and only expand allowlisted display text", () => {
    for (const tool of tools) {
      const result = {
        content: [{ type: "text", text: "Error title\nprivate diagnostic" }],
        details: { display: "Safe display detail", secret: "must not render" },
      };
      expect(tool.renderResult(result, { expanded: false, isPartial: false }, theme, { isError: true }).render(100).join("\n").trimEnd()).toBe("Error title (Ctrl+O to expand)");
      const expanded = tool.renderResult(result, { expanded: true, isPartial: false }, theme, { isError: true }).render(100).join("\n");
      expect(expanded).toContain("private diagnostic");
      expect(expanded).toContain("Safe display detail");
      expect(expanded).not.toContain("must not render");
    }
  });

  test("expanded partial checks retain live status text", () => {
    const result = { content: [{ type: "text", text: "审核中 · 剩余 42 秒" }], details: { secret: "must not render" } };
    const expanded = phaseCheckTool.renderResult(result, { expanded: true, isPartial: true }, theme, { isError: false }).render(100).join("\n");
    expect(expanded).toContain("审核中 · 剩余 42 秒");
    expect(expanded).not.toContain("must not render");
  });

  test("Execution Plan create, work_create, and work_update provide concrete expanded details", async () => {
    const created = await executionPlanTool.execute("create-plan", {
      objective: "展示展开投影",
      description: "验证建立与修订时的人类可读说明。",
      items: [{ subject: "读源码", description: "定位渲染入口" }],
      phases: [],
    }, undefined, undefined, ctx);
    expect(expandedText(executionPlanTool, created)).toContain("读源码");
    expect(expandedText(executionPlanTool, created)).toContain("验证建立与修订时的人类可读说明");

    const added = await workCreateTool.execute("create-item", { target: "item", subject: "验证投影", description: "确认新增 Work Item 说明可见。" }, undefined, undefined, ctx);
    expect(expandedText(workCreateTool, added)).toContain("验证投影");

    const updated = await workUpdateTool.execute("update-item", { target: "item", id: 1, status: "in_progress" }, undefined, undefined, ctx);
    const expanded = expandedText(workUpdateTool, updated);
    expect(expanded).toContain("读源码");
    expect(expanded).toContain("in_progress");
  });
});
