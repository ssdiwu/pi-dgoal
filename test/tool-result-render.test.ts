import { beforeEach, describe, expect, test } from "bun:test";
import { __resetGoalForTest } from "../index.ts";
import { taskPlanTool, phasePlanTool, goalPlanTool, planCreateTool, planReadTool, planUpdateTool, phaseCheckTool, goalCheckTool } from "../src/runtime/index.ts";

const tools = [taskPlanTool, phasePlanTool, goalPlanTool, planCreateTool, planReadTool, planUpdateTool, phaseCheckTool, goalCheckTool];
const theme = { fg: (_: string, text: string) => text };
const ctx = { cwd: process.cwd(), ui: { setStatus: () => {}, setWidget: () => {}, notify: () => {} }, sessionManager: { getBranch: () => [] } } as never;
const expandedText = (tool: { renderResult: Function }, result: unknown) => tool.renderResult(result, { expanded: true, isPartial: false }, theme, { isError: false }).render(120).join("\n");

describe("public tool result projection", () => {
  beforeEach(__resetGoalForTest);

  test("all public tools collapse errors and expand only content plus their allowlisted display text", () => {
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

  test("expanded partial checks retain their live status text", () => {
    const result = { content: [{ type: "text", text: "审核中 · 剩余 42 秒" }], details: { secret: "must not render" } };
    const expanded = phaseCheckTool.renderResult(result, { expanded: true, isPartial: true }, theme, { isError: false }).render(100).join("\n");
    expect(expanded).toContain("审核中 · 剩余 42 秒");
    expect(expanded).not.toContain("must not render");
  });

  test("Task Plan create, create-task, and update supply concrete expanded details", async () => {
    const created = await taskPlanTool.execute("create-plan", {
      objective: "展示展开投影",
      tasks: [{ subject: "读源码", description: "定位渲染入口" }],
    }, undefined, undefined, ctx);
    expect(expandedText(taskPlanTool, created)).toContain("读源码");

    const added = await planCreateTool.execute("create-task", { subject: "验证投影", activeForm: "正在验证" }, undefined, undefined, ctx);
    expect(expandedText(planCreateTool, added)).toContain("验证投影");

    const updated = await planUpdateTool.execute("update-task", { target: "task", id: 1, status: "in_progress" }, undefined, undefined, ctx);
    const expanded = expandedText(planUpdateTool, updated);
    expect(expanded).toContain("读源码");
    expect(expanded).toContain("in_progress");
  });
});
