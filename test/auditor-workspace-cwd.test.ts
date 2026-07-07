import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  __finalizeGoalForTest,
  __resetAuditorWorkspaceTrackerForTest,
  __setGoalForTest,
  __trackFileToolExecutionEndForTest,
  __trackFileToolExecutionStartForTest,
  resolveAuditorWorkspaceCwd,
  type GoalState,
} from "../index.ts";

const tmpRoots: string[] = [];

function makeTempRoot() {
  const root = mkdtempSync(join(tmpdir(), "pi-dgoal-auditor-cwd-"));
  tmpRoots.push(root);
  return root;
}

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
  __resetAuditorWorkspaceTrackerForTest();
});

function makeCtx() {
  return {
    ui: {
      notify: () => {},
      setStatus: () => {},
      confirm: async () => true,
    },
  };
}

function makeActiveGoal(id = "goal-1"): GoalState {
  return {
    id,
    objective: id,
    status: "active",
    startedAt: 1,
    updatedAt: 1,
    iteration: 0,
  };
}

describe("auditor workspace cwd", () => {
  test("uses current-turn successful edit before session history is persisted", () => {
    const root = makeTempRoot();
    const mainRepo = join(root, "Curio");
    const worktreeRepo = join(mainRepo, "worktrees", "stout-quail", "Curio");
    mkdirSync(join(mainRepo, ".git"), { recursive: true });
    mkdirSync(worktreeRepo, { recursive: true });
    writeFileSync(join(worktreeRepo, ".git"), "gitdir: /tmp/fake-worktree-gitdir\n");
    writeFileSync(join(worktreeRepo, "ContentView.swift"), "// test\n");

    __trackFileToolExecutionStartForTest("call-1", "edit", { path: "worktrees/stout-quail/Curio/ContentView.swift" }, mainRepo);
    __trackFileToolExecutionEndForTest("call-1", false);

    const cwd = resolveAuditorWorkspaceCwd({
      cwd: mainRepo,
      sessionManager: { getBranch: () => [] },
    } as never);

    expect(cwd).toBe(worktreeRepo);
  });

  test("switches auditor cwd to nested git worktree inferred from latest edited file", () => {
    const root = makeTempRoot();
    const mainRepo = join(root, "Curio");
    const worktreeRepo = join(mainRepo, "worktrees", "stout-quail", "Curio");
    mkdirSync(join(mainRepo, ".git"), { recursive: true });
    mkdirSync(worktreeRepo, { recursive: true });
    writeFileSync(join(worktreeRepo, ".git"), "gitdir: /tmp/fake-worktree-gitdir\n");
    writeFileSync(join(worktreeRepo, "ContentView.swift"), "// test\n");

    const cwd = resolveAuditorWorkspaceCwd({
      cwd: mainRepo,
      sessionManager: {
        getBranch: () => [
          {
            type: "message",
            message: {
              role: "assistant",
              content: [
                {
                  type: "toolCall",
                  name: "edit",
                  arguments: { path: "worktrees/stout-quail/Curio/ContentView.swift" },
                },
              ],
            },
          },
        ],
      },
    } as never);

    expect(cwd).toBe(worktreeRepo);
  });

  test("keeps current cwd when latest file stays in the same git repo", () => {
    const root = makeTempRoot();
    const repo = join(root, "repo");
    const subdir = join(repo, "src");
    mkdirSync(join(repo, ".git"), { recursive: true });
    mkdirSync(subdir, { recursive: true });
    writeFileSync(join(subdir, "index.ts"), "export {};\n");

    const cwd = resolveAuditorWorkspaceCwd({
      cwd: subdir,
      sessionManager: {
        getBranch: () => [
          {
            type: "message",
            message: {
              role: "assistant",
              content: [
                {
                  type: "toolCall",
                  name: "edit",
                  arguments: { path: "index.ts" },
                },
              ],
            },
          },
        ],
      },
    } as never);

    expect(cwd).toBe(subdir);
  });

  test("after goal finalizes, next goal without new file tool history should fall back to current cwd", () => {
    const root = makeTempRoot();
    const mainRepo = join(root, "Curio");
    const worktreeRepo = join(mainRepo, "worktrees", "stout-quail", "Curio");
    mkdirSync(join(mainRepo, ".git"), { recursive: true });
    mkdirSync(worktreeRepo, { recursive: true });
    writeFileSync(join(worktreeRepo, ".git"), "gitdir: /tmp/fake-worktree-gitdir\n");
    writeFileSync(join(worktreeRepo, "ContentView.swift"), "// test\n");

    __setGoalForTest(makeActiveGoal("goal-a"));
    __trackFileToolExecutionStartForTest("call-1", "edit", { path: "worktrees/stout-quail/Curio/ContentView.swift" }, mainRepo);
    __trackFileToolExecutionEndForTest("call-1", false);
    __finalizeGoalForTest(makeCtx() as never);

    __setGoalForTest(makeActiveGoal("goal-b"));
    const cwd = resolveAuditorWorkspaceCwd({
      cwd: mainRepo,
      sessionManager: { getBranch: () => [] },
    } as never);

    expect(cwd).toBe(mainRepo);
  });

  test("falls back to current cwd when there is no file tool history", () => {
    const root = makeTempRoot();
    const repo = join(root, "repo");
    mkdirSync(join(repo, ".git"), { recursive: true });

    const cwd = resolveAuditorWorkspaceCwd({
      cwd: repo,
      sessionManager: { getBranch: () => [] },
    } as never);

    expect(cwd).toBe(repo);
  });
});
