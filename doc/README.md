# doc 文档导航

> 本目录记录 dgoal 的核心原理、当前架构、外部能力参考、路线图与版本实施方案。**v0.8.1 当前实现**以 ADR 0051 为结构权威：每个 Goal 只有一份 Work List，Phase 仅按真实串行边界可选出现，Plan Contract 以 Execution / Goal Check / Staged Check 三档单向升级；公共接口为九个两词工具，持久化为 `dgoal-work-v1` + `dgoal-plan-history-v1`。ADR 0038 的旧结构与工具面只保留历史背景。

## 阅读顺序

接手 dgoal 或做架构/代码决策前，按以下顺序阅读：

1. `术语表.md` — 当前项目语言、状态与禁用同义词
2. `10-架构与运行/10-建检循环与三层结构.md` — Build-Check Loop（建检循环）、Goal / Work List / Plan Contract 的关系
3. `10-架构与运行/11-状态机.md` — Goal、Work Item、Phase、CheckRecord、暂停与关闭状态机
4. `10-架构与运行/12-工具命令与数据模型.md` — 九工具、`/dgoal` 命令、当前类型与双持久键
5. `10-架构与运行/13-启动闸门与TUI浮层.md` — 软清单/Execution 直建、高保障确认门与统一 TUI
6. `10-架构与运行/14-TUI边界与状态机容错.md` — TUI fail-soft（失败降级）与关闭清理顺序
7. `30-路线图/30-项目路线图.md` — v0.8.1 当前里程碑与后续候选
8. `40-版本实施方案/44-v0.8.1-单一工作清单与计划保障实施方案.md` — 当前版本规格与验收记录
9. `../index.ts` 与 `../src/` — 当前行为事实；`src/work-list/` 是数据层，`src/runtime/` 负责九工具与生命周期
10. `决策档案/README.md` — ADR 索引；结构先读 ADR 0051，再按主题追溯被覆盖决策

需要了解外部依据时，再读 `20-能力参考/`。`90-归档/` 与被 ADR 0051 覆盖的 ADR 只用于解释历史，不得作为当前工具、状态或持久化权威。

## 目录职责

| 目录 / 文件 | 职责 | 是否权威 |
|---|---|---|
| `术语表.md` | 当前概念、命名、状态与禁用同义词 | 是，命名权威 |
| `决策档案/` | 难逆转且有真实权衡的架构决策；入口为 `决策档案/README.md` | 是，决策权威 |
| `经验笔记.md` | 可变化的做法与避坑经验 | 否，活页参考 |
| `10-架构与运行/` | 当前运行架构、状态机、工具、启动闸门与 TUI 容错 | 是，当前实现权威 |
| `20-能力参考/` | 范式、外部项目与理论依据 | 事实参考，不决定排期 |
| `30-路线图/` | 已完成主干、后续候选与不做边界 | 是，路线图权威 |
| `40-版本实施方案/` | 版本级实施合同与验收记录 | 受路线图与 ADR 约束 |
| `90-归档/` | 早期底稿与历史方案 | 否，仅查历史 |

## 当前文档原则

1. **一 Goal 一 Work List**：不得建立计划内/计划外平行清单；软清单与 Plan Contract 共享同一结构。
2. **结构与保障正交**：Phase 只表达真实串行边界；Until Done、goal 终审、逐 Phase 建检由 Plan Contract Profile 决定。
3. **check / update 分离**：`phase_check` / `goal_check` 只记录审核；Phase / Goal done 只能由 `work_update` 写入，并匹配当前 revision。
4. **软清单不自动续跑**：soft Work List 跨 turn 保留，但没有 continuation、no-progress 计数或独立审核；Execution Plan 才增加 Until Done。
5. **高保障显式授权**：Goal Check / Staged Check 必须经用户授权、结构校验、语义预审和原子确认；失败不得留下半激活状态。
6. **Description 是执行说明**：Goal、真实 Phase、计划态 Work Item 必须有 Description；硬完成门属于 `acceptanceCriteria`，主观体验属于 `userReviewItems`。
7. **关闭必须可靠且可见**：完成写入后必须追加 null tombstone，清理 continuation / proposal / 熔断 / check snapshot / 授权，并返回结构化完成总结。
8. **History 只存耐久事实**：Plan Run History 保留结构、完成证据与 check 结论；不保存 auditor report、feedback、thinking 或 transcript，也不能 resume。
9. **LLM 语义、运行时结构化**：LLM 负责取舍；运行时不解析 assistant 文本或 shell 字符串，只观察 tool result、持久状态与可验证证据。
10. **TUI fail-soft**：状态、持久化、审核和渲染分离；UI 异常不能阻断或伪造生命周期。
