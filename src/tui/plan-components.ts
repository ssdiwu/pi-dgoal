import type { ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, Focusable } from "@earendil-works/pi-tui";
import { matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { CheckLivenessSnapshot } from "../goal-runtime/state.ts";
import type { GoalState, GoalStatus } from "../goal-runtime/types.ts";
import type { PlanStatus } from "../plan/index.ts";
import { computeScrollOffset } from "./helpers.ts";

export const STATUS_GLYPH: Record<PlanStatus, string> = {
  pending: "○",
  in_progress: "◐",
  done: "✓",
  blocked: "⚠",
};

export type PlanStatusTarget = { kind: "phase" | "task"; id: number };
export type RenderLineType = "heading" | "spacer" | "description" | "phase" | "task";
export interface RenderLine {
  type: RenderLineType;
  status?: PlanStatus;
  text: string;
  target?: PlanStatusTarget;
  selected?: boolean;
}

export interface PlanOverlayUI extends Pick<ExtensionUIContext, "setWidget" | "getToolsExpanded" | "onTerminalInput"> {}

export interface PlanTuiDependencies {
  t: (key: string, params?: Record<string, string | number>) => string;
  widgetKey: string;
  doneHideDelayMs: number;
  getCurrentGoal: () => GoalState | undefined;
  getCurrentCheckSnapshot: () => CheckLivenessSnapshot | undefined;
  isGoalRunning: (status: GoalStatus | undefined) => boolean;
  renderPlanLines: (goal: GoalState | undefined, opts: { expandTasks: boolean; activityFrame?: number }, width?: number) => string[];
  buildHeadingLine: (goal: GoalState) => string;
  buildPlanStatusListLines: (goal: GoalState | undefined) => RenderLine[];
  buildPlanStatusDetailLines: (goal: GoalState | undefined, target: PlanStatusTarget | undefined) => string[];
  getPlanStatusTargets: (goal: GoalState | undefined) => PlanStatusTarget[];
  computePlanStatusSelection: (data: string, current: number, count: number) => number | null;
  getGoalElapsedMs: (goal: GoalState) => number;
  formatCheckActivityLine: (snapshot: CheckLivenessSnapshot | undefined) => string | undefined;
}

export function computePlanStatusSelection(data: string, current: number, count: number): number | null {
  if (count <= 0) return 0;
  const last = count - 1;
  const selected = Math.max(0, Math.min(current, last));
  if (matchesKey(data, "down") || data === "j") return Math.min(selected + 1, last);
  if (matchesKey(data, "up") || data === "k") return Math.max(selected - 1, 0);
  if (data === "G") return last;
  if (data === "g") return 0;
  return null;
}

export function getGoalElapsedMs(goal: Pick<GoalState, "status" | "startedAt" | "updatedAt" | "pausedTotalMs" | "pauseStartedAt">): number {
  const pausedTotalMs = goal.pausedTotalMs ?? 0;
  if (goal.status === "paused") {
    const frozenAt = goal.pauseStartedAt ?? goal.updatedAt;
    return Math.max(0, frozenAt - goal.startedAt - pausedTotalMs);
  }
  if (goal.status === "done") return Math.max(0, goal.updatedAt - goal.startedAt - pausedTotalMs);
  return Math.max(0, Date.now() - goal.startedAt - pausedTotalMs);
}

export function colorize(line: RenderLine, theme: Theme): string {
  if (line.selected) return theme.fg("accent", theme.bold(line.text));
  if (line.type === "heading") return theme.fg("accent", theme.bold(line.text));
  if (line.type === "spacer") return line.text;
  if (line.type === "description") return theme.fg("muted", line.text);
  if (line.type === "phase") return theme.fg("text", line.text);
  return theme.fg("dim", line.text);
}

function wrapModalText(text: string, width: number, contIndentWidth: number): string[] {
  if (visibleWidth(text) <= width) return [text];
  const wrapped = wrapTextWithAnsi(text, width);
  if (wrapped.length <= 1) return wrapped;
  const indent = " ".repeat(contIndentWidth);
  const continuationWidth = Math.max(1, width - contIndentWidth);
  return [wrapped[0], ...wrapped.slice(1).flatMap((line) => wrapTextWithAnsi(line, continuationWidth).map((part) => indent + part))];
}

function wrapModalLine(line: RenderLine, width: number, theme: Theme): string[] {
  const leftPad = line.target ? (line.selected ? "› " : "  ") : " ";
  const colored = colorize(line, theme);
  if (line.type === "spacer") return [leftPad + colored];

  const prefixWidth = line.type === "phase"
    ? visibleWidth(`${leftPad}├─ ${line.status ? STATUS_GLYPH[line.status] : "○"} `)
    : line.type === "task"
      ? visibleWidth(`${leftPad}│    ${line.status ? STATUS_GLYPH[line.status] : "○"} `)
      : visibleWidth(leftPad);
  const fullText = leftPad + colored;
  if (visibleWidth(fullText) <= width) return [fullText];

  const wrapped = wrapTextWithAnsi(fullText, width);
  if (wrapped.length <= 1) return wrapped;
  const indent = " ".repeat(prefixWidth);
  const continuationWidth = Math.max(1, width - prefixWidth);
  return [wrapped[0], ...wrapped.slice(1).flatMap((part) => wrapTextWithAnsi(part, continuationWidth).map((value) => indent + value))];
}

export class PlanOverlayComponent {
  private ui: PlanOverlayUI | undefined;
  private expandTasks = false;
  private terminalInputUnsubscribe: (() => void) | undefined;
  private doneHideTimer: ReturnType<typeof setTimeout> | undefined;
  private doneSnapshot: GoalState | undefined;
  private tickTimer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly deps: PlanTuiDependencies) {}

  setUI(ui: PlanOverlayUI | undefined): void {
    if (this.terminalInputUnsubscribe) {
      try { this.terminalInputUnsubscribe(); } catch { /* UI cleanup is best effort */ }
      this.terminalInputUnsubscribe = undefined;
    }
    this.ui = ui;
    this.syncExpandTasksFromToolsState();
    if (this.ui?.onTerminalInput) {
      try {
        this.terminalInputUnsubscribe = this.ui.onTerminalInput(() => {
          setTimeout(() => {
            if (this.syncExpandTasksFromToolsState()) this.update();
          }, 0);
          return undefined;
        });
      } catch {
        this.terminalInputUnsubscribe = undefined;
      }
    }
    this.startTick();
  }

  private syncExpandTasksFromToolsState(): boolean {
    try {
      const expanded = this.ui?.getToolsExpanded?.();
      if (typeof expanded !== "boolean" || expanded === this.expandTasks) return false;
      this.expandTasks = expanded;
      return true;
    } catch {
      return false;
    }
  }

  private startTick(): void {
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => this.update(), 1000);
  }

  private stopTick(): void {
    if (!this.tickTimer) return;
    clearInterval(this.tickTimer);
    this.tickTimer = undefined;
  }

  toggleExpand(): void {
    this.expandTasks = !this.expandTasks;
    this.update();
  }

  update(): void {
    try {
      if (!this.ui) return;
      this.syncExpandTasksFromToolsState();
      const goal = this.doneSnapshot ?? this.deps.getCurrentGoal();
      if (goal && this.deps.isGoalRunning(goal.status)) this.startTick();
      else this.stopTick();
      const renderOptions = { expandTasks: this.expandTasks };
      const preview = this.deps.renderPlanLines(goal, renderOptions);
      if (preview.length === 0) {
        this.ui.setWidget(this.deps.widgetKey, undefined);
        return;
      }
      this.ui.setWidget(this.deps.widgetKey, () => ({
        render: (width: number) => this.deps.renderPlanLines(goal, renderOptions, width),
        invalidate: () => {},
      }), { placement: "aboveEditor" });
    } catch {
      // TUI failures cannot block the state machine.
    }
  }

  showDoneThenHide(goal: GoalState | undefined = this.deps.getCurrentGoal()): void {
    if (this.doneHideTimer) clearTimeout(this.doneHideTimer);
    this.doneSnapshot = goal ? { ...goal, status: "done" as GoalStatus } : undefined;
    this.update();
    this.doneHideTimer = setTimeout(() => this.dispose(), this.deps.doneHideDelayMs);
  }

  clearDoneSnapshot(): void {
    if (this.doneHideTimer) {
      clearTimeout(this.doneHideTimer);
      this.doneHideTimer = undefined;
    }
    this.doneSnapshot = undefined;
  }

  reset(): void {
    this.clearDoneSnapshot();
    if (this.terminalInputUnsubscribe) {
      try { this.terminalInputUnsubscribe(); } catch { /* UI cleanup is best effort */ }
      this.terminalInputUnsubscribe = undefined;
    }
    this.stopTick();
    this.doneSnapshot = undefined;
  }

  dispose(): void {
    if (this.doneHideTimer) {
      clearTimeout(this.doneHideTimer);
      this.doneHideTimer = undefined;
    }
    this.stopTick();
    try {
      this.ui?.setWidget(this.deps.widgetKey, undefined);
    } catch {
      // Delayed cleanup is also fail-soft.
    }
    this.ui = undefined;
    this.reset();
  }
}

