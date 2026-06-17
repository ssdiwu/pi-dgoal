# AGENTS.md — pi-dgoal

> pi-dgoal 是一个 Pi 扩展，让 agent 围绕一个明确目标持续工作，直到显式完成并给出验证证据。

## 先读

1. `README.md`（功能、安装、使用、完成审核机制、设计边界——必读）
2. `doc/术语表.md`（含建检循环第一性原理 + 全部术语定义）
3. `doc/10-架构与运行/`（建检循环与三层结构、状态机、工具命令、启动闸门——当前实现权威）
4. `doc/adr/`（架构决策记录 0001-0006，0006 是基本盘）
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
│   └── adr/                          ← 架构决策记录（0001-0006）
├── test/
│   ├── test-extension-rpc.py         ← RPC 加载与命令注册测试
│   └── context-input-cap.test.ts     ← 启动背景固化测试
└── package.json
```

## 代码边界

- **会话内单目标**：只支持当前会话内单目标，不做多目标池。
- **Task Plan 必选**：`/dgoal` 即复合目标，必须有 plan（phase + task 两层内容）；无空 plan 放行。详见 ADR 0002/0006。
- **三层内容 + 建检循环**：goal（冻结）/phase（task 聚合）/task（按需分解）三层；dgoal 是建检循环——定义 goal + 完成后 check，不过继续干，过则结束。phase completed 唯一入口是 `dgoal_check`（独立子进程，建检不可绕过）。详见 ADR 0006、`doc/10-架构与运行/`。
- **工具规范化**：agent 与 dgoal 状态机的交互统一用 `dgoal_` 前缀工具：`dgoal_propose`（提交计划）、`dgoal_plan`（更新 task）、`dgoal_check`（phase completed 唯一入口，阶段建检/终审）、`dgoal_done`（声明完成+触发终审）。原 `loop_complete` 已改名 `dgoal_done`。
- **不碰 Git**：不自动执行 Git 提交、回滚或删除。
- **不替代测试**：不替代项目自身测试命令；agent 仍需按项目现状选择并运行验证。
- **背景固化是补充**：启动背景固化是补充信息，不替代把关键约束写进 objective 或文档；摘要可能漏点。
- **审核员默认复用主模型**：不做独立模型配置。
- 不硬编码密钥、token、私有路径。

## 验证

改动后至少执行：

```bash
npm run test:rpc      # RPC 加载 + /dgoal 命令注册
npm run test:context  # 启动背景固化逻辑（bun test）
```

完整自动续跑和审核行为仍需在 Pi TUI 中用真实模型做人工 smoke test。

## Git 规范

- 每次 commit 只做一件事。
- 提交标题默认中文，格式：`分类：动作 + 对象`。
- 禁止 `git push --force` 到 `main`。

## 文档现状说明

根 `README.md`（英文）/ `README-zh.md`（中文）是功能与边界权威入口。`doc/` 下已有独立子文档：

- `doc/术语表.md` — 术语精确定义
- `doc/90-归档/Task-Plan设计底稿-拷问过程.md` — 507-grill 拷问全过程（1-25 轮，历史追溯）
- `doc/adr/` — 架构决策记录（0001-0005）

详见 [`doc/README.md`](./doc/README.md) 的阅读地图。
