import { describe, expect, test } from "bun:test";
import { taskPlanTool, phasePlanTool, goalPlanTool, planCreateTool, planReadTool, planUpdateTool, phaseCheckTool, goalCheckTool } from "../src/runtime/index.ts";

const tools = [taskPlanTool, phasePlanTool, goalPlanTool, planCreateTool, planReadTool, planUpdateTool, phaseCheckTool, goalCheckTool];
const theme = { fg: (_: string, text: string) => text };

describe("public tool result projection", () => {
  test("all public tools collapse errors and expand only text content", () => {
    for (const tool of tools) {
      const result = { content: [{ type: "text", text: "Error title\nprivate diagnostic" }], details: { secret: "must not render" } };
      expect(tool.renderResult(result, { expanded: false, isPartial: false }, theme, { isError: true }).render(100).join("\n").trimEnd()).toBe("Error title (Ctrl+O to expand)");
      const expanded = tool.renderResult(result, { expanded: true, isPartial: false }, theme, { isError: true }).render(100).join("\n");
      expect(expanded).toContain("private diagnostic");
      expect(expanded).not.toContain("must not render");
    }
  });
});