export class PlanStatusDialogComponent implements Component, Focusable {
  focused = false;
  private cachedWidth?: number;
  private cachedLines?: string[];
  private cachedElapsedSec?: number;
  private cachedCheckSnapshotKey?: string;
  private cachedWrappedBody?: string[];
  private cachedWrappedBodyWidth?: number;
  private cachedSelectedPhysicalStart?: number;
  private view: "list" | "detail" = "list";
  private selectedIndex = 0;
  private detailTarget?: PlanStatusTarget;
  private listScrollOffset = 0;
  private detailScrollOffset = 0;
  private followSelection = false;
  private readonly maxVisible = 20;

  constructor(
    private readonly goal: GoalState | undefined,
    private readonly theme: Theme,
    private readonly done: () => void,
    private readonly deps: PlanTuiDependencies,
  ) {}

  handleInput(data: string): void {
    if (matchesKey(data, "ctrl+c")) {
      this.done();
      return;
    }
    if (!this.goal?.plan) {
      if (matchesKey(data, "escape")) this.done();
      return;
    }
    if (this.view === "detail") {
      if (matchesKey(data, "escape")) {
        this.view = "list";
        this.detailTarget = undefined;
        this.detailScrollOffset = 0;
        this.invalidate();
        return;
      }
      const total = this.cachedWrappedBody?.length ?? this.deps.buildPlanStatusDetailLines(this.goal, this.detailTarget).length;
      const result = computeScrollOffset(data, this.detailScrollOffset, total, this.maxVisible);
      if (result !== null && result !== "exit" && result !== this.detailScrollOffset) {
        this.detailScrollOffset = result;
        this.invalidate();
      }
      return;
    }
    if (matchesKey(data, "escape")) {
      this.done();
      return;
    }

    const listScrollKey = matchesKey(data, "pageDown") || matchesKey(data, "pageUp")
      || matchesKey(data, "ctrl+d") || matchesKey(data, "ctrl+u")
      || matchesKey(data, "home") || matchesKey(data, "end");
    if (listScrollKey) {
      const total = this.cachedWrappedBody?.length ?? this.deps.buildPlanStatusListLines(this.goal).length;
      const result = computeScrollOffset(data, this.listScrollOffset, total, this.maxVisible);
      if (result !== null && result !== "exit" && result !== this.listScrollOffset) {
        this.listScrollOffset = result;
        this.followSelection = false;
        this.invalidate();
      }
      return;
    }

    const targets = this.deps.getPlanStatusTargets(this.goal);
    if ((data === "\r" || data === "\n") && targets[this.selectedIndex]) {
      this.detailTarget = targets[this.selectedIndex];
      this.view = "detail";
      this.detailScrollOffset = 0;
      this.invalidate();
      return;
    }
    const selected = this.deps.computePlanStatusSelection(data, this.selectedIndex, targets.length);
    if (selected !== null) {
      this.selectedIndex = selected;
      this.followSelection = true;
      this.invalidate();
    }
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
    this.cachedElapsedSec = undefined;
    this.cachedCheckSnapshotKey = undefined;
    this.cachedWrappedBody = undefined;
    this.cachedWrappedBodyWidth = undefined;
    this.cachedSelectedPhysicalStart = undefined;
  }

