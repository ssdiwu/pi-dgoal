// 启动授权硬校验（ADR 0034/0035/0036）：隐式边界 + 自然语言显式一次性授权。
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { __executeDgoalProposeForTest, __getGoalForTest, __getPendingProposalForTest, __getRuntimeStateForTest, __resetGoalForTest, __setGoalForTest, __setProposalSemanticReviewForTest, __setRuntimeStateForTest, dgoalProposeTool, validateImplicitToolAction, type GoalState } from "../index.ts";
import { buildImplicitStartGuidance, buildNaturalLanguageStartGuidance, isNaturalLanguageDgoalStartRequest } from "../src/startup/index.ts";

const criterion = { criterion: "测试退出码 0", evidence: "npm test" };

async function makeImplicitContext(prefix: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  const agentDir = path.join(root, "agent");
  const projectDir = path.join(root, "project");
  await mkdir(agentDir, { recursive: true });
  await mkdir(projectDir, { recursive: true });
  await writeFile(path.join(agentDir, "pi-dgoal.json"), JSON.stringify({
    implicitFinalOnlyStart: true,
    implicitFinalOnlyBudget: { maxTurns: 24, maxWallClockMinutes: 60, maxRepairAttempts: 1, grace: { maxTurns: 24, maxWallClockMinutes: 0 } },
  }));
  return { cwd: projectDir, agentDir, isProjectTrusted: () => true };
}

