import { describe, expect, test } from "bun:test";
import {
  createEmptyWorkList,
  detectWorkItemCycle,
  findPhaseIndexByItem,
  flattenWorkItems,
  validateWorkList,
  validatePlannedWorkList,
  type WorkList,
} from "../src/work-list/index.ts";
import { applyWorkListMutation } from "../src/work-list/reducer.ts";

function expectSuccess(result: ReturnType<typeof applyWorkListMutation>) {
  expect(result.op.kind).not.toBe("error");
  return result.list;
}

function expectError(result: ReturnType<typeof applyWorkListMutation>, text: string) {
  expect(result.op.kind).toBe("error");
  if (result.op.kind === "error") expect(result.op.message).toContain(text);
}

describe("Work List pure data model", () => {
  test("flat soft items need no hidden Phase and may omit description", () => {
    const empty = createEmptyWorkList();
    const result = applyWorkListMutation(empty, "create_item", { subject: "先看看" });
    expect(result.op).toEqual({ kind: "create_item", itemId: 1 });
    expect(result.list).toEqual({
      items: [{ id: 1, subject: "先看看", status: "pending" }],
      phases: [],
      nextItemId: 2,
      nextPhaseId: 1,
      revision: 1,
    });
    expect(empty).toEqual(createEmptyWorkList());
  });

  test("real Phase and Work Item IDs use independent namespaces", () => {
    let list = expectSuccess(applyWorkListMutation(createEmptyWorkList(), "create_phase", {
      subject: "第一阶段",
      description: "形成首个真实边界",
    }));
    const created = applyWorkListMutation(list, "create_item", {
      phaseId: 1,
      subject: "实现切片",
      description: "完成本阶段真实工作",
    }, { planned: true });
    list = expectSuccess(created);
    expect(created.op).toEqual({ kind: "create_item", itemId: 1, phaseId: 1 });
    expect(list.phases[0].id).toBe(1);
    expect(list.phases[0].items[0].id).toBe(1);
    expect(list.nextItemId).toBe(2);
    expect(list.nextPhaseId).toBe(2);
    expect(findPhaseIndexByItem(list, 1)).toBe(0);
  });

  test("root and phased items flatten once and retain immutable inputs", () => {
    let list = expectSuccess(applyWorkListMutation(createEmptyWorkList(), "create_item", { subject: "前置" }));
    list = expectSuccess(applyWorkListMutation(list, "create_phase", { subject: "阶段", description: "真实阶段" }));
    const before = structuredClone(list);
    const result = applyWorkListMutation(list, "create_item", { phaseId: 1, subject: "阶段项" });
    expect(flattenWorkItems(result.list).map((item) => item.subject)).toEqual(["前置", "阶段项"]);
    expect(list).toEqual(before);
    expect(result.list).not.toBe(list);
    expect(result.list.phases).not.toBe(list.phases);
  });

  test("planned mode requires description and completion evidence", () => {
    let list = expectSuccess(applyWorkListMutation(createEmptyWorkList(), "create_item", {
      subject: "交付",
      description: "生成结果",
      deliverables: [{ target: "out.txt", description: "文件存在" }],
    }, { planned: true }));
    list = expectSuccess(applyWorkListMutation(list, "update_item", { id: 1, status: "in_progress" }, { planned: true }));
    expectError(applyWorkListMutation(list, "update_item", { id: 1, status: "done" }, { planned: true }), "requires evidence");
    expectError(applyWorkListMutation(list, "update_item", {
      id: 1,
      status: "done",
      evidence: "文件可读",
    }, { planned: true }), "every declared deliverable");
    const done = applyWorkListMutation(list, "update_item", {
      id: 1,
      status: "done",
      evidence: "read out.txt 成功",
      deliverableEvidence: [{ target: "out.txt", evidence: "内容匹配" }],
    }, { planned: true });
    expect(done.op.kind).toBe("update_item");
    expect(done.list.items[0].status).toBe("done");
    expectError(applyWorkListMutation(done.list, "update_item", { id: 1, status: "in_progress" }, { planned: true }), "illegal");
  });

  test("soft mode may close without evidence but planned validation rejects it", () => {
    let list = expectSuccess(applyWorkListMutation(createEmptyWorkList(), "create_item", { subject: "轻量项" }));
    list = expectSuccess(applyWorkListMutation(list, "update_item", { id: 1, status: "in_progress" }));
    list = expectSuccess(applyWorkListMutation(list, "update_item", { id: 1, status: "done" }));
    expect(list.items[0].status).toBe("done");
    const validation = validatePlannedWorkList(list);
    expect(validation.ok).toBeFalse();
    expect(validation.errors.join("\n")).toContain("description");
    expect(validation.errors.join("\n")).toContain("evidence");
  });

  test("blocked and abandoned require their own reasons", () => {
    const list = expectSuccess(applyWorkListMutation(createEmptyWorkList(), "create_item", { subject: "可能放弃" }));
    expectError(applyWorkListMutation(list, "update_item", { id: 1, status: "blocked" }), "blockedReason");
    expectError(applyWorkListMutation(list, "update_item", { id: 1, status: "abandoned" }), "abandonedReason");
    const abandoned = applyWorkListMutation(list, "update_item", {
      id: 1,
      status: "abandoned",
      abandonedReason: "目标已不再需要",
    });
    expect(abandoned.list.items[0]).toMatchObject({ status: "abandoned", abandonedReason: "目标已不再需要" });
    expectError(applyWorkListMutation(abandoned.list, "update_item", { id: 1, status: "in_progress" }), "illegal");
  });

  test("dependencies must exist, stay acyclic and be done before execution", () => {
    let list = expectSuccess(applyWorkListMutation(createEmptyWorkList(), "create_item", { subject: "A" }));
    list = expectSuccess(applyWorkListMutation(list, "create_item", { subject: "B", blockedBy: [1, 1] }));
    expect(list.items[1].blockedBy).toEqual([1]);
    expectError(applyWorkListMutation(list, "update_item", { id: 1, addBlockedBy: [2] }), "依赖环");
    expectError(applyWorkListMutation(list, "update_item", { id: 2, status: "in_progress" }), "unresolved");
    expectError(applyWorkListMutation(list, "update_item", { id: 2, addBlockedBy: [99] }), "不存在");
    expect(detectWorkItemCycle(list.items, 1, [2])).toBeTrue();
  });

  test("a phased item cannot depend on a future Phase", () => {
    const list: WorkList = {
      items: [],
      phases: [
        { id: 1, subject: "一", description: "先完成", status: "in_progress", items: [{ id: 1, subject: "A", description: "A", status: "pending" }] },
        { id: 2, subject: "二", description: "后完成", status: "pending", items: [{ id: 2, subject: "B", description: "B", status: "pending" }] },
      ],
      nextItemId: 3,
      nextPhaseId: 3,
      revision: 0,
    };
    expectError(applyWorkListMutation(list, "update_item", { id: 1, addBlockedBy: [2] }, { planned: true }), "未来 Phase");
    expect(validatePlannedWorkList({
      ...list,
      phases: [
        { ...list.phases[0], items: [{ ...list.phases[0].items[0], blockedBy: [2] }] },
        list.phases[1],
      ],
    }).errors.join("\n")).toContain("未来 Phase");
  });

  test("later Phases cannot advance before the current Phase is explicitly done", () => {
    let list = expectSuccess(applyWorkListMutation(createEmptyWorkList(), "create_phase", { subject: "一", description: "先" }));
    list = expectSuccess(applyWorkListMutation(list, "create_phase", { subject: "二", description: "后" }));
    expectError(applyWorkListMutation(list, "create_item", { phaseId: 2, subject: "越序" }), "阶段顺序违规");
    const withClosedFirst: WorkList = { ...list, phases: [{ ...list.phases[0], status: "done" }, list.phases[1]] };
    const created = applyWorkListMutation(withClosedFirst, "create_item", { phaseId: 2, subject: "合法" });
    expect(created.op.kind).toBe("create_item");
  });

  test("member exhaustion never auto-closes a Phase", () => {
    let list = expectSuccess(applyWorkListMutation(createEmptyWorkList(), "create_phase", { subject: "阶段", description: "显式收口" }));
    list = expectSuccess(applyWorkListMutation(list, "create_item", { phaseId: 1, subject: "项", description: "完成项" }, { planned: true }));
    list = expectSuccess(applyWorkListMutation(list, "update_item", { id: 1, status: "in_progress" }, { planned: true }));
    list = expectSuccess(applyWorkListMutation(list, "update_item", { id: 1, status: "done", evidence: "已验证" }, { planned: true }));
    expect(list.phases[0].items[0].status).toBe("done");
    expect(list.phases[0].status).toBe("in_progress");
  });

  test("strict validation accepts a normalized planned Work List", () => {
    const list: WorkList = {
      items: [{ id: 1, subject: "前置", description: "建立事实", status: "done", evidence: "命令通过" }],
      phases: [{
        id: 1,
        subject: "交付",
        description: "完成目标",
        status: "pending",
        items: [{ id: 2, subject: "实现", description: "最小实现", status: "pending", blockedBy: [1] }],
      }],
      nextItemId: 3,
      nextPhaseId: 2,
      revision: 0,
    };
    expect(validatePlannedWorkList(list)).toEqual({ ok: true, errors: [] });
  });

  test("validation fails closed instead of throwing on damaged persisted shapes", () => {
    const malformed: unknown[] = [
      { items: [null], phases: [], nextItemId: 2, nextPhaseId: 1, revision: 0 },
      { items: [], phases: [{ id: 1, subject: 7, description: "x", status: "pending", items: [] }], nextItemId: 1, nextPhaseId: 2, revision: 0 },
      { items: [{ id: 1, subject: "x", status: "pending", blockedBy: 2 }], phases: [], nextItemId: 2, nextPhaseId: 1, revision: 0 },
      { items: [{ id: 1, subject: "x", status: "done", evidence: "ok", deliverables: { target: "x" } }], phases: [], nextItemId: 2, nextPhaseId: 1, revision: 0 },
      { items: [], phases: [{ id: 1, subject: "p", description: "p", status: "done", revision: 0, items: [], check: { status: "approved", revision: 0, checkedAt: "bad" } }], nextItemId: 1, nextPhaseId: 2, revision: 0 },
      { items: [], phases: [], nextItemId: 1, nextPhaseId: 1, revision: 0, unexpected: true },
    ];
    for (const candidate of malformed) {
      expect(() => validateWorkList(candidate as WorkList)).not.toThrow();
      expect(validateWorkList(candidate as WorkList).ok).toBeFalse();
    }
  });
});
