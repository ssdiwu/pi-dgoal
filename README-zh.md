# pi-dgoal

[English README](./README.md)

让 agent 围绕一个目标持续工作，直到独立审核员确认完成——通过 Task Plan 和建检循环。

> **v0.7.2**：修复 npm 包安装声明，将 Pi 运行时导入改为宿主提供的 peer dependency，安装 `pi-dgoal` 时不再尝试替换 Pi 共享核心依赖树。
>
> **v0.7.1**：用户在自然语言中明确说“使用/启动 dgoal”后，冷会话可直接向普通 pending 启动闸门提交；结构与语义成功后才写状态，不再重复要求 `/dgoal` 或留下半启动 goal。proposal 语义改为 ADR 0037 的“轻提案、硬执行”，隐式 proposal 可自动降级到同一显式确认框。详见 ADR 0036/0037。
>
> 全局授权的隐式目标可运行本地测试、构建、脚本、项目文件修改与本地 Git 变更；`tool_call` 执行前策略门会阻止已识别的工作仓库 / `.git` 破坏、Git 远端写入、发布部署、外部写入、权限与付费命令。它是 best-effort 策略检查而非 OS sandbox，获准脚本内部仍可能隐藏副作用。详见 ADR 0035。
>
> **v0.7.0**：新增可选 `final_only` / `phased` 验收策略、有界/无上限运行预算、proposal 主导背景固化，以及带 fail-closed 本地/只读动作护栏的全局授权隐式轻量启动。详见 `CHANGELOG.md`。
>
> **v0.6.3**：启动闸门语义预审从 30s 总时长超时改为 60s idle timeout（收到任意流事件即重置），通过 `onUpdate` 流出活性状态，并把 `technical_error`（`isError:true`，不是计划内容问题）与语义 `rejected`（`isError:false`）分离。可通过 `pi-dgoal.json` 的 `proposalSemanticReviewIdleTimeoutSeconds` 配置。详见 `CHANGELOG.md`。
>
> **此前版本**：v0.6.2 修复审核结论仲裁、候选故障切换与 `/dgoal s` 浮层恢复；v0.6.0 引入 vNext Goal Runtime（新持久化键、单 phase 统一完成建检、终审三路归因、src 分层）。

## 安装

```bash
pi install npm:pi-dgoal
```

然后在 Pi 中 `/reload`。

本地开发：

```json
// ~/.pi/agent/settings.json
"../../Documents/codes/Githubs/pi-dgoal"
```

## 用法

启动带 Task Plan 的目标：

```text
/dgoal 修复当前项目里的 failing tests，并运行测试验证
```

如果前文里已经把目标对齐清楚，也可以直接用裸 `/dgoal` 承接前文共识进入启动闸门；如果当前没有可承接的前文，dgoal 不会硬启动，而是提示改用 `/dgoal <objective>`。看状态统一用显式 `/dgoal s`，不再复用裸 `/dgoal`。

也可以在空闲冷会话直接用祈使句说“用 dgoal 和 dteam 自己处理掉”。这条指令会形成一次性显式授权，允许 `dgoal_propose` 建立普通 pending goal，不再要求补输 `/dgoal`。能力问句、引用/代码示例、解释讨论、否定句、`mydgoal` 等标识符后缀、处理中追加输入与 `interactive` / `rpc` 之外的来源（含 `source=extension`）不会授权；已有 goal 也不会被静默替换。授权精确绑定 dgoal 实际观察到的 input/prompt；Pi 没有不可变输入原文，早于 dgoal 的受信任 input transform 属于扩展全权限信任边界。

启动闸门遵循 ADR 0037 的“轻提案、硬执行”：确定性代码只校验非空结构、状态、策略/预算组合和授权，不再靠 evidence 魔法词或自由文本关键词猜语义；当前会话模型是 proposal 唯一语义判断层，负责保留独立验收条件、把主观/体验项迁移到 `userReviewItems`、拒绝仍缺用户专属输入的真实 blocker，并在“显示计划即可补足授权”时返回 `requiresExplicitConfirmation`。新隐式或自然语言启动只有在结构校验和语义预审成功后才写入 goal/pendingProposal，失败不留下半启动状态，也不提前消费自然语言授权。预审保持可配置的 60s idle timeout，并区分 `approved` / `rewritten` / `rejected` 与基础设施 `technical_error`。显式启动正常弹确认框；全局授权的隐式 proposal 只有适合自动执行时才自动开始，否则自动降级为普通 pending goal 并弹同一确认框，不要求用户补输 `/dgoal`。已识别的高风险动作继续由 `tool_call` 执行前 fail-closed，终审仍独立。