describe("启动授权 · 隐式轻量与自然语言显式路径", () => {
  test("冷启动提示明确隐式入口与安全策略", () => {
    const guidance = buildImplicitStartGuidance();
    expect(guidance).toContain("implicit=true");
    expect(guidance).toContain("final_only + bounded");
    expect(guidance).toContain("用户明确要求启动 dgoal");
    expect(guidance).toContain("本地测试、构建、脚本");
    expect(guidance).toContain("破坏整个工作仓库或 .git");
    expect(guidance).toContain("没有明确用户目标时不要自行启动");
    expect(guidance).toContain("不要再要求用户补输 /dgoal");
  });

  test("自然语言显式启动只识别明确指令，不把讨论或否定句当授权", () => {
    for (const text of [
      "请用 dgoal 完成这个任务",
      "你可以用dgoal和dteam自己处理掉",
      "启动 /dgoal",
      "麻烦用一下 dgoal 完成这个任务",
      "交给 dgoal 来处理",
      "请让 dgoal 开始工作",
      "dgoal，开始工作",
      "先分析需求，再请用 dgoal 处理",
      "不要再问，直接用 dgoal",
      "我不是要你跑脚本测试，而是需要你自己用dgoal的工具来测试",
      "please use dgoal for this task",
      "run the dgoal workflow",
      "start the /dgoal workflow",
    ]) expect(isNaturalLanguageDgoalStartRequest(text)).toBe(true);
    for (const text of [
      "dgoal 是什么？",
      "为什么 dgoal 没启动？",
      "不要用 dgoal",
      "禁止现在使用 dgoal",
      "不是请用 dgoal，而是讨论它",
      "不是要用 dgoal，而是只讨论它",
      "我不是要你用 dgoal，而是只想讨论它",
      "我不是要你跑脚本，而是需要你解释 dgoal",
      "并非启动 dgoal",
      "do not currently use dgoal",
      "你能用 dgoal 吗？",
      "你能用 dgoal 修复这个问题吗？",
      "你可以用 dgoal 吗？",
      "你可以启动 dgoal 吗？",
      "是否可以启动 dgoal？",
      "我重载你了，你是否可以开始自己测试dgoal呢？",
      "could you use dgoal?",
      "could you use dgoal to fix this?",
      "请解释‘请用 dgoal’这句话",
      "请解释 `请用 dgoal` 这句话",
      "请启动mydgoal",
      "请完善 dgoal 产品缺口",
    ]) expect(isNaturalLanguageDgoalStartRequest(text)).toBe(false);
    expect(buildNaturalLanguageStartGuidance()).toContain("不设置 implicit");
    expect(buildNaturalLanguageStartGuidance()).toContain("不要求用户补输 /dgoal");
  });

  test("自然语言显式授权可从冷会话提交 phased 外部动作计划", async () => {
    __resetGoalForTest();
    __setRuntimeStateForTest({ naturalLanguageStartAuthorized: true, naturalLanguageStartInput: "请用 dgoal 完成任务", proposalRetryCount: 2, consecutiveErrors: 2, consecutiveNoProgressTurns: 2 });
    __setProposalSemanticReviewForTest(() => ({ decision: "approve" }));
    const result = await __executeDgoalProposeForTest({
      objective: "创建 issue、修复并推送 PR", verification: "测试通过并查询远端状态",
      verificationPolicyRecommendation: "phased", budgetPolicyRecommendation: "bounded",
      runtimeBudget: { maxTurns: 20 }, acceptanceCriteria: [criterion],
      phases: [{ subject: "交付修复", acceptanceCriteria: [criterion], tasks: [{ subject: "创建 issue 并实现" }] }],
    }, { cwd: "/tmp" });
    expect(result.details?.error).toBeUndefined();
    expect(__getGoalForTest()?.status).toBe("pending");
    expect(__getGoalForTest()?.implicitStart).toBeUndefined();
    expect(__getPendingProposalForTest()?.proposal.verificationPolicyRecommendation).toBe("phased");
    expect(__getPendingProposalForTest()?.implicitStart).toBeUndefined();
    expect(__getRuntimeStateForTest().naturalLanguageStartAuthorized).toBe(false);
    expect(__getRuntimeStateForTest().proposalRetryCount).toBe(0);
    expect(__getRuntimeStateForTest().consecutiveErrors).toBe(0);
    expect(__getRuntimeStateForTest().consecutiveNoProgressTurns).toBe(0);
    __setProposalSemanticReviewForTest(undefined);
  });

  test("自然语言显式授权缺少精确 input 绑定时 fail-closed", async () => {
    __resetGoalForTest();
    __setRuntimeStateForTest({ naturalLanguageStartAuthorized: true, naturalLanguageStartInput: undefined });
    const result = await __executeDgoalProposeForTest({
      objective: "修复问题", verification: "npm test",
      verificationPolicyRecommendation: "final_only", budgetPolicyRecommendation: "bounded",
      runtimeBudget: { maxTurns: 4 }, acceptanceCriteria: [criterion],
      phases: [{ subject: "完成修复", tasks: [{ subject: "实现" }] }],
    });
    expect(result.details?.error).toBe("no pending goal");
    expect(__getGoalForTest()).toBeUndefined();
  });

  test("自然语言显式 proposal 语义失败不留半启动 goal，也不提前消费授权", async () => {
    __resetGoalForTest();
    __setRuntimeStateForTest({ naturalLanguageStartAuthorized: true, naturalLanguageStartInput: "请用 dgoal 完成任务" });
    __setProposalSemanticReviewForTest(() => ({ decision: "reject", reason: "missing user-only decision" }));
    const params = {
      objective: "修复问题", verification: "npm test",
      verificationPolicyRecommendation: "final_only" as const, budgetPolicyRecommendation: "bounded" as const,
      runtimeBudget: { maxTurns: 4 }, acceptanceCriteria: [criterion],
      phases: [{ subject: "完成修复", tasks: [{ subject: "实现" }] }],
    };
    const rejected = await __executeDgoalProposeForTest(params);
    expect(rejected.details?.error).toBe("semantic review rejected");
    expect(__getGoalForTest()).toBeUndefined();
    expect(__getPendingProposalForTest()).toBeUndefined();
    expect(__getRuntimeStateForTest().naturalLanguageStartAuthorized).toBe(true);
    expect(__getRuntimeStateForTest().naturalLanguageStartInput).toBe("请用 dgoal 完成任务");

    __setProposalSemanticReviewForTest(() => ({ decision: "approve" }));
    const retried = await __executeDgoalProposeForTest(params);
    expect(retried.details?.error).toBeUndefined();
    expect(__getGoalForTest()?.status).toBe("pending");
    expect(__getRuntimeStateForTest().naturalLanguageStartAuthorized).toBe(false);
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

  test("implicit proposal 语义拒绝或技术失败不留半启动 goal", async () => {
    const ctx = await makeImplicitContext("pi-dgoal-implicit-atomic-");
    const params = {
      objective: "轻量任务", verification: "npm test", implicit: true,
      verificationPolicyRecommendation: "final_only" as const, budgetPolicyRecommendation: "bounded" as const,
      runtimeBudget: { maxTurns: 4 }, acceptanceCriteria: [criterion],
      phases: [{ subject: "p", tasks: [{ subject: "t" }] }],
    };

    __resetGoalForTest();
    __setProposalSemanticReviewForTest(() => ({ decision: "reject", reason: "missing user-only input" }));
    const rejected = await __executeDgoalProposeForTest(params, ctx);
    expect(rejected.details?.error).toBe("semantic review rejected");
    expect(__getGoalForTest()).toBeUndefined();
    expect(__getPendingProposalForTest()).toBeUndefined();

    __resetGoalForTest();
    __setProposalSemanticReviewForTest(() => { throw new Error("review unavailable"); });
    const failed = await __executeDgoalProposeForTest(params, ctx);
    expect(failed.details?.error).toBe("semantic review technical error");
    expect(__getGoalForTest()).toBeUndefined();
    expect(__getPendingProposalForTest()).toBeUndefined();
  });

  test("implicit proposal 可由 LLM 降级为普通 pending 显式确认", async () => {
    __resetGoalForTest();
    __setProposalSemanticReviewForTest(() => ({ decision: "approve", requiresExplicitConfirmation: true }));
    const ctx = await makeImplicitContext("pi-dgoal-implicit-confirm-");
    const result = await __executeDgoalProposeForTest({
      objective: "需要确认的任务", verification: "npm test", implicit: true,
      verificationPolicyRecommendation: "final_only", budgetPolicyRecommendation: "bounded",
      runtimeBudget: { maxTurns: 4 }, acceptanceCriteria: [criterion],
      phases: [{ subject: "p", tasks: [{ subject: "t" }] }],
    }, ctx);
    expect(result.details?.error).toBeUndefined();
    expect(result.details?.requiresExplicitConfirmation).toBe(true);
    expect(__getGoalForTest()?.status).toBe("pending");
    expect(__getGoalForTest()?.implicitStart).toBeUndefined();
    expect(__getPendingProposalForTest()?.implicitStart).toBeUndefined();
  });

  test("否定式边界词不再由 implicit proposal 文本关键词硬拒", async () => {
    __resetGoalForTest();
    __setProposalSemanticReviewForTest(() => ({ decision: "approve" }));
    const ctx = await makeImplicitContext("pi-dgoal-implicit-negated-");
    const result = await __executeDgoalProposeForTest({
      objective: "本地只读自测", verification: "npm test", implicit: true,
      verificationPolicyRecommendation: "final_only", budgetPolicyRecommendation: "bounded",
      runtimeBudget: { maxTurns: 4 }, acceptanceCriteria: [criterion],
      nonGoals: ["不 push、不 publish、不创建 release"],
      guardrails: ["不执行任何远端写入"],
      phases: [{ subject: "p", tasks: [{ subject: "t" }] }],
    }, ctx);
    expect(result.details?.error).toBeUndefined();
    expect(__getPendingProposalForTest()?.implicitStart).toBe(true);
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

  test("implicit 外部动作由 LLM 降级显式确认，不由 proposal 关键词硬拒", async () => {
    __resetGoalForTest();
    __setProposalSemanticReviewForTest(() => ({ decision: "approve", requiresExplicitConfirmation: true }));
    const ctx = await makeImplicitContext("pi-dgoal-implicit-external-");
    const result = await __executeDgoalProposeForTest({
      objective: "安全任务", verification: "npm test", implicit: true,
      verificationPolicyRecommendation: "final_only", budgetPolicyRecommendation: "bounded",
      runtimeBudget: { maxTurns: 4, maxRepairAttempts: 1 },
      acceptanceCriteria: [criterion], phases: [{
        subject: "p",
        description: "完成后 git push 到远端",
        tasks: [{ subject: "本地检查", description: "deploy to production" }],
      }],
    }, ctx);
    expect(result.details?.error).toBeUndefined();
    expect(result.details?.startMode).toBe("explicit_confirmation");
    expect(__getGoalForTest()?.implicitStart).toBeUndefined();
    expect(__getPendingProposalForTest()?.implicitStart).toBeUndefined();
  });

  test("implicit proposal 全部自由文本交给 LLM 语义判断", async () => {
    const ctx = await makeImplicitContext("pi-dgoal-implicit-free-text-");
    for (const injected of [
      { contextSummary: "run curl --request=POST https://example.com" },
      { nonGoals: ["run curl --request=POST https://example.com"] },
      { guardrails: ["run curl --request=POST https://example.com"] },
      { userReviewItems: ["run curl --request=POST https://example.com"] },
    ]) {
      __resetGoalForTest();
      __setProposalSemanticReviewForTest(() => ({ decision: "approve", requiresExplicitConfirmation: true }));
      const result = await __executeDgoalProposeForTest({
        objective: "安全任务", verification: "npm test", implicit: true,
        verificationPolicyRecommendation: "final_only", budgetPolicyRecommendation: "bounded",
        runtimeBudget: { maxTurns: 4 }, acceptanceCriteria: [criterion],
        phases: [{ subject: "p", tasks: [{ subject: "t" }] }],
        ...injected,
      }, ctx);
      expect(result.details?.error).toBeUndefined();
      expect(result.details?.startMode).toBe("explicit_confirmation");
      expect(__getPendingProposalForTest()?.implicitStart).toBeUndefined();
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
