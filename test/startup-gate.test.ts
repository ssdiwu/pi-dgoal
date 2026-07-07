// 切片 4：启动闸门——proposal 格式化 + proposalToPlan 转换测试（纯函数）。
// 见 doc/40-版本实施方案/41-v0.2.0-TaskPlan与建检循环实施方案.md 切片 4 验收。
import { describe, expect, test } from "bun:test";

import { __handleProposalConfirmationForTest, __setI18nForTest, assessProposalReadiness, buildProposalConfirmationOptions, formatProposalConfirmTitle, formatProposalForConfirm, proposalToPlan, validateProposalInput, type GoalState, type PlanProposal } from "../index.ts";

// proposalToPlan 已 export；这里同时覆盖确认展示与提案转 plan 的纯函数行为。

function goal(): GoalState {
  return { id: "g1", objective: "修测试", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 };
}

describe("切片4 · validateProposalInput（verification 必填，ADR 0007）", () => {
  test("缺 verification 被拒（no verification）", () => {
    const r = validateProposalInput({ objective: "o", phaseCount: 1 });
    expect(r).not.toBeNull();
    expect(r!.error).toBe("no verification");
    expect(r!.message).toContain("verification");
  });

  test("verification 为空字符串 / 纯空白被拒", () => {
    expect(validateProposalInput({ objective: "o", verification: "   ", phaseCount: 1 })).not.toBeNull();
    expect(validateProposalInput({ objective: "o", verification: "", phaseCount: 1 })).not.toBeNull();
  });

  test("有明确 verification 通过", () => {
    expect(validateProposalInput({ objective: "o", verification: "npm test 全过且 RPC 测试确认命令注册", phaseCount: 2 })).toBeNull();
  });

  test("缺 objective 被拒（no objective）", () => {
    const r = validateProposalInput({ objective: "", verification: "v", phaseCount: 1 });
    expect(r!.error).toBe("no objective");
  });

  test("validateProposalInput 的固定错误文案可被英文 i18n 覆盖", () => {
    __setI18nForTest({
      t: (key: string) => key.endsWith(".proposal.validate.noObjective") ? "proposal must include an objective (goal summary)." : undefined,
    });
    try {
      const r = validateProposalInput({ objective: "", verification: "v", phaseCount: 1 });
      expect(r?.message).toBe("proposal must include an objective (goal summary).");
    } finally {
      __setI18nForTest(undefined);
    }
  });

  test("phases 为空被拒（no phases，向后兼容）", () => {
    const r = validateProposalInput({ objective: "o", verification: "v", phaseCount: 0 });
    expect(r!.error).toBe("no phases");
  });
});

describe("提案就绪度评估", () => {
  test("已有 objective + verification + phases，但缺边界字段时 = L2，并显式暴露 non-goals 缺口", () => {
    const readiness = assessProposalReadiness({
      objective: "修好 auth 测试",
      verification: "npm test auth 全过",
      phaseCount: 2,
    });
    expect(readiness.level).toBe("L2");
    expect(readiness.gaps).toContain("nonGoals");
    expect(readiness.gaps).toContain("guardrails");
    expect(readiness.gaps).toContain("budget");
  });

  test("边界字段齐备时 = L3", () => {
    const readiness = assessProposalReadiness({
      objective: "修好 auth 测试",
      verification: "npm test auth 全过",
      phaseCount: 2,
      nonGoals: ["不重构 i18n 框架"],
      guardrails: ["不改跨会话状态"],
      budget: "预计 2-3 轮，先跑 bun test",
    });
    expect(readiness.level).toBe("L3");
    expect(readiness.gaps).toEqual([]);
  });
});

