# doc 文档入口

> **v0.8.1 当前实现**以 ADR 0051 为结构权威，未完成计划恢复以 ADR 0052 为生命周期权威：每个 Goal 只有一份 Work List，Phase 仅按真实串行边界可选出现，Plan Contract 以 Execution / Goal Check / Staged Check 三档单向升级；公共接口为九个两词工具，状态条目为 `dgoal-work-v1` + `dgoal-plan-history-v1`，fork 边界另用只含 session ID 的 `dgoal-session-scope-v1` 元数据。ADR 0038 的旧结构与工具面只保留历史背景。

1. [术语表](./术语表.md)
2. [架构正文](./架构/) — 当前机制的唯一正文
3. [规格正文](./规格/) — 契约、接口与产品规则的唯一正文
4. [决策档案](./决策档案/) — 难逆转决定的刻碑
5. [经验笔记](./经验笔记.md)
6. [工程入口](../README.md) 与 [代理协作规则](../AGENTS.md)

`doc/架构/` 是当前机制的权威正文；`doc/规格/` 是当前版本契约与验收记录的权威正文；`doc/决策档案/` 是决策权威；`doc/references/` 只保存来源、验证证据、历史方案与路线图旧稿，不是现行权威。

## 架构正文（`doc/架构/`）

| 文件 | 回答什么 |
|---|---|
| [10-建检循环与三层结构.md](./架构/10-建检循环与三层结构.md) | Build-Check Loop（建检循环）、Goal / Work List / Plan Contract 的关系 |
| [11-状态机.md](./架构/11-状态机.md) | Goal、Work Item、Phase、CheckRecord、暂停与关闭状态机 |
| [12-工具命令与数据模型.md](./架构/12-工具命令与数据模型.md) | 九工具、`/dgoal` 命令、当前类型、状态条目与 fork scope 元数据 |
| [13-启动闸门与TUI浮层.md](./架构/13-启动闸门与TUI浮层.md) | 软清单/Execution 直建、高保障确认门与统一 TUI |
| [14-TUI边界与状态机容错.md](./架构/14-TUI边界与状态机容错.md) | TUI fail-soft（失败降级）与关闭清理顺序 |

## 规格正文（`doc/规格/`）

| 文件 | 回答什么 |
|---|---|
| [44-v0.8.1-单一工作清单与计划保障实施方案.md](./规格/44-v0.8.1-单一工作清单与计划保障实施方案.md) | 当前版本的产品行为约束、垂直切片与验收记录 |

## 决策与经验

- [决策档案/README.md](./决策档案/README.md)：ADR 索引。修订以「后记」追加，不改写原文。
- [经验笔记.md](./经验笔记.md)：可改的做法与避坑经验。

## 证据与历史（`doc/references/`）

只保存来源、验证记录与历史阶段，不维护第二份现行正文：

| 目录 | 内容 |
|---|---|
| `references/20-能力参考/` | 外部调研与范式对比来源 |
| `references/30-路线图/` | 项目路线图旧稿与后续候选 |
| `references/40-版本实施方案/` | 已完成版本的实施方案与归档记录 |
| `references/90-归档/` | 更早阶段的历史归档 |

## 维护规则

- 机制变化 → 更新 `doc/架构/` 对应正文；契约或验收规则变化 → 更新 `doc/规格/`；难逆转决策 → 新增 ADR 并同步索引；可复用做法 → 追加 `经验笔记.md`。
- 历史方案与来源沉淀 → 放入 `doc/references/` 对应子目录，不与现行正文并行维护。
- 用户可感知的已完成变化 → 日常写入本仓中文 `CHANGELOG-zh.md`，准备发布时按版本把同一版本条目同步进英文 `CHANGELOG.md`；两份只写用户可感知事实且都随 npm 包发布。

## Contributing (English)

- User-facing behavior and setup: [README.md](../README.md) / [README-zh.md](../README-zh.md), cross-linked at the top.
- Development and verification: `npm test`, `npm run test:rpc`, `npm run test:context`; see the Tests section of either README and `test/README.md`.
- Contracts: [AGENTS.md](../AGENTS.md), [规格/](./规格/), and [架构/](./架构/). Sections above are internal notes in Chinese.