dgoal 执行中：

- agent 用 `dgoal_plan` 推进任务状态（`pending → in_progress → done | blocked`）；`final_only` 另用 `complete_progress` 记录阶段进度划线
- `phased` 下每个 phase 完成都通过 `dgoal_check` 独立审核；`final_only` 下 phase 只记录进度完成，goal 最后进行一次独立终审，且 `dgoal_done` 必须携带 `verificationBundle`
- 有界预算首次达到上限进入一次非阻塞宽限，宽限耗尽才以 `pauseReason=budget_exhausted` 暂停；`unbounded` 不因预算或拒绝次数暂停，但保留安全暂停出口
- editor 上方的持续显示浮层展示 phase 进度；task 默认隐藏，持续显示展开态跟随 Pi 的 `app.tools.expand`（默认 `Ctrl+O`），但只展开 pending / in_progress phase；done phase 仍持久显示标题行，不再展开其 task。激活和会话重同步按真实 `setWidget` 能力初始化，不再依赖宿主可缺失的 `hasUI` / `mode` 标记，因此 `/reload` 可恢复丢失浮层。底部同一行提示快捷键与常用命令说明
- 安装 `pi-di18n` 时，浮层、状态栏、通知和启动闸门等用户可见文案可跟随 locale；模型侧 prompt 和工具 schema 保持不变

控制目标：

```text
/dgoal status | s   # 详细查询 Modal，查看完整 plan 细节；没有 goal 时显示空状态，paused goal 仍可只读查看
/dgoal pause  | p   # 停止自动续跑（保留 goal）
/dgoal resume | r   # 恢复暂停的 goal
/dgoal clear  | c   # 清除当前 session 的 goal
```

声明完成（触发终审）：

agent 调 `dgoal_done(summary, verification, whatChanged?, userReview?, verificationBundle?)`；`final_only` 必须提供结构化验证包。完成回复会产出结构化的可核对文本（改了什么 / 怎么验证 / 仍需你核对），而不是笼统宣布“已完成”。`done` 只表示冻结的 LLM 独立验收条件通过；TUI、视觉和体验事项作为明确的非阻塞 `userReview` 输出，完成文本会说明它们不代表人工体验已经验证。终审通过则 goal 关闭，dgoal 执行停止。

## 工具

| 工具 | 用途 |
|---|---|
| `dgoal_propose` | 启动闸门：提交 goal + phases + 初始 tasks + 冻结 goal `acceptanceCriteria`（仅 `phased` 要求 phase 条件）+ 验收/预算策略推荐 + 可选背景/用户复核项；LLM 语义预审分流人工依赖，显式启动需用户确认，全局授权隐式启动可自动确认或降级到同一确认框 |
| `dgoal_plan` | task 的 CRUD（create / update / list / get），四态状态机，`blockedBy` 依赖追踪 + 环检测 |
| `dgoal_check` | `phased` 的 phase 完成门（spawn 独立验收子进程，fresh 上下文 + 受限核验工具）；`final_only` 明确不调用该工具 |
| `dgoal_done` | 按策略完成所有 phase 后声明 goal 完成：`phased` 使用 `dgoal_check`，`final_only` 使用 `complete_progress`；随后进行 goal 级终审，且 `final_only` 必须携带 `verificationBundle`，是关闭 goal 的唯一方式 |
| `dgoal_pause` | agent 遇到需要用户决策才能继续的死锁（如冻结验收条件与目标冲突、缺只有用户掌握的信息或授权）时主动暂停；立即以 `pauseReason: agent_blocked` 暂停并记录 agent 给出的原因，不等 `no_progress` 连续 3 轮兜底。`no_progress` 仍作为兜底保留。 |