describe("切片4 · buildProposalConfirmationOptions", () => {
  test("默认摘要态与 task 明细态使用短切换文案", () => {
    expect(buildProposalConfirmationOptions(false)).toEqual(["确认，开始执行", "拒绝，放弃目标", "输入反馈意见", "展开 task"]);
    expect(buildProposalConfirmationOptions(true)).toEqual(["确认，开始执行", "拒绝，放弃目标", "输入反馈意见", "收起 task"]);
  });

  test("pi-di18n 可覆盖切换文案为英文短标签", () => {
    __setI18nForTest({
      t(fullKey, params) {
        const messages: Record<string, string> = {
          "dgoal.proposal.confirmStart": "Confirm and start",
          "dgoal.proposal.reject": "Reject and abandon goal",
          "dgoal.proposal.feedback": "Enter feedback",
          "dgoal.proposal.viewTasks": "Show tasks",
          "dgoal.proposal.backToSummary": "Hide tasks",
        };
        return (messages[fullKey] ?? fullKey).replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, name) => String(params?.[name] ?? `{${name}}`));
      },
    });
    try {
      expect(buildProposalConfirmationOptions(false)).toEqual(["Confirm and start", "Reject and abandon goal", "Enter feedback", "Show tasks"]);
      expect(buildProposalConfirmationOptions(true)).toEqual(["Confirm and start", "Reject and abandon goal", "Enter feedback", "Hide tasks"]);
    } finally {
      __setI18nForTest(undefined);
    }
  });
});

describe("切片4 · handleProposalConfirmation", () => {
  test("可在摘要/明细间往返切换，再执行拒绝", async () => {
    const proposal: PlanProposal = {
      objective: "修好 auth 测试",
      verification: "npm test auth 全过",
      phases: [{ subject: "修复登录", tasks: [{ subject: "修登录用例" }] }],
    };
    const titles: string[] = [];
    const optionsSeen: string[][] = [];
    const choices = ["展开 task", "收起 task", "拒绝，放弃目标"];
    const result = await __handleProposalConfirmationForTest(
      {
        cwd: process.cwd(),
        ui: {
          confirm: async () => true,
          notify: () => {},
          setStatus: () => {},
          select: async (title: string, options: string[]) => {
            titles.push(title);
            optionsSeen.push(options);
            return choices.shift();
          },
          editor: async () => undefined,
        },
      } as never,
      goal(),
      proposal,
    );
    expect(result).toBe("rejected");
    expect(titles).toHaveLength(3);
    expect(titles[0]).not.toContain("- task 1: 修登录用例");
    expect(titles[1]).toContain("- task 1: 修登录用例");
    expect(titles[2]).not.toContain("- task 1: 修登录用例");
    expect(optionsSeen[0][3]).toBe("展开 task");
    expect(optionsSeen[1][3]).toBe("收起 task");
    expect(optionsSeen[2][3]).toBe("展开 task");
  });

  test("选择反馈意见时调用 editor 并返回去首尾空白后的反馈", async () => {
    const proposal: PlanProposal = {
      objective: "修好 auth 测试",
      verification: "npm test auth 全过",
      phases: [{ subject: "修复登录", tasks: [{ subject: "修登录用例" }] }],
    };
    const editorCalls: Array<{ title: string; prefill: string }> = [];
    const result = await __handleProposalConfirmationForTest(
      {
        cwd: process.cwd(),
        ui: {
          confirm: async () => true,
          notify: () => {},
          setStatus: () => {},
          select: async () => "输入反馈意见",
          editor: async (title: string, prefill: string) => {
            editorCalls.push({ title, prefill });
            return "  请先补一个回归测试  ";
          },
        },
      } as never,
      goal(),
      proposal,
    );
    expect(result).toEqual({ feedback: "请先补一个回归测试" });
    expect(editorCalls).toEqual([{ title: "反馈意见（agent 会据此调整计划）：", prefill: "" }]);
  });
});

