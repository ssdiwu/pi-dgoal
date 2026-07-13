# pi-dgoal

[English README](./README.md)

让 agent 围绕一个目标持续工作，直到独立审核员确认完成——通过 Task Plan 和建检循环。

> **v0.5.8**：启动闸门现在会在写入 `pendingProposal` 前调用当前会话模型做计划语义预审，冻结可独立验收的完成条件，并把人工体验项作为非阻塞的用户复核项交付。启动、恢复、完成和异步 PlanOverlay UI 抛错均 fail-soft，状态持久化与 agent prompt 不依赖 UI 成功。详见 `CHANGELOG.md`。
>
> **此前版本**：v0.5.3 增加独立审核器选模与重审反馈注入；v0.5.2 增加建检反馈持久化、事件流化审核器活性、审核器透明重试、闸门锁定推进拦截和裸 `/dgoal` 承接启动。

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

启动闸门先做结构校验，再用当前会话模型做计划级语义预审，之后才写入 `pendingProposal`；人工或主观完成条件会被拒绝或改写到 `userReviewItems`。预审通过后，对话框默认展示阶段级摘要（goal + verification + acceptanceCriteria + userReviewItems + readiness + 边界信号/缺口提示 + phases + task 数量），需要时可点入口查看 task 明细；确认 / 拒绝 / 反馈后再开始执行 dgoal。

dgoal 执行中：

- agent 用 `dgoal_plan` 推进任务状态（`pending → in_progress → done | blocked`）
- 每个 phase 完成都通过 `dgoal_check`（独立子进程，带受限核验工具，含 `bash`）独立审核
- editor 上方的持续显示浮层展示 phase 进度；task 默认隐藏，持续显示展开态跟随 Pi 的 `app.tools.expand`（默认 `Ctrl+O`），但只展开 pending / in_progress phase；done phase 仍持久显示标题行，不再展开其 task。底部同一行提示快捷键与常用命令说明
- 安装 `pi-di18n` 时，浮层、状态栏、通知和启动闸门等用户可见文案可跟随 locale；模型侧 prompt 和工具 schema 保持不变

控制目标：

```text
/dgoal status | s   # 详细查询 Modal，查看完整 plan 细节；没有 goal 时显示空状态，paused goal 仍可只读查看
/dgoal pause  | p   # 停止自动续跑（保留 goal）
/dgoal resume | r   # 恢复暂停的 goal
/dgoal clear  | c   # 清除当前 session 的 goal
```

声明完成（触发终审）：

agent 调 `dgoal_done(summary, verification, whatChanged?, userReview?)`。完成回复会产出结构化的可核对文本（改了什么 / 怎么验证 / 仍需你核对），而不是笼统宣布“已完成”。`done` 只表示冻结的 LLM 独立验收条件通过；TUI、视觉和体验事项作为明确的非阻塞 `userReview` 输出，完成文本会说明它们不代表人工体验已经验证。终审通过则 goal 关闭，dgoal 执行停止。

## 工具

| 工具 | 用途 |
|---|---|
| `dgoal_propose` | 启动闸门：提交 goal + phases + 初始 tasks + 冻结 `acceptanceCriteria`（goal 和每个 phase 的 criterion + evidence）+ 可选 `userReviewItems`，用户确认后才开始执行 dgoal |
| `dgoal_plan` | task 的 CRUD（create / update / list / get），四态状态机，`blockedBy` 依赖追踪 + 环检测 |
| `dgoal_check` | phase 完成门（spawn 独立验收子进程，fresh 上下文 + 受限核验工具）；单 phase 时一次审核同时核验 phase 与 goal，记录统一审核凭据（ADR 0018） |
| `dgoal_done` | 在所有 phase 都通过 `dgoal_check` 后声明 goal 完成；单 phase 复用统一审核凭据直接关闭（不重复终审），多 phase 触发 goal 级终审（含 phase(id)/goal/user_review 三路归因），是关闭 goal 的唯一方式 |

## 设计边界

- 会话内单 goal，不做多目标池
- Task Plan 必选：`/dgoal` 即复合目标，不允许空 plan 完成
- Goal 方向与 goal/phase 的 `acceptanceCriteria` 在确认后冻结；dgoal 执行中只可调整 phase/task 的执行进度、task 分解和 evidence，不提供验收条件更新入口
- done task 不回退：做错了新建接续 task（`blockedBy` 指向原 task）
- 独立审核：审核员是独立 `pi` 子进程，fresh 上下文、无主会话历史、禁 skills/extensions，只带受限核验工具（`read`、`grep`、`find`、`ls`、`bash`），完成不自证
- 不自动 Git 操作，不替代项目测试，不做固定 workflow engine