## 设计边界

- 会话内单 goal，不做多目标池
- Task Plan 必选：通过命令或自然语言显式启动 dgoal 即进入复合目标，不允许空 plan 完成
- Goal 方向与 goal/phase 的 `acceptanceCriteria` 在确认后冻结；dgoal 执行中只可调整 phase/task 的执行进度、task 分解和 evidence，不提供验收条件更新入口
- proposal 语义归模型、不归关键词：确定性代码校验结构与授权，真实动作由 `tool_call` 守边界，审核器只核冻结结果
- done task 不回退：做错了新建接续 task（`blockedBy` 指向原 task）
- 独立审核：审核员是独立 `pi` 子进程，fresh 上下文、无主会话历史、禁 skills/extensions，只带受限核验工具（`read`、`grep`、`find`、`ls`、`bash`），完成不自证
- 不自动 Git 操作，不替代项目测试，不做固定 workflow engine

## Goal 生命周期

```text
pending ──→ active ──→ done                # 正常路径
              │  ↑
              ↓  │ rejected                # 终审不过，dgoal 继续（每轮 prompt 钉审核问题）
              │  │  有界修复预算耗尽
              ↓  ↓
            paused (budget_exhausted / audit_failed_3x) ──/dgoal resume──→ active
            paused (user_abort / model_error / audit_error / budget_exhausted / audit_failed_3x / no_progress / agent_blocked) ──/dgoal resume──→ active
```

状态定义见 `doc/术语表.md`，rejected/paused 契约见 `doc/决策档案/0004`，当前实现见 `doc/10-架构与运行/`。

## 完成审核

`dgoal_done` 复用与 phase 建检相同的独立审核运行时，但作用在 goal 级终审：独立 `pi` 子进程，fresh 上下文，受限核验工具（`read`、`grep`、`find`、`ls`、`bash`）。

```text
--no-session --no-extensions --no-skills --mode json --tools read,grep,find,ls,bash
```

首次审核时，若全局和受信任项目级的 `pi-dgoal.json` 文件都不存在，dgoal 会自动创建全局模板：

```json
// ~/.pi/agent/pi-dgoal.json
{
  "$comment": "将各候选列表按回退顺序填为 provider/model[:thinking]；保持 null 则继承当前会话模型。",
  "phaseAuditorModels": null,
  "goalAuditorModels": null,
  "implicitFinalOnlyStart": false,
  "implicitFinalOnlyBudget": { "maxTurns": 24, "maxWallClockMinutes": 60, "maxRepairAttempts": 1, "grace": { "maxTurns": 24, "maxWallClockMinutes": 0 } }
}
```

阶段建检与目标终审可分别配置最多 3 个有序候选；具体项是持久化的专用设置，不随之后主会话换模或 Pi 重载漂移。末尾 Pi 标准思考后缀（`off`/`minimal`/`low`/`medium`/`high`/`xhigh`/`max`）用于选等级，模型 ID 本身可含 `/` 或 `:` 以支持 custom/gateway 模型：

```json
// ~/.pi/agent/pi-dgoal.json 或 .pi/pi-dgoal.json
{
  "phaseAuditorModels": [
    "openai-codex/gpt-5.6-sol:medium",
    "minimax-cn/MiniMax-M3:high"
  ],
  "goalAuditorModels": [
    "openai-codex/gpt-5.6-sol:xhigh",
    "minimax-cn/MiniMax-M3:high"
  ]
}
```

旧单值 `phaseAuditorModel`、`goalAuditorModel` 与共享 `auditorModel` 字段继续兼容，dgoal 不会自动改写用户已有文件。`contextSummarizerModels` 已废弃：v0.7.0 起移除了启动前独立背景摘要子进程（ADR 0033），主代理可在 `dgoal_propose` 中按需持久化可选 `contextSummary`，背景缺失不再阻断启动。`implicitFinalOnlyStart`（仅全局，默认 `false`）授权 agent 无需显式 `/dgoal` 即可启动有界 `final_only` 目标；`implicitFinalOnlyBudget` 可覆盖安全默认预算（基础 `24 turns / 60 min / 1 repair`，turn 宽限再给 24）。授权后的隐式目标可执行本地测试、构建、脚本、项目文件修改与本地 Git 变更。执行前策略门会阻止已识别的工作仓库 / `.git` 破坏和远端写入，但它不是 OS sandbox，无法证明获准脚本内部没有隐藏副作用（ADR 0035）。

