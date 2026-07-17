# `test/`

pi-dgoal 测试地图。离线确定性测试使用 Bun；扩展加载、命令与工具注册使用 Python RPC；另有消耗真实 token 的模型 smoke。

## 运行

```bash
npm test                    # 全量 Bun 单元/集成测试
npm run test:context        # context-input-cap.test.ts
npm run test:rpc            # RPC 加载、命令与八工具注册
npm run test:smoke:runtime  # smoke 的宿主 Pi 选择逻辑，不消耗 token
npm run test:smoke:cleanup  # 子进程/临时认证清理，不消耗 token
npm run test:smoke          # 真实模型 smoke，消耗 token
```

## 三档 Plan 主覆盖

| 文件 | 验证内容 |
|---|---|
| `three-plan-runtime.test.ts` | 八工具集合；三档 Plan 生命周期；三层 Description 必填/冻结/显式修订；Task Plan 隐藏 phase/整份替换及最后 task 自动收口；严格状态/evidence 守卫；revision 并发失效；check→update 双层链与主动暂停 |
| `activation-boundary.test.ts` | Task Plan 默认 guidance、Phase/Goal Plan 显式激活边界、自然语言显式授权反例、入口 schema 不再暴露 implicit / runtime budget |
| `task-plan-data-model.test.ts` | Description 新契约、Plan 数据与 `dgoal-plan-v2` 持久化往返、v1/旧 entry 隔离、check feedback helper |
| `state-machine-and-prompt.test.ts` | 三档 Plan system prompt、Plan context 注入、软遗忘、暂停/恢复 helper |
| `plan-overlay-render.test.ts` | 常驻浮层按终端显示宽度裁切 heading、phase/task 展开、reload、完成闪现与 UI 容错 |
| `plan-status-pure.test.ts` / `plan-status-dialog.test.ts` | `/dgoal s` 两层 Modal 的逻辑项选择、列表/详情导航、description/运行字段投影、返回保位、换行、滚动、缓存和组件契约 |
| `startup-gate.test.ts` | Phase/Goal proposal 结构校验、语义预审、Plan 类型切换反馈、确认 UI 与技术/语义失败分流 |
| `command-aliases.test.ts` / `startgoal-abort.test.ts` | `/dgoal` 命令路由、裸命令承接、启动中断与投递去重 |

## 审核与可靠性

| 文件组 | 验证内容 |
|---|---|
| `check-event-classify.test.ts` | 审核事件活性、idle timeout、候选切换与 auditor_error |
| `auditor-config.test.ts` / `auditor-fallback.test.ts` / `auditor-quota-fallback.test.ts` | 模型候选配置、预检、技术错误回退与业务 rejection 分流 |
| `audit-checkpoint*.test.ts` | workspace fingerprint、成功命令复用、脱敏与重启恢复 |
| `audit-usage*.test.ts` | 审核 usage ledger 与跨仓库聚合 |
| `auditor-workspace-cwd.test.ts` | 审核工作目录与 worktree 推断 |
| `subprocess-supervision.test.ts` | detached process group 整体收尸 |
| `no-progress-stall.test.ts` / `no-progress-agent-end.test.ts` | 连续无进展熔断、工具调用重置、user_abort / model_error |
| `show-status.test.ts` | 状态查询与 TUI fail-soft |

## Reducer 与参数边界

`dgoal-plan-reducer.test.ts`、`tool-execute-integration.test.ts`、`prepare-arguments-schema.test.ts`、`phase-id-diagnostics.test.ts` 覆盖共用 reducer、proposal coercion、revision 单调性、phase/task 双 ID namespace、类型化同号消歧与旧 Plan phase 定位。公共工具状态机的权威测试是 `three-plan-runtime.test.ts`，真实宿主注册由 `test-extension-rpc.py` + `rpc-tool-probe.ts` 核验。

`context-input-cap.test.ts` 现在覆盖 ADR 0042 的冻结 goal description 启动 prompt；旧 `context-summarizer-*` 测试随 `contextSummary` 生产链删除。`phase-plan-proposal-path.test.ts` 覆盖 Phase Plan 不带 phase criteria 的语义预审边界。

## Python smoke

| 文件 | 验证内容 |
|---|---|
| `test-extension-rpc.py` | 隔离加载扩展、`/dgoal` 命令与八工具注册 |
| `test-ai-smoke-runtime.py` | 跳过项目 local Pi、选择宿主 Pi、启动闸门 select 防伪与最终完成判定 |
| `test-ai-smoke.py` | 单 phase Goal Plan 的真实模型/RPC/文件链：`goal_plan → plan_update(task) → phase_check → plan_update(phase) → goal_check → plan_update(goal)` |
| `test-auditor-fallback-smoke.py` | 真实候选 401 → fallback → 审核结论 |
| `test-auditor-fallback-cleanup.py` | SIGTERM 后临时认证、目录与子进程清理 |

真实模型 smoke 刻意只跑一条最小 Goal Plan 链以控制 token；Task Plan、Phase Plan、`plan_create` / `plan_read`、revision 失效与旧键隔离由上面的确定性 Bun 测试覆盖。`test-extension-rpc.py` 只证明真实宿主加载与注册，不宣称覆盖 RPC 状态机执行。

## 人工复核边界

自动化不替代真实 TUI 体验。启动确认、Plan 类型切换、持续显示浮层、Modal 视觉、键盘交互和真实 rejected 修复回环仍建议人工 smoke；这些体验项不作为机器完成门。
