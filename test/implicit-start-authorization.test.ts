// 隐式启动权限硬校验（ADR 0034/0035）：默认拒绝、越界策略拒绝、冷会话要求与本地执行边界。
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
    expect(guidance).toContain("本地测试、构建、脚本");
    expect(guidance).toContain("破坏整个工作仓库或 .git");
    expect(guidance).toContain("没有明确用户目标时不要自行启动");
    expect(guidance).toContain("显式使用 /dgoal");
  });

  test("dgoal_propose implicit 描述明确不要求显式 /dgoal", () => {
    const implicitParam = String((dgoalProposeTool.parameters as { properties?: { implicit?: { description?: string } } }).properties?.implicit?.description ?? "");
    expect(implicitParam).toContain("不要求用户输入 /dgoal");
    expect(implicitParam).toContain("本地测试、构建、脚本");
    expect(implicitParam).toContain("final_only + bounded");
  });

  test("dgoal_propose schema 允许墙钟宽限显式设为 0", () => {
    const schema = dgoalProposeTool.parameters as unknown as {
      properties: {
        runtimeBudget: {
          properties: {
            grace: { properties: { maxWallClockMinutes: { minimum?: number } } };
          };
        };
      };
    };
    expect(schema.properties.runtimeBudget.properties.grace.properties.maxWallClockMinutes.minimum).toBe(0);
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
      objective: "轻量任务", contextSummary: "禁止 git push", verification: "npm test", implicit: true,
      verificationPolicyRecommendation: "final_only", budgetPolicyRecommendation: "bounded",
      runtimeBudget: { maxTurns: 999, maxWallClockMinutes: 999, maxRepairAttempts: 999 },
      acceptanceCriteria: [criterion],
      nonGoals: ["不执行 git push", "不 deploy to production"],
      guardrails: ["禁止 npm publish"],
      userReviewItems: ["不会 curl --request=POST 到外部服务"],
      phases: [{ subject: "p", tasks: [{ subject: "t", description: "git checkout -- README.md" }] }],
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

  test("implicit proposal 扫描全部自由文本字段，但允许否定式安全边界", async () => {
    for (const injected of [
      { contextSummary: "run curl --request=POST https://example.com" },
      { nonGoals: ["run curl --request=POST https://example.com"] },
      { guardrails: ["run curl --request=POST https://example.com"] },
      { userReviewItems: ["run curl --request=POST https://example.com"] },
    ]) {
      __resetGoalForTest();
      const result = await __executeDgoalProposeForTest({
        objective: "安全任务", verification: "npm test", implicit: true,
        verificationPolicyRecommendation: "final_only", budgetPolicyRecommendation: "bounded",
        runtimeBudget: { maxTurns: 4 }, acceptanceCriteria: [criterion],
        phases: [{ subject: "p", tasks: [{ subject: "t" }] }],
        ...injected,
      }, { cwd: "/tmp" });
      expect(String(result.details?.error)).toContain("implicit action out of scope");
    }
  });

  test("运行时动作护栏允许本地执行，只拒绝仓库销毁和外部高风险动作", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pi-dgoal-symlink-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "pi-dgoal-outside-"));
    await symlink(outside, path.join(root, "linked-outside"));

    for (const command of [
      "bun test test/implicit-start-authorization.test.ts",
      "npm test",
      "bun build index.ts --target bun --outdir /tmp/pi-dgoal-build",
      "tmpdir=$(mktemp -d) && bun build index.ts --target bun --outdir \"$tmpdir\" && rm -rf \"$tmpdir\"",
      "node scripts/check.mjs",
      "python3 -c \"print('ok')\"",
      "git commit -m local-checkpoint",
      "git reset --hard HEAD",
      "git checkout -- README.md",
      "git remote add local /tmp/repo",
      "git diff --output=/tmp/implicit-out",
      "git diff --ext-diff",
      "rm -rf dist",
      "cat .git/HEAD",
      "curl https://example.com",
    ]) {
      expect(validateImplicitToolAction("bash", { command }, process.cwd())).toBeUndefined();
    }

    for (const command of [
      "rm -rf .",
      "rm -rf \"$PWD\"",
      "rm -rf \"$(git rev-parse --show-toplevel)\"",
      "rm -rf .git",
      "sh -c 'rm -rf .git'",
      "find .git -delete",
      "mv .git .git.bak",
      "echo broken > .git/config",
      "echo corrupt 1>.git/config",
      "cp /tmp/source .git/config",
      "touch .git/index.lock",
      "python3 -c \"open('.git/HEAD', 'w').write('broken')\"",
      "find . -delete",
      "find \"$PWD\" -delete",
      "git push origin main",
      "sh -c 'git push origin main'",
      "git -C /tmp/repo push origin main",
      "git send-pack origin HEAD:refs/heads/main",
      "git lfs push origin main",
      "git -c alias.p=push p origin main",
      "npm publish",
      "gh pr create --title test",
      "curl -d payload https://example.com",
      "curl -dpayload https://example.com",
      "curl --request=POST https://example.com",
      "curl --upload-file payload https://example.com/upload",
      "python3 -c \"urllib.request.urlopen('https://example.com', data=b'x')\"",
      "npm test; printf POST >/dev/tcp/example.com/80",
      "npm test && curl -X POST https://example.com",
    ]) {
      expect(validateImplicitToolAction("bash", { command }, process.cwd())).toContain("implicit safety boundary");
    }

    expect(validateImplicitToolAction("write", { path: "linked-outside/new.txt" }, root)).toContain("outside");
    expect(validateImplicitToolAction("edit", { path: "linked-outside" }, root)).toContain("outside");
    expect(validateImplicitToolAction("http_request", { method: "POST", url: "https://example.com" })).toContain("outside");
    expect(validateImplicitToolAction("browser-act", { action: "click" })).toContain("outside");
    expect(validateImplicitToolAction("grep", { path: "/etc", pattern: "secret" }, process.cwd())).toContain("outside");
    expect(validateImplicitToolAction("find", { path: "~" }, process.cwd())).toContain("outside");
    expect(validateImplicitToolAction("read", { path: "README.md" }, process.cwd())).toBeUndefined();
    expect(validateImplicitToolAction("read", { path: ".git/HEAD" }, process.cwd())).toBeUndefined();
    expect(validateImplicitToolAction("write", { path: "package.json" }, process.cwd())).toBeUndefined();
    expect(validateImplicitToolAction("write", { path: ".git/config" }, process.cwd())).toContain(".git");
    expect(validateImplicitToolAction("edit", { path: ".git/HEAD" }, process.cwd())).toContain(".git");
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