解析优先级：

1. 项目 `.pi/pi-dgoal.json`（仅项目已 trusted 时生效，候选链整体使用）
2. 全局 `~/.pi/agent/pi-dgoal.json`
3. 仅在配置没有可用候选时回退当前会话模型

每个配置来源内，当前范围的复数字段优先于对应单值字段，单值字段再优先于旧 `auditorModel`；解析时先比较来源优先级，不混合两个来源的候选链。复数字段为 `null` 时，显式继承当前会话模型并阻断继续降级。空数组非法；非法或重复项会按下标告警并跳过，只保留前 3 个合法且首次出现的候选。

每次审核开始前，dgoal 会查询与审核 child 同隔离边界的 Pi `get_available_models` 结构化注册表：先完整匹配模型 ID，再识别末尾标准 thinking 后缀；查不到的候选会跳过。成功查询结果缓存到当前 Pi 进程，`/reload` 后重建；预检查询失败时保留候选链，交由运行时继续判断，不误删配置。文件不可读或模型值非法时继续按配置优先级降级。全局和受信任项目级配置都缺失时，dgoal 会在首次审核原子创建全局模板，且绝不覆盖已有文件。没有可用配置候选且无其他配置问题时，每个 Pi 进程首次审核会提示一次选模入口；存在配置问题时只发出对应告警。提示文案在安装 `pi-di18n` 时跟随 locale。

- 通过：goal 关闭，dgoal 执行停止，模型收到完成信号用于最终用户回复；工具结果会显示形成结论的实际审核模型，候选回退时随进度更新
- 审核用量会脱敏追加到 `~/.pi/agent/audit-usage.jsonl`；只写时间、父 session、项目、范围、模型、尝试序号、数字 usage 与去重键，`pi-session-insights` 会将它合入 `/insights` 数字聚合
- 拒绝：阶段建检不通过是正常业务结果（`isError: false`），goal 保持 active，但闸门锁在当前 phase；终审不通过则进 `rejected`，原始审核报告会继续注入后续 prompt；`bounded` 按结构化修复预算和一次宽限暂停，旧 goal 无预算时才兼容三次拒绝暂停，`/dgoal resume` 按 pause reason 恢复
- 审核出错 / 中断 / 真实空闲超时 / 无结论：统一视为 `auditor_error`（`isError: true`）。每个候选在一次审核中最多调用一次；技术/协议错误（HTTP 400/401/403/404/408/429/5xx、网络、超时、零输出或缺终止标记的部分输出）按顺序切下一候选。当前 goal、同一审核范围（phase 或 goal）内产生有效结论的候选会持久化并复用。业务 `<REJECTED>` 与用户中断不切换；phase 拒绝可持续修复、不计次数；`bounded` 按结构化修复预算和一次宽限处理，`unbounded` 不因拒绝次数或预算暂停，但仍保留模型错误、审核错误、无进展和 `agent_blocked` 安全出口。旧 goal 无结构化预算时才兼容三次拒绝暂停。`/dgoal resume` 从 `audit_error` 恢复时只清除产生错误的 phase/goal 审核范围候选状态（旧 goal 缺失范围字段时全量清除），再重试候选链。全部候选耗尽才安全暂停，绝不静默回退执行模型。
- 审核过程会通过工具增量更新回传，含 `thinking` / `tool_running` 等活性信息：模型工作显示 `idle Ns/180s`，审核工具执行时显示 `idle Ns/1800s`，避免长项目验证命令被误判成模型卡死。工具执行会持久化为脱敏、scope 隔离的审核检查点；候选切换或 `/dgoal resume` 仅在 workspace fingerprint 相同的前提下复用成功结束的精确命令，running/failed 不构成证据。phase/goal 审核跨候选共享 900 秒 / 1800 秒总预算。
- 审核报告更接近验收单：GWT 风格的 PASS / FAIL / BLOCKER 条目，加代码与文档一致性检查
- 终审拒绝时展示“终审修复（Goal Repair）· 第 N 次”；有界预算耗尽显示 `paused(budget_exhausted)`，旧 goal 的兼容兜底才显示 `paused(audit_failed_3x)`。每轮原始报告、完成声明与时间进入追加式修复账本，不创建 goal 级 task 或额外 phase
- `/dgoal help` / `/dgoal h` 只在冷启动或 paused 时让当前会话 AI 用用户语言解释 dgoal；它不是 `dgoal_help` 工具，也不授予 AI 执行权
- vNext 使用新的 `dgoal-goal-vnext` custom entry；旧 `dgoal-state` 会被忽略，升级后需重新 `/dgoal`，不迁移旧 goal
- 逃生通道：`PI_DGOAL_NO_AUDIT=1` 跳过审核（仅调试）

