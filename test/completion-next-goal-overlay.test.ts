import { expect, test } from "bun:test";
import { __getGoalForTest, __resetGoalForTest, disposePlanOverlay, executionPlanTool, registerDgoal, workListTool, workUpdateTool } from "../index.ts";

for (const mode of ["soft", "execution"] as const) {
  test(`a completed Goal cannot cover or later hide the next ${mode} Goal`, async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    let nextTimer = 5000;
    const hideTimers = new Map<number, () => void>();
    const intervals = new Set<number>();
    globalThis.setTimeout = ((callback: () => void, delay?: number) => {
      if (delay !== 10_000) return originalSetTimeout(callback, delay);
      hideTimers.set(++nextTimer, callback);
      return nextTimer;
    }) as typeof setTimeout;
    globalThis.clearTimeout = ((timer: any) => {
      if (hideTimers.delete(timer)) return;
      return originalClearTimeout(timer);
    }) as typeof clearTimeout;
    globalThis.setInterval = (() => { intervals.add(++nextTimer); return nextTimer; }) as typeof setInterval;
    globalThis.clearInterval = ((timer: any) => {
      if (intervals.delete(timer)) return;
      return originalClearInterval(timer);
    }) as typeof clearInterval;
    try {
      disposePlanOverlay();
      __resetGoalForTest();
      const entries: any[] = [];
      let widget: any;
      const handlers: Record<string, Function> = {};
      const ctx = {
        cwd: process.cwd(), ui: { setStatus: () => {}, setWidget: (_key: string, value: any) => { widget = value; }, notify: () => {}, getToolsExpanded: () => false, onTerminalInput: () => () => {} },
        sessionManager: { getBranch: () => entries }, isIdle: () => true, hasPendingMessages: () => false,
      } as never;
      registerDgoal({ registerTool: () => {}, registerCommand: () => {}, on: (name: string, handler: Function) => { handlers[name] = handler; }, events: { emit: () => {} }, appendEntry: (customType: string, data: unknown) => entries.push({ type: "custom", customType, data }), sendUserMessage: () => {} } as never);
      await handlers.session_start({ reason: "reload" }, ctx);
      const execute = (tool: any, params: any) => tool.execute("call", params, undefined, undefined, ctx);
      const rendered = () => typeof widget === "function" ? widget({}, {}).render(120).join("\n") : "";
      await execute(workListTool, { objective: "OLD GOAL", description: "旧清单", items: [{ subject: "旧事项" }], phases: [] });
      await execute(workUpdateTool, { target: "item", id: 1, status: "in_progress" });
      const completed = await execute(workUpdateTool, { target: "item", id: 1, status: "done" });
      expect(completed.details?.completed).toBe(true);
      expect(rendered()).toContain("OLD GOAL");
      expect(hideTimers.size).toBe(1);
      const created = await execute(mode === "soft" ? workListTool : executionPlanTool, { objective: "NEW GOAL", description: "新工作", items: [{ subject: "新事项", description: "核验新工作" }], phases: [] });
      expect(created.isError).not.toBe(true);
      expect(__getGoalForTest()).toMatchObject({ objective: "NEW GOAL", status: "active" });
      expect(rendered()).toContain("NEW GOAL");
      expect(rendered()).not.toContain("OLD GOAL");
      expect(hideTimers.size).toBe(0);
      for (const callback of [...hideTimers.values()]) callback();
      expect(rendered()).toContain("NEW GOAL");
    } finally {
      disposePlanOverlay();
      __resetGoalForTest();
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }
  });
}