describe("切片4 · formatProposalForConfirm", () => {
  test("默认只显示目标 + phase 列表 + task 计数，不展开 task 明细", () => {
    const proposal: PlanProposal = {
      objective: "修好 auth 测试",
      verification: "npm test auth 全过",
      phases: [
        {
          subject: "修复登录",
          tasks: [
            { subject: "修登录用例", description: "覆盖 token 过期", activeForm: "正在修登录", blockedBy: [1] },
            { subject: "修权限用例" },
          ],
        },
        { subject: "加回归测试" },
      ],
    };
    const text = formatProposalForConfirm(goal(), proposal);
    expect(text).toContain("目标：修好 auth 测试");
    expect(text).toContain("验证：npm test auth 全过");
    expect(text).toContain("就绪度：L2");
    expect(text).toContain("缺口提示：");
    expect(text).toContain("non-goals：未显式声明这个 goal 不做什么");
    expect(text).toContain("阶段计划（2 个 phase）");
    expect(text).toContain("1. 修复登录（2 个 task）");
    expect(text).not.toContain("- task 1: 修登录用例");
    expect(text).not.toContain("说明：覆盖 token 过期");
    expect(text).not.toContain("进行时：正在修登录");
    expect(text).not.toContain("依赖：#1");
    expect(text).not.toContain("- task 2: 修权限用例");
    expect(text).toContain("2. 加回归测试"); // 无 task 不显示计数
  });

  test("showTasks=true 时显示 task 明细与已提供的边界字段", () => {
    const proposal: PlanProposal = {
      objective: "修好 auth 测试",
      verification: "npm test auth 全过",
      nonGoals: ["不拆 PR"],
      guardrails: ["不改跨会话状态"],
      budget: "预计 2 轮内完成",
      phases: [
        {
          subject: "修复登录",
          tasks: [
            { subject: "修登录用例", description: "覆盖 token 过期", activeForm: "正在修登录", blockedBy: [1] },
            { subject: "修权限用例" },
          ],
        },
      ],
    };
    const text = formatProposalForConfirm(goal(), proposal, { showTasks: true });
    expect(text).toContain("就绪度：L3");
    expect(text).toContain("不做什么：不拆 PR");
    expect(text).toContain("护栏：不改跨会话状态");
    expect(text).toContain("预算：预计 2 轮内完成");
    expect(text).toContain("1. 修复登录（2 个 task）");
    expect(text).toContain("- task 1: 修登录用例");
    expect(text).toContain("说明：覆盖 token 过期");
    expect(text).toContain("进行时：正在修登录");
    expect(text).toContain("依赖：#1");
    expect(text).toContain("- task 2: 修权限用例");
  });

  test("无 verification 时不显示验证行", () => {
    const proposal: PlanProposal = {
      objective: "目标",
      phases: [{ subject: "p1" }],
    };
    const text = formatProposalForConfirm(goal(), proposal);
    expect(text).not.toContain("验证：");
  });

  test("phase 带 description 显示", () => {
    const proposal: PlanProposal = {
      objective: "o",
      phases: [{ subject: "p1", description: "阶段说明" }],
    };
    const text = formatProposalForConfirm(goal(), proposal);
    expect(text).toContain("阶段说明");
  });

  test("空 phases 也能格式化（虽工具层会拒）", () => {
    const proposal: PlanProposal = { objective: "o", phases: [] };
    const text = formatProposalForConfirm(goal(), proposal);
    expect(text).toContain("阶段计划（0 个 phase）");
  });

  test("确认标题默认只包含阶段概览，查看 task 明细时才展开", () => {
    const proposal: PlanProposal = {
      objective: "修好 auth 测试",
      verification: "npm test auth 全过",
      phases: [{ subject: "修复登录", description: "覆盖 token 过期", tasks: [{ subject: "修登录用例" }] }],
    };
    const summaryTitle = formatProposalConfirmTitle(goal(), proposal);
    expect(summaryTitle).toContain("确认 /dgoal 计划？");
    expect(summaryTitle).toContain("目标：修好 auth 测试");
    expect(summaryTitle).toContain("验证：npm test auth 全过");
    expect(summaryTitle).toContain("就绪度：L2");
    expect(summaryTitle).toContain("1. 修复登录（1 个 task）");
    expect(summaryTitle).not.toContain("- task 1: 修登录用例");
    expect(summaryTitle).toContain("覆盖 token 过期");

    const detailTitle = formatProposalConfirmTitle(goal(), proposal, { showTasks: true });
    expect(detailTitle).toContain("- task 1: 修登录用例");
  });

  test("pi-di18n 可覆盖确认 UI 文案为英文", () => {
    __setI18nForTest({
      t(fullKey, params) {
        const messages: Record<string, string> = {
          "dgoal.proposal.objective": "Goal: {objective}",
          "dgoal.proposal.verification": "Verification: {verification}",
          "dgoal.proposal.readiness": "Readiness: {level} ({meaning})",
          "dgoal.proposal.readiness.meaning.L2": "goal, acceptance, and phase plan exist; boundary declarations still have gaps",
          "dgoal.proposal.gapsHeading": "Gaps:",
          "dgoal.proposal.gap.nonGoals": "  - non-goals: the plan never states what this goal will not do",
          "dgoal.proposal.gap.guardrails": "  - guardrails: high-risk boundaries / explicit do-not-touch areas are missing",
          "dgoal.proposal.gap.budget": "  - budget: missing cost or turn-boundary expectations",
          "dgoal.proposal.planHeading": "Phase plan ({count} phases):",
          "dgoal.proposal.taskCount": " ({count} tasks)",
          "dgoal.proposal.taskLine": "     - task {index}: {subject}",
          "dgoal.proposal.confirmTitleWithPlan": "Confirm /dgoal plan?\n\n{plan}",
          "dgoal.replaceConfirm.title": "Replace current dgoal?",
          "dgoal.replaceConfirm.message": "Current goal: {current}\n\nNew goal: {next}",
        };
        return (messages[fullKey] ?? fullKey).replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, name) => String(params?.[name] ?? `{${name}}`));
      },
    });
    try {
      const proposal: PlanProposal = {
        objective: "fix tests",
        verification: "npm test",
        phases: [{ subject: "repair", tasks: [{ subject: "update assertions" }] }],
      };
      const text = formatProposalForConfirm(goal(), proposal);
      const detailText = formatProposalForConfirm(goal(), proposal, { showTasks: true });
      const title = formatProposalConfirmTitle(goal(), proposal);
      expect(text).toContain("Goal: fix tests");
      expect(text).toContain("Verification: npm test");
      expect(text).toContain("Readiness: L2");
      expect(text).toContain("Gaps:");
      expect(text).toContain("Phase plan (1 phases):");
      expect(text).toContain("1. repair (1 tasks)");
      expect(text).not.toContain("- task 1: update assertions");
      expect(detailText).toContain("- task 1: update assertions");
      expect(text).not.toContain("Confirm /dgoal plan?");
      expect(title).toContain("Confirm /dgoal plan?");
      expect(title).toContain("Goal: fix tests");
    } finally {
      __setI18nForTest(undefined);
    }
  });
});

