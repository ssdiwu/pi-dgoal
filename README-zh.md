# pi-dgoal

[English README](./README.md)

让 agent 围绕一个目标持续工作，直到独立审核员确认完成——通过 Task Plan 和建检循环。

> **v0.2.0**：Task Plan（goal/phase/task）+ 启动闸门 + 实时浮层 + 建检循环 + 终审。详见 `doc/30-路线图`。

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

启动闸门对话框默认只展示阶段级摘要（goal + verification + phases + task 数量），需要时可点入口查看 task 明细；确认 / 拒绝 / 反馈后再进入 loop。

loop 中：

- agent 用 `dgoal_plan` 推进任务状态（`pending → in_progress → done | blocked`）
- 每个 phase 完成都通过 `dgoal_check`（独立子进程，带受限核验工具，含 `bash`）独立审核
- editor 上方实时浮层显示 phase 进度；task 默认隐藏，跟随 Pi 的 `app.tools.expand`（默认 `Ctrl+O`）展开，底部同一行提示快捷键与常用命令说明
- 安装 `pi-di18n` 时，浮层、状态栏、通知和启动闸门等用户可见文案可跟随 locale；模型侧 prompt 和工具 schema 保持不变

控制目标：

```text
/dgoal status | s   # top-center modal 查看完整 plan 状态 + 状态栏指示
/dgoal pause  | p   # 停止自动续跑（保留 goal）
/dgoal resume | r   # 恢复暂停的 goal
/dgoal clear  | c   # 清除当前 session 的 goal
```

声明完成（触发终审）：

agent 调 `dgoal_done(summary, verification)`。终审通过则 goal 关闭，loop 停止。

## 工具

| 工具 | 用途 |
|---|---|
| `dgoal_propose` | 启动闸门：提交 goal + phases + 初始 tasks，用户确认后才进 loop |
| `dgoal_plan` | task 的 CRUD（create / update / list / get），四态状态机，`blockedBy` 依赖追踪 + 环检测 |
| `dgoal_check` | phase 完成门（spawn 独立验收子进程，fresh 上下文 + 受限核验工具），最后 phase 调用即终审 |
| `dgoal_done` | 声明 goal 完成，内部触发终审，是关闭 goal 的唯一方式 |

## 设计边界

- 会话内单 goal，不做多目标池
- Task Plan 必选：`/dgoal` 即复合目标，不允许空 plan 完成
- Goal 层确认后冻结；phase/task 层 loop 内可调
- done task 不回退：做错了新建接续 task（`blockedBy` 指向原 task）
- 独立审核：审核员是独立 `pi` 子进程，fresh 上下文、无主会话历史、禁 skills/extensions，只带受限核验工具（`read`、`grep`、`find`、`ls`、`bash`），完成不自证
- 不自动 Git 操作，不替代项目测试，不做固定 workflow engine

## Goal 生命周期

```text
pending ──→ active ──→ done                # 正常路径
              │  ↑
              ↓  │ rejected                # 终审不过，loop 继续（每轮 prompt 钉审核问题）
              │  │  ×3 终审不过
              ↓  ↓
            paused (audit_failed_3x) ──/dgoal resume──→ active
            paused (user_abort / model_error / audit_error) ──/dgoal resume──→ active
```

状态定义见 `doc/术语表.md`，rejected/paused 契约见 `doc/adr/0004`，当前实现见 `doc/10-架构与运行/`。

## 完成审核

`dgoal_done` 走 `dgoal_check` 终审模式：独立 `pi` 子进程，fresh 上下文，受限核验工具（`read`、`grep`、`find`、`ls`、`bash`）。

```text
--no-session --no-extensions --no-skills --mode json --tools read,grep,find,ls,bash
```

- 通过：goal 关闭，loop 停止，模型收到完成信号用于最终用户回复
- 拒绝：goal 进 `rejected`，审核报告注入对话，每轮 prompt 钉着未过问题；连续 3 次拒绝 → 暂停，`/dgoal resume` 清零重试
- 审核出错 / 中断 / 空闲超时 / 无结论：goal 安全暂停，`/dgoal resume` 继续
- 审核过程会通过工具增量更新回传；即使中途停下，也会尽量返回部分审核输出
- 审核报告更接近验收单：GWT 风格的 PASS / FAIL / BLOCKER 条目，加代码与文档一致性检查
- 逃生通道：`PI_DGOAL_NO_AUDIT=1` 跳过审核（仅调试）

## 测试

```bash
npm test         # bun: 全套
npm run test:rpc # python: RPC 加载 + 命令注册
```

测试文件覆盖数据模型 + 持久化、plan reducer（状态机 + 环检测）、浮层渲染、启动闸门、状态机 + prompt、端到端集成、工具 execute 真实路径集成、上下文固化，以及 detached process group（独立进程组）收尸监督。

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
│   └── adr/                       ← 架构决策记录
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

入口 `doc/README.md`。建检循环 + 三层内容模型是基本盘，决策见 `doc/adr/0006`。

## 协议

MIT