## Goal 生命周期

```text
pending ──→ active ──→ done                # 正常路径
              │  ↑
              ↓  │ rejected                # 终审不过，dgoal 继续（每轮 prompt 钉审核问题）
              │  │  ×3 终审不过
              ↓  ↓
            paused (audit_failed_3x) ──/dgoal resume──→ active
            paused (user_abort / model_error / audit_error / no_progress) ──/dgoal resume──→ active
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
  "contextSummarizerModels": null
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

旧单值 `phaseAuditorModel`、`goalAuditorModel` 与共享 `auditorModel` 字段继续兼容，dgoal 不会自动改写用户已有文件。`contextSummarizerModels` 也可配置背景总结候选链；候选各尝试一次，耗尽后再用当前会话模型一次，全部失败时启动 fail-closed，不带隐含背景进入 active。

解析优先级：

1. 项目 `.pi/pi-dgoal.json`（仅项目已 trusted 时生效，候选链整体使用）
2. 全局 `~/.pi/agent/pi-dgoal.json`
3. 仅在配置没有可用候选时回退当前会话模型

每个配置来源内，当前范围的复数字段优先于对应单值字段，单值字段再优先于旧 `auditorModel`；解析时先比较来源优先级，不混合两个来源的候选链。复数字段为 `null` 时，显式继承当前会话模型并阻断继续降级。空数组非法；非法或重复项会按下标告警并跳过，只保留前 3 个合法且首次出现的候选。

每次审核开始前，dgoal 会查询与审核 child 同隔离边界的 Pi `get_available_models` 结构化注册表：先完整匹配模型 ID，再识别末尾标准 thinking 后缀；查不到的候选会跳过。成功查询结果缓存到当前 Pi 进程，`/reload` 后重建；预检查询失败时保留候选链，交由运行时继续判断，不误删配置。文件不可读或模型值非法时继续按配置优先级降级。全局和受信任项目级配置都缺失时，dgoal 会在首次审核原子创建全局模板，且绝不覆盖已有文件。没有可用配置候选且无其他配置问题时，每个 Pi 进程首次审核会提示一次选模入口；存在配置问题时只发出对应告警。提示文案在安装 `pi-di18n` 时跟随 locale。

- 通过：goal 关闭，dgoal 执行停止，模型收到完成信号用于最终用户回复；工具结果会显示形成结论的实际审核模型，候选回退时随进度更新
- 审核用量会脱敏追加到 `~/.pi/agent/audit-usage.jsonl`；只写时间、父 session、项目、范围、模型、尝试序号、数字 usage 与去重键，`pi-session-insights` 会将它合入 `/insights` 数字聚合
- 拒绝：阶段建检不通过是正常业务结果（`isError: false`），goal 保持 active，但闸门锁在当前 phase；终审不通过则进 `rejected`，原始审核报告会继续注入后续 prompt；连续 3 次终审不通过 → 暂停，`/dgoal resume` 清零重试
- 审核出错 / 中断 / 真实空闲超时 / 无结论：统一视为 `auditor_error`（`isError: true`）。每个已配置候选在同模型上最多重试 3 次；结构化技术错误（HTTP 401/403/404/408/429/5xx、网络、零输出超时）及明确的纯文本配额耗尽（usage/plan/rate limit reached/exceeded/hit/exhausted、quota exceeded、insufficient quota）切下一候选，HTTP 400、明确 `<REJECTED>` 与用户中断不切换。缺终止标记的部分输出作为受限的 `<partial_audit_feedback>` 在同模型重试与跨候选间携带。全部候选耗尽才安全暂停，`/dgoal resume` 继续；绝不静默回退执行模型。
- 审核过程会通过工具增量更新回传，含 `thinking` / `tool_running` / `idle Ns/180s` 等活性信息；即使中途停下，也会尽量返回部分审核输出
- 审核报告更接近验收单：GWT 风格的 PASS / FAIL / BLOCKER 条目，加代码与文档一致性检查
- 终审拒绝时展示“终审修复（Goal Repair）· 第 N/3 次”，`paused(audit_failed_3x)` 展示“终审修复已暂停”；每轮原始报告、完成声明与时间进入追加式修复账本，不创建 goal 级 task 或额外 phase
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
│   ├── runtime/                   ← Goal Runtime 与过渡编排层
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