describe("切片4 · proposalToPlan 转换（id 分配）", () => {
  test("phase 和 task 顺序分配 id，nextId 递增", () => {
    const proposal: PlanProposal = {
      objective: "o",
      phases: [
        { subject: "p1", tasks: [{ subject: "t1" }, { subject: "t2" }] },
        { subject: "p2", tasks: [{ subject: "t3" }] },
      ],
    };
    const plan = proposalToPlan(proposal);
    expect(plan.phases[0].id).toBe(1);
    expect(plan.phases[0].tasks[0].id).toBe(2);
    expect(plan.phases[0].tasks[1].id).toBe(3);
    expect(plan.phases[1].id).toBe(4);
    expect(plan.phases[1].tasks[0].id).toBe(5);
    expect(plan.nextId).toBe(6);
  });

  test("初始 task 状态为 pending", () => {
    const proposal: PlanProposal = {
      objective: "o",
      phases: [{ subject: "p", tasks: [{ subject: "t", activeForm: "正在做" }] }],
    };
    const plan = proposalToPlan(proposal);
    expect(plan.phases[0].tasks[0].status).toBe("pending");
    expect(plan.phases[0].tasks[0].activeForm).toBe("正在做");
  });

  test("phase 无 task 时 tasks 为空数组", () => {
    const proposal: PlanProposal = { objective: "o", phases: [{ subject: "p" }] };
    const plan = proposalToPlan(proposal);
    expect(plan.phases[0].tasks).toEqual([]);
    expect(plan.phases[0].status).toBe("pending");
  });

  test("task blockedBy 为字符串 '[1]' → 解析成局部索引 1", () => {
    // 模型可能把 tasks[].blockedBy stringify 成 "[1]"，proposalToPlan 要 coerce 回数组。
    const proposal: PlanProposal = {
      objective: "o",
      phases: [{ subject: "p", tasks: [{ subject: "t1" }, { subject: "t2", blockedBy: "[1]" }] }],
    };
    const plan = proposalToPlan(proposal);
    // t2 局部索引 1 → 全局 id（t1=2, phase=1, t2=3），blockedBy 指向 t1 的全局 id 2
    expect(plan.phases[0].tasks[1].blockedBy).toEqual([2]);
  });
});