  private renderListBody(width: number): string[] {
    if (this.cachedWrappedBody && this.cachedWrappedBodyWidth === width) return this.cachedWrappedBody;
    const targets = this.deps.getPlanStatusTargets(this.goal);
    this.selectedIndex = Math.max(0, Math.min(this.selectedIndex, Math.max(0, targets.length - 1)));
    const body = this.deps.buildPlanStatusListLines(this.goal);
    const wrapped: string[] = [];
    let selectableIndex = 0;
    let selectedPhysicalStart: number | undefined;
    for (const line of body) {
      const selected = Boolean(line.target) && selectableIndex === this.selectedIndex;
      if (selected) selectedPhysicalStart = wrapped.length;
      wrapped.push(...wrapModalLine(selected ? { ...line, selected: true } : line, width, this.theme));
      if (line.target) selectableIndex += 1;
    }
    this.cachedWrappedBody = wrapped;
    this.cachedWrappedBodyWidth = width;
    this.cachedSelectedPhysicalStart = selectedPhysicalStart;
    return wrapped;
  }

  private renderDetailBody(width: number): string[] {
    if (this.cachedWrappedBody && this.cachedWrappedBodyWidth === width) return this.cachedWrappedBody;
    const detail = this.deps.buildPlanStatusDetailLines(this.goal, this.detailTarget);
    const wrapped = detail.flatMap((line, index) => {
      const colored = index === 0
        ? this.theme.fg("accent", this.theme.bold(line))
        : this.theme.fg(index === 3 ? "text" : "dim", line);
      return wrapModalText(" " + colored, width, 1);
    });
    this.cachedWrappedBody = wrapped;
    this.cachedWrappedBodyWidth = width;
    return wrapped;
  }

