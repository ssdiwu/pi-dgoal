# doc 文档导航

> 本目录记录 dgoal 的核心原理、架构、能力参考、路线图和版本实施方案。当前主线：**三档 Plan 共享运行时——Task Plan 是日常自动规划入口，Phase Plan 只做 goal 终审，Goal Plan 做 phase + goal 两级独立审核；check 与完成状态分离**（ADR 0038）；phase/task ID 采用独立命名空间（ADR 0039）；goal / 可见 phase / task 使用必填 Description，`contextSummary` 已删除（ADR 0042）。

## 阅读顺序

接手 dgoal 或做架构/代码决策前，建议按这个顺序读：

1. `术语表.md` — dgoal 项目语言与禁用同义词；含**建检循环**第一性原理定义
2. `10-架构与运行/10-建检循环与三层结构.md` — 核心原理、三层内容、双可见性轴、建检不可绕过性
3. `10-架构与运行/11-状态机.md` — goal/phase/task 状态机、正交 CheckRecord 与固定技术暂停出口
4. `10-架构与运行/12-工具命令与数据模型.md` — 八个两词工具、/dgoal 命令、数据模型、持久化
5. `10-架构与运行/13-启动闸门与TUI浮层.md` — /dgoal 启动流程、确认 UI、持续浮层与两层状态 Modal
6. `10-架构与运行/14-TUI边界与状态机容错.md` — TUI 渲染异常不能阻断状态机和 goal 闭环
7. `30-路线图/30-项目路线图.md` — 实现切片排期、待拷问项（已全部完成）、暂不做/不做边界
8. `40-版本实施方案/` — 版本级实施方案与验收记录；当前三档 Plan 破坏性升级见 ADR 0038，历史版本见 `CHANGELOG.md`
9. `../index.ts` — 扩展入口；运行时与职责模块位于 `../src/`
10. `决策档案/README.md` — 决策档案索引；再按需深入对应 ADR

需要了解设计依据和外部参考时：

11. `20-能力参考/` — 外部事实参考，不决定排期
12. `20-能力参考/20-范式对比-plan-mode-loop-goal.md` — 三范式对比，dgoal 为什么是 goal 范式
13. `20-能力参考/21-rpiv-todo借鉴.md` — TUI 浮层/reducer/持久化借鉴
14. `20-能力参考/22-ADaPT与建检模式.md` — 按需分解 + 独立验证的理论依据
15. `20-能力参考/23-老金Goal×Loop搭配指南参考.md` — “愿望 vs 可验收 goal”用户教育参考（verification 必填的外部启发）
16. `20-能力参考/24-pi官方todo例子与pi-tui-design借鉴参考.md` — Pi `ctx.ui.custom()` modal 选型调研
17. `20-能力参考/25-dgoal-s-modal变体探索参考.md` — `/dgoal s` 三个变体的具体形态对比、Pi TUI 约束、v1→v2→v3 迭代 bug 复盘
18. `20-能力参考/26-Datawhale-LoopEngineering三文件循环参考.md` — Datawhale 推文三文件循环、图片机制核对与 dgoal 借鉴判断
19. `20-能力参考/27-独立规划agent与独立审核agent参考.md` — 独立审核加深 vs 独立规划暂候选的判断
20. `20-能力参考/28-循环工程与三层loop参考.md` — Cobus/Addy/吴恩达三层 loop 借鉴：就绪度自检 + 可核对文本候选，理清 goal/loop 概念版图
21. `20-能力参考/29-ClaudeDevs循环类型参考.md` — ClaudeDevs 四类 loop 与 Claude Code 官方机制核实：定位 dgoal 是 goal-based 建检循环，不借 scheduler/proactive 平台
22. `20-能力参考/30-CriticalThinking-Wayfinder与SpecSelfReview参考.md` — 从路由、探索、减法与建检四维判断，并记录已落地的 Task Plan frontier guidance 与 Plan/task 软性自检提示

历史材料：

- `90-归档/Task-Plan设计底稿-拷问过程.md` — 507-grill 拷问全过程（1-25 轮），稳定决策已迁入 adr，仅追溯时阅读

## 目录职责

| 目录 / 文件 | 职责 | 是否权威 |
|---|---|---|
| `术语表.md` | 项目语言、核心概念定义（含建检循环）、禁用同义词 | 是，命名权威 |
| `决策档案/` | 架构决策记录；入口为 `决策档案/README.md`，只收"难逆转、无上下文会困惑、有真实权衡"的决策 | 是，决策权威 |
| `经验笔记.md` | 可改的做法与避坑经验（活页）；解决换 agent 会重走的坑时记 | 否，活页参考 |
| `10-架构与运行/` | 当前架构：建检循环、状态机、工具命令、启动闸门、TUI 边界容错 | 是，当前实现权威 |
| `20-能力参考/` | 范式对比、rpiv-todo 借鉴、ADaPT/建检模式调研 | 是，作为事实参考；不直接决定排期 |
| `30-路线图/` | 实现切片排期、待拷问项、暂不做/不做边界 | 是，路线图权威 |
| `40-版本实施方案/` | 版本级实施方案和验收记录 | 受路线图约束 |
| `90-归档/` | 已归档的拷问过程、早期设计稿 | 否，仅查历史 |

## 文档原则

1. **建检循环是基本盘**：dgoal = 定义 goal + 完成后 check，不过继续干，过则结束。一切设计服从这个第一性原理。
2. **心智模型不建模**：建检循环是心智模型，不是显式数据结构（ADR 0006）。
3. **三层内容 + 按 Plan 投影**：goal/phase/task 共享持久结构并使用必填 Description；Task Plan 隐藏内部 phase 并直接展示 task，Phase/Goal Plan 展示 phase 主干；Description 进入执行上下文和两层状态 Modal，但不进入持续浮层或独立审核完成门（ADR 0042）。
4. **check / update 不可混用**：`phase_check` / `goal_check` 只记录独立审核；只有 `plan_update` 能写完成，并必须验证当前 revision 的批准记录（ADR 0038）。
5. **惰性创建**：目录和文件按需建立，不预建空结构。
6. **外部参考只借轻动作**：借 UI/reducer/状态边界/理论依据，不照搬完整平台。
7. **轻提案、硬执行**：Phase/Goal proposal 由代码校验结构、状态、Plan 类型与授权，LLM 负责语义与人工依赖分流，真实动作受执行边界约束，审核器只核冻结结果；Task Plan 不走 proposal（ADR 0037/0038）。
