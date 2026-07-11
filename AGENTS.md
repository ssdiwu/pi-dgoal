# AGENTS.md — pi-dgoal

> pi-dgoal 是一个 Pi 扩展，让 agent 围绕一个明确目标持续工作，直到显式完成并给出验证证据。

## 先读

1. `README.md`（功能、安装、使用、完成审核机制、设计边界——必读）
2. `doc/术语表.md`（含建检循环第一性原理 + 全部术语定义）
3. `doc/10-架构与运行/`（建检循环与三层结构、状态机、工具命令、启动闸门——当前实现权威）
4. `doc/决策档案/`（架构决策记录 0001-0015；0006 是建检循环基本盘，0008 是 `/dgoal s` modal 选型，0011/0012 是 v0.5.2 基本盘，0013-0015 是审核器配置落点、双范围专用模型与错误回退候选链）
5. `doc/30-路线图/30-项目路线图.md`（实现切片排期）
6. `index.ts`（扩展入口，单文件实现）

## 项目结构

```text
pi-dgoal/
├── index.ts                          ← Pi 扩展入口（单文件实现）
├── doc/
│   ├── README.md                     ← 文档导航
│   ├── 术语表.md                     ← 术语权威（含建检循环）
│   ├── 10-架构与运行/                ← 建检循环/状态机/工具/启动闸门
│   ├── 20-能力参考/                  ← 范式对比/rpiv-todo/ADaPT建检调研
│   ├── 30-路线图/                    ← 实现切片排期
│   ├── 40-版本实施方案/              ← 版本级方案（惰性）
│   ├── 90-归档/                      ← 拷问过程等历史
│   └── 决策档案/                     ← 架构决策记录（0001-0015）
├── test/                            ← 测试目录；完整地图与命令见 test/README.md
│   ├── *.test.ts                     ← Bun 单元 / 集成测试
│   ├── test-extension-rpc.py         ← RPC 加载与命令注册测试
│   ├── test-ai-smoke-runtime.py      ← 宿主 Pi 选择的确定性测试
│   └── test-ai-smoke.py              ← 真实模型端到端 smoke
└── package.json
```

## 代码边界

- **会话内单目标**：只支持当前会话内单目标，不做多目标池。
- **Task Plan 必选**：`/dgoal` 即复合目标，必须有 plan（phase + task 两层内容）；无空 plan 放行。详见 ADR 0002/0006。
- **三层内容 + 建检循环**：goal（冻结）/phase（task 聚合）/task（按需分解）三层；dgoal 是建检循环——定义 goal + 完成后 check，不过继续干，过则结束。phase completed 唯一入口是 `dgoal_check`（独立子进程，建检不可绕过）。详见 ADR 0006、`doc/10-架构与运行/`。
- **工具规范化**：agent 与 dgoal 状态机的交互统一用 `dgoal_` 前缀工具：`dgoal_propose`（提交计划）、`dgoal_plan`（更新 task）、`dgoal_check`（phase completed 唯一入口，只负责阶段建检）、`dgoal_done`（在所有 phase 都通过后声明完成并触发 goal 级终审）。原 `loop_complete` 已改名 `dgoal_done`。
- **不碰 Git**：不自动执行 Git 提交、回滚或删除。
- **不替代测试**：不替代项目自身测试命令；agent 仍需按项目现状选择并运行验证。
- **背景固化是补充**：启动背景固化是补充信息，不替代把关键约束写进 objective 或文档；摘要可能漏点。
- **审核员默认复用主模型**：默认继承当前会话模型；可通过 `~/.pi/agent/pi-dgoal.json` 或项目 `.pi/pi-dgoal.json` 的 `phaseAuditorModels` / `goalAuditorModels`，以最多 3 个 `provider/model[:thinking]` 有序候选分别配置阶段建检与目标终审。项目候选链整体优先于全局链、不混合；同一来源内复数字段 > 对应单值字段 > 旧 `auditorModel`。复数字段 `null` 显式继承当次会话模型并阻断继续降级，旧单值字段保持兼容；项目级配置受 `ctx.isProjectTrusted()` 信任边界保护。候选先由与审核 child 同隔离边界的 Pi 结构化模型注册表预检，查询失败保留候选；运行时仅技术异常可按候选切换，业务 `REJECTED`、用户中断和 HTTP 400 不换模型，耗尽后必须 `audit_error` 暂停。
- 不硬编码密钥、token、私有路径。

## TUI 边界防护

- dgoal 的状态机、持久化和审计结果不能依赖 TUI 渲染成功；UI 只是展示层。
- `finalizeGoal`、`dgoal_done`、`dgoal_check`、overlay/status 更新等路径必须防御 Pi 主程序 TUI 抛错（典型症状：`Spacer is not defined`）。
- 终审通过后的 `persistGoal(null)`、失败报告注入、phase/task 状态推进必须先于或独立于 UI 展示；UI 抛错只能降级提示，不能阻断 goal 闭环。
- 改动完成、审核、overlay、status、notification 相关代码时，必须补“UI 抛错仍保持状态正确”的红绿回归测试。

## 验证

改动后按覆盖面从低到高三档执行：

```bash
npm run test:rpc      # RPC 加载 + /dgoal 命令注册（python）
npm run test:context  # 启动背景固化逻辑（bun test）
npm test              # 全量 bun test
```