## 测试

```bash
npm test         # bun: 全套
npm run test:rpc # python: RPC 加载 + 命令注册
npm run test:smoke # python: AI 驱动 smoke（真实模型 × 隔离环境）——消耗真实 token
```

测试文件覆盖数据模型 + 持久化、plan reducer（状态机 + 环检测）、浮层渲染、启动闸门、状态机 + prompt、端到端集成、工具 execute 真实路径集成、上下文固化，以及 detached process group（独立进程组）收尸监督。

**AI 驱动 smoke**（`npm run test:smoke`，`test/test-ai-smoke.py`）：在隔离环境（`pi -ne -e ./index.ts -ns -np --mode rpc`）驱动真实 dgoal（默认单 phase，对齐 ADR 0017），自动回复启动闸门 select，追踪 `dgoal_propose → dgoal_plan → dgoal_check → dgoal_done` 全工具链。真实模型 + 真实 token，故不进 CI。

**TUI 交互行为**（启动闸门确认 UI、真实 `dgoal_check` 子进程审计内容、终审 rejected 回环、aboveEditor 浮层渲染）仍需在 Pi TUI 用真实模型做人工 smoke test。

## 项目结构

```text
pi-dgoal/
├── AGENTS.md
├── README.md
├── README-zh.md
├── doc/                          ← 设计 + 路线图 + 历史（中文）
│   ├── README.md
│   ├── 术语表.md
│   ├── 10-架构与运行/             ← 当前实现
│   ├── 20-能力参考/               ← 调研参考
│   ├── 30-路线图/                 ← 路线图
│   ├── 40-版本实施方案/           ← 版本实施方案
│   ├── 90-归档/                   ← 历史归档
│   ├── 经验笔记.md                ← 可改的做法与避坑经验
│   └── 决策档案/                  ← 决策档案索引：见 `doc/决策档案/README.md`
├── package.json
├── index.ts                       ← Pi 扩展组装根
├── src/                           ← 按职责分层的运行时代码
│   ├── plan/                      ← Task Plan 类型与纯 reducer helper
│   ├── runtime/                   ← Goal Runtime、工具、prompt 与持久化编排
│   ├── startup/                   ← Pi 工具/命令注册与事件 wiring
│   ├── goal-runtime/              ← 可变 session 状态单例
│   ├── audit/                     ← 审核解析与脱敏用量账本
│   ├── isolated-pi/               ← 隔离 Pi 参数与行流 helper
│   └── tui/                       ← TUI 纯 helper 与组件边界
└── test/                          ← 测试地图与命令：见 test/README.md
    ├── README.md
    ├── *.test.ts                   ← Bun 单元 / 集成测试
    ├── test-extension-rpc.py       ← 扩展加载与命令注册
    ├── test-ai-smoke-runtime.py    ← 宿主 Pi 选择的确定性测试
    └── test-ai-smoke.py            ← 真实模型端到端 smoke
```

## 文档

入口 `doc/README.md`。建检循环 + 三层内容模型是基本盘，决策见 `doc/决策档案/0006`。

## 协议

MIT
