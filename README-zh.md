# pi-dgoal

[English README](./README.md)

让 agent 围绕一个目标持续工作，直到独立审核员确认完成——通过 Task Plan 和建检循环。

> **v0.5.3**：独立审核器选模配置（`pi-dgoal.json`）+ 穷举式审核 prompt + 重审反馈注入。详见 `CHANGELOG.md`。（v0.5.2：建检反馈持久化 + 事件流化审核器活性 + 审核器透明重试 + 闸门锁定推进拦截 + 裸 `/dgoal` 承接启动，见 `doc/40-版本实施方案/41-v0.5.2-建检反馈闭环增强实施方案.md`。）

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

启动闸门对话框默认只展示阶段级摘要（goal + verification + phases + task 数量），需要时可点入口查看 task 明细；确认 / 拒绝 / 反馈后再开始执行 dgoal。

dgoal 执行中：

- agent 用 `dgoal_plan` 推进任务状态（`pending → in_progress → done | blocked`）
- 每个 phase 完成都通过 `dgoal_check`（独立子进程，带受限核验工具，含 `bash`）独立审核
- editor 上方的持续显示浮层展示 phase 进度；task 默认隐藏，持续显示展开态跟随 Pi 的 `app.tools.expand`（默认 `Ctrl+O`），但只展开 pending / in_progress phase；done phase 仍持久显示标题行，不再展开其 task。底部同一行提示快捷键与常用命令说明
- 安装 `pi-di18n` 时，浮层、状态栏、通知和启动闸门等用户可见文案可跟随 locale；模型侧 prompt 和工具 schema 保持不变

控制目标：

```text
/dgoal status | s   # 详细查询 Modal，查看完整 plan 细节；没有 active goal 时显示空 dgoal 状态
/dgoal pause  | p   # 停止自动续跑（保留 goal）
/dgoal resume | r   # 恢复暂停的 goal
/dgoal clear  | c   # 清除当前 session 的 goal
```

声明完成（触发终审）：

agent 调 `dgoal_done(summary, verification)`。终审通过则 goal 关闭，dgoal 执行停止。

## 工具

| 工具 | 用途 |
|---|---|
| `dgoal_propose` | 启动闸门：提交 goal + phases + 初始 tasks，用户确认后才开始执行 dgoal |
| `dgoal_plan` | task 的 CRUD（create / update / list / get），四态状态机，`blockedBy` 依赖追踪 + 环检测 |
| `dgoal_check` | phase 完成门（spawn 独立验收子进程，fresh 上下文 + 受限核验工具）；即使是最后一个 phase，也只负责该 phase 建检 |
| `dgoal_done` | 在所有 phase 都通过 `dgoal_check` 后声明 goal 完成，内部触发 goal 级终审，是关闭 goal 的唯一方式 |

## 设计边界

- 会话内单 goal，不做多目标池
- Task Plan 必选：`/dgoal` 即复合目标，不允许空 plan 完成
- Goal 层确认后冻结；phase/task 层在 dgoal 执行中可调
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
            paused (user_abort / model_error / audit_error) ──/dgoal resume──→ active
```

状态定义见 `doc/术语表.md`，rejected/paused 契约见 `doc/决策档案/0004`，当前实现见 `doc/10-架构与运行/`。

## 完成审核

`dgoal_done` 复用与 phase 建检相同的独立审核运行时，但作用在 goal 级终审：独立 `pi` 子进程，fresh 上下文，受限核验工具（`read`、`grep`、`find`、`ls`、`bash`）。

```text
--no-session --no-extensions --no-skills --mode json --tools read,grep,find,ls,bash
```

可通过 `pi-dgoal.json` 给审核子进程单独选模：

```json
// ~/.pi/agent/pi-dgoal.json 或 .pi/pi-dgoal.json
{
  "auditorModel": "openai/gpt-5"
}
```

解析优先级：

1. 项目 `.pi/pi-dgoal.json`（仅项目已 trusted 时生效）
2. 全局 `~/.pi/agent/pi-dgoal.json`
3. 回退到当前会话模型

如果文件缺失、不可读，或 `auditorModel` 非法，dgoal 会回退到当前会话模型，审核流程不中断。该文件不会被自动创建；首次审核时若没有任何 `pi-dgoal.json`，dgoal 会一次性提示全局路径，之后保持静默。提示文案在安装 `pi-di18n` 时跟随 locale。

- 通过：goal 关闭，dgoal 执行停止，模型收到完成信号用于最终用户回复
- 拒绝：阶段建检不通过是正常业务结果（`isError: false`），goal 保持 active，但闸门锁在当前 phase；终审不通过则进 `rejected`，原始审核报告会继续注入后续 prompt；连续 3 次终审不通过 → 暂停，`/dgoal resume` 清零重试
- 审核出错 / 中断 / 真实空闲超时 / 无结论：统一视为 `auditor_error`（`isError: true`），工具内部先透明重试最多 3 次；仍失败才安全暂停，`/dgoal resume` 继续
- 审核过程会通过工具增量更新回传，含 `thinking` / `tool_running` / `idle Ns/120s` 等活性信息；即使中途停下，也会尽量返回部分审核输出
- 审核报告更接近验收单：GWT 风格的 PASS / FAIL / BLOCKER 条目，加代码与文档一致性检查
- 逃生通道：`PI_DGOAL_NO_AUDIT=1` 跳过审核（仅调试）

## 测试

```bash
npm test         # bun: 全套
npm run test:rpc # python: RPC 加载 + 命令注册
npm run test:smoke # python: AI 驱动 smoke（真实模型 × 隔离环境）——消耗真实 token
```

测试文件覆盖数据模型 + 持久化、plan reducer（状态机 + 环检测）、浮层渲染、启动闸门、状态机 + prompt、端到端集成、工具 execute 真实路径集成、上下文固化，以及 detached process group（独立进程组）收尸监督。

**AI 驱动 smoke**（`npm run test:smoke`，`test/test-ai-smoke.py`）：在隔离环境（`pi -ne -e ./index.ts -ns -np --mode rpc`）驱动真实多 phase dgoal，自动回复启动闸门 select，追踪 `dgoal_propose → dgoal_plan → dgoal_check → dgoal_done` 全工具链。真实模型 + 真实 token，故不进 CI。

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
│   ├── 40-版本实施方案/           ← 当前版本
│   ├── 90-归档/                   ← 历史归档
│   └── 决策档案/                  ← 架构决策记录
├── package.json
├── index.ts                       ← 单文件扩展（约 3040 行）
└── test/
    ├── command-aliases.test.ts
    ├── context-input-cap.test.ts
    ├── task-plan-data-model.test.ts
    ├── dgoal-plan-reducer.test.ts
    ├── plan-overlay-render.test.ts
    ├── plan-status-pure.test.ts
    ├── plan-status-dialog.test.ts
    ├── show-status.test.ts
    ├── startup-gate.test.ts
    ├── state-machine-and-prompt.test.ts
    ├── e2e-integration.test.ts
    ├── tool-execute-integration.test.ts
    ├── subprocess-supervision.test.ts
    └── test-extension-rpc.py
```

## 文档

入口 `doc/README.md`。建检循环 + 三层内容模型是基本盘，决策见 `doc/决策档案/0006`。

## 协议

MIT