**AI 驱动 smoke（真实模型 × 隔离环境）**：`npm run test:smoke`（即 `test/test-ai-smoke.py`）用宿主 Pi 的 `-ne -e ./index.ts -ns -np --mode rpc --no-session` 只加载本扩展（`-ne` 禁扩展发现、`-ns/-np` 禁 skill/prompt 发现），让主模型真实跑一个多 phase dgoal，覆盖 `dgoal_propose → dgoal_plan → dgoal_check → dgoal_done` 全工具链。driver 会跳过 npm 注入的项目 local `node_modules/.bin/pi`（避免其版本落后于用户模型注册表）；可用 `PI_DGOAL_SMOKE_PI` 显式覆盖，`npm run test:smoke:runtime` 验证选择逻辑。⚠️ 消耗真实 token，需网络与已配置 provider。关键约束：启动闸门与建检依赖 `ui.select` 确认，纯 `-p`/`--mode json` 下 UI 方法是 no-op 会跑不通，必须用 `--mode rpc` + driver 注入确认响应；隔离扩展发现用 `-ne -ns -np`，**不要**设空 `PI_CODING_AGENT_DIR`（会把 provider 凭据一起隔离，pi 拿不到 API key 卡在网络层），凭据靠继承真实配置保留。

**人工 TUI smoke（仍不可省）**：浮层/overlay/modal 渲染、启动闸门确认 UI 的真实交互、终审 rejected 回环等纯渲染与交互行为，仍需在 Pi TUI 用真实模型做人工 smoke test。

## 发版流程

发布 npm 版本前必须走同一条链路：

1. 同步版本号：`package.json` + `package-lock.json`（如存在 lock 版本字段）。
2. 更新 `CHANGELOG.md`：把 `Unreleased` 内容落到 `## [x.y.z] - YYYY-MM-DD`，并保留新的空 `Unreleased` 段。
3. 确认 `package.json` 版本、`CHANGELOG.md` 版本段、`git tag v<x.y.z>` 三者一致。
4. 运行验证：按改动面分层补——至少 `npm test`；涉及工具/状态机/建检循环补 AI 驱动 smoke（`pi --no-extensions -e ./index.ts` 隔离环境 + RPC driver）；涉及 overlay/modal/TUI 交互补人工 TUI smoke。
5. 提交单一主题 commit，再 `git tag v<x.y.z>`。
6. 发布：`npm publish`；发布后 `git push && git push --tags`。

## Git 规范

- 每次 commit 只做一件事。
- 提交标题默认中文，格式：`分类：动作 + 对象`。
- 禁止 `git push --force` 到 `main`。

## 文档现状说明

根 `README.md`（英文）/ `README-zh.md`（中文）是功能与边界权威入口。`doc/` 下已有独立子文档：

- `doc/术语表.md` — 术语精确定义
- `doc/90-归档/Task-Plan设计底稿-拷问过程.md` — 507-grill 拷问全过程（1-25 轮，历史追溯）
- `doc/决策档案/` — 架构决策记录（0001-0015）

详见 [`doc/README.md`](./doc/README.md) 的阅读地图。

## 文档沉淀出口

三个沉淀出口按边界分工，不混用：

- **`doc/术语表.md`** — 回答"这个词指什么"，收项目特有概念；定义"是什么"，不沾实现细节。惰性创建，术语敲定时当场写。
- **`doc/决策档案/`** — 回答"为什么这么定"，只收"难逆转 + 无上下文会困惑 + 有真实权衡"的决策（刻碑，记了就不删）。一条一文件，顺序编号 `0001-中文标题.md`（项目术语沿用术语表规范叫法）；维护 `README.md` 索引（编号 + 标题 + 一句话主旨），新增 / 更新 ADR 时同步。
- **`doc/经验笔记.md`** — 回答"这事儿怎么做"，收可改的做法与避坑经验（活页）。门槛：解决一个坑时，如果换一个无上下文的 agent 来会重走一遍，就值得记。格式：现象 + 做法 + 证据。重复发生时在原条目追加证据，不新建条目。

## 代码工程纪律

> 以下纪律适用于代码项目，由 `507-setup` 写入。源自全局 `~/.pi/agent/AGENTS.md` 的代码专属条款。

- **删除测试判断模块价值**：判断一个模块/抽象是否值得存在，想象删掉它——复杂度消失说明它只是透传（删）；复杂度在多个调用处重新出现，说明它在真正减负（留）。
- **接缝纪律**：只在真有变化的地方引入接口/抽象层。只有一个实现（adapter）的是"假设接缝"，两个以上不同实现才是真接缝；别为单一用法提前抽接口。
- **函数粒度**：函数控制在 100 行以内；超出则考虑拆分。
- **测试看行为**：测试优先通过公共接口验证行为，不测内部实现；mock 只放在系统边界。
- **先建反馈环再调 bug**：调 bug 先造一个快速、确定性、agent 能跑的 pass/fail（成败）信号（失败测试/curl/CLI 重放/headless 等）；没有反馈环就别盯着代码空猜，列已试方法后求助用户。信号是 90% 的调试，其余是机械操作。
- **插桩打 tag**：所有临时 debug 日志打唯一前缀 tag（如 `[DEBUG-a4f2]`），清理时一个 grep 全删；未打 tag 的临时日志会残留。