  private cacheRenderedLines(lines: string[], width: number, elapsedSec: number, checkSnapshotKey: string): string[] {
    this.cachedWidth = width;
    this.cachedElapsedSec = elapsedSec;
    this.cachedCheckSnapshotKey = checkSnapshotKey;
    this.cachedLines = lines;
    return lines;
  }

  render(availableWidth: number): string[] {
    if (!Number.isFinite(availableWidth) || availableWidth <= 0) return [];
    const renderWidth = Math.floor(availableWidth);
    if (renderWidth < 20) return [truncateToWidth("dgoal", renderWidth)];

    const elapsedSec = this.goal ? Math.floor(this.deps.getGoalElapsedMs(this.goal) / 1000) : 0;
    const checkSnapshot = this.deps.getCurrentCheckSnapshot();
    const checkSnapshotKey = JSON.stringify(checkSnapshot ?? null);
    if (
      this.cachedLines && this.cachedWidth === renderWidth && this.cachedElapsedSec === elapsedSec
      && this.cachedCheckSnapshotKey === checkSnapshotKey
    ) return this.cachedLines;

    const width = renderWidth;
    const th = this.theme;
    const lines: string[] = [];
    const titleKey = this.view === "detail" ? "status.dialogDetailTitle" : "status.dialogTitle";
    const title = truncateToWidth(` ${this.deps.t(titleKey)} `, Math.max(0, width - 2));
    const padLen = Math.max(0, width - visibleWidth(title) - 2);
    const padLeft = Math.floor(padLen / 2);
    const padRight = padLen - padLeft;
    lines.push(
      th.fg("border", "╭" + "─".repeat(padLeft))
        + th.fg("accent", th.bold(title))
        + th.fg("border", "─".repeat(padRight) + "╮"),
    );

    if (!this.goal) {
      lines.push(truncateToWidth(" " + th.fg("muted", this.deps.t("status.dialogNoGoal")), width));
      lines.push(truncateToWidth(" " + th.fg("dim", this.deps.t("status.dialogStartCommand")), width));
      lines.push(truncateToWidth(" " + th.fg("dim", this.deps.t("status.dialogCloseHint")), width));
      lines.push(th.fg("border", "╰" + "─".repeat(Math.max(0, width - 2)) + "╯"));
      return this.cacheRenderedLines(lines, width, elapsedSec, checkSnapshotKey);
    }
    if (!this.goal.plan || this.goal.plan.phases.length === 0) {
      lines.push(truncateToWidth(" " + th.fg("muted", this.deps.t("status.dialogEmpty")), width));
      lines.push(truncateToWidth(" " + th.fg("dim", this.deps.t("status.dialogCloseHint")), width));
      lines.push(th.fg("border", "╰" + "─".repeat(Math.max(0, width - 2)) + "╯"));
      return this.cacheRenderedLines(lines, width, elapsedSec, checkSnapshotKey);
    }

    const heading = " " + th.fg("accent", th.bold(this.deps.buildHeadingLine(this.goal)));
    lines.push(...wrapModalText(heading, width, 1));
    const activityLine = this.deps.formatCheckActivityLine(checkSnapshot);
    if (activityLine) lines.push(...wrapModalText(" " + th.fg("dim", activityLine), width, 1));

    const wrappedBody = this.view === "detail" ? this.renderDetailBody(width) : this.renderListBody(width);
    const total = wrappedBody.length;
    let start: number;
    if (this.view === "detail") {
      start = Math.min(this.detailScrollOffset, Math.max(0, total - this.maxVisible));
      this.detailScrollOffset = start;
    } else {
      start = Math.min(this.listScrollOffset, Math.max(0, total - this.maxVisible));
      const selectedStart = this.cachedSelectedPhysicalStart;
      if (this.followSelection && selectedStart !== undefined) {
        if (selectedStart < start) start = selectedStart;
        else if (selectedStart >= start + this.maxVisible) start = selectedStart - this.maxVisible + 1;
      }
      start = Math.max(0, Math.min(start, Math.max(0, total - this.maxVisible)));
      this.listScrollOffset = start;
      this.followSelection = false;
    }
    const end = Math.min(start + this.maxVisible, total);
    lines.push(...wrappedBody.slice(start, end));

    const shown = total === 0 ? "0-0 / 0" : `${start + 1}-${end} / ${total}`;
    const hint = this.view === "detail"
      ? this.deps.t("status.dialogDetailHint", { shown })
      : this.deps.t("status.dialogListHint");
    lines.push(truncateToWidth(th.fg("dim", " " + hint), width));
    lines.push(th.fg("border", "╰" + "─".repeat(Math.max(0, width - 2)) + "╯"));
    return this.cacheRenderedLines(lines, width, elapsedSec, checkSnapshotKey);
  }
}
