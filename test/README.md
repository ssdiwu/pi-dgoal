# `test/`

pi-dgoal 测试地图。离线确定性测试使用 Bun；扩展加载、命令与九工具注册使用 Python RPC；真实模型 smoke 会消耗 token。

## 运行

```bash
npm test                    # 全量 Bun 单元 / 集成测试
npm run test:context        # context-input-cap.test.ts
npm run test:rpc            # RPC 加载、命令与九工具注册
npm run test:smoke:runtime  # smoke 宿主选择与完成判定，不消耗 token
npm run test:smoke:cleanup  # 子进程 / 临时认证清理，不消耗 token
npm run test:smoke          # 真实模型 smoke，消耗 token
```

## Work List 与三档保障

| 文件 | 验证内容 |
|---|---|
| `work-list-data-model.test.ts` | soft / planned 校验、Work Item / Phase 双 ID namespace、DAG、状态原因、evidence / deliverableEvidence、Phase 串行与成员耗尽不自动 done |
| `work-list-runtime.test.ts` | `work_list` / `work_create` / `work_read` / `work_update`、soft 自动收口、真实 Phase 显式关闭、新旧持久键隔离与 tombstone |
| `execution-plan-runtime.test.ts` | soft → Execution、Until Done、计划态守卫、显式 Goal 收口、完成总结与可靠状态清理 |
| `work-plan-assurance-runtime.test.ts` | Goal Check / Staged Check proposal、Profile 单向升级、Phase / Goal check-update 分离、局部 revision 与确认原子性 |
| `plan-history-runtime.test.ts` | Plan Run History 归档、去重、裁剪、Current / History 读取与二次确认清理 |
| `activation-boundary.test.ts` | soft / Execution 默认 guidance、高保障显式授权、自然语言反例、九工具 schema 不暴露旧隐式 / budget 路径 |
| `state-machine-and-prompt.test.ts` | Work List / Plan Contract context、Profile prompt、soft forgetting、暂停/恢复与执行权威 |
| `soft-forgetting-e2e-smoke.test.ts` | done Phase 执行上下文只留标题，结构化状态仍完整 |
| `startup-gate.test.ts` | Goal Check / Staged Check 结构校验、语义预审、Profile 切换、确认 UI 与技术/语义失败分流 |
| `session-tree-resync.test.ts` | `dgoal-work-v1` session tree / compact 恢复、旧 key 拒绝、迟到审核与 continuation 隔离 |

## TUI 与工具投影

| 文件 | 验证内容 |
|---|---|
| `plan-overlay-render.test.ts` | Profile / Phase / Work Item 常驻浮层、宽度裁切、展开、reload、完成快照与 UI 容错 |
| `plan-status-pure.test.ts` / `plan-status-dialog.test.ts` | Current / History Modal、逻辑项导航、Description / frontier / check / History 详情、换行滚动与组件契约 |
| `tool-result-render.test.ts` | 九工具摘要、白名单化展开、check 活性与创建/更新具体详情 |
| `show-status.test.ts` | 状态查询、Modal 调用与 fail-soft |
| `help-command-routing.test.ts` / `command-aliases.test.ts` / `startgoal-abort.test.ts` | `/dgoal` 命令、history clear、裸命令承接、中断与投递去重 |

## 审核、熔断与参数边界

| 文件组 | 验证内容 |
|---|---|
| `context-input-cap.test.ts` | context 上限、冻结契约 XML escape、Phase / Goal auditor prompt、check/update 因果与完成信号 |
| `check-event-classify.test.ts` | child 事件活性、idle timeout 与错误分类 |
| `auditor-config.test.ts` / `auditor-fallback.test.ts` / `auditor-quota-fallback.test.ts` | 模型候选、预检、技术回退、scope 粘性与业务 rejection 分流 |
| `audit-checkpoint*.test.ts` | workspace fingerprint、稳定成功命令复用、脱敏、工作区变化与重启恢复 |
| `audit-usage*.test.ts` | 审核 usage ledger、生产事件路径与跨仓库聚合 |
| `auditor-workspace-cwd.test.ts` | auditor cwd / worktree 推断与 Goal 关闭后 tracker 清理 |
| `subprocess-supervision.test.ts` / `auditor-abort-listener.test.ts` | detached process group 与 abort listener 收尸 |
| `no-progress-stall.test.ts` / `no-progress-agent-end.test.ts` | Plan Contract 3/8 熔断、durable progress 分类、Execution model_error 精确用户输入恢复与生命周期重置 |
| `paused-state-diagnostics.test.ts` | paused 下 read 可用、mutation / check 拒绝与原因投影 |
| `prepare-arguments-schema.test.ts` | 九工具 strict schema nullable 与 blockedBy 字符串数组 coercion |

## Python smoke

| 文件 | 验证内容 |
|---|---|
| `test-extension-rpc.py` | 隔离加载扩展、`/dgoal` 命令与九工具注册 |
| `test-ai-smoke-runtime.py` | 跳过项目 local Pi、选择宿主 Pi、启动确认防伪与仅凭最终 `work_update` completed 判定成功 |
| `test-ai-smoke.py` | 单 Phase Staged Check 的真实模型/RPC/文件链 |
| `test-auditor-fallback-smoke.py` | 真实候选技术失败 → fallback → check/update 完整链 |
| `test-auditor-fallback-cleanup.py` | SIGTERM 后临时认证、目录与子进程清理 |

真实模型 smoke 只跑一条最小 Staged Check 链以控制 token；soft、Execution、Goal Check、History、revision 失效与旧 key 隔离由确定性 Bun 测试覆盖。RPC 测试只证明真实宿主加载与注册，不冒充完整状态机执行。

## 人工复核边界

自动化不替代真实 TUI 体验。启动确认、Profile 切换、持续浮层、Current / History Modal、键盘交互、错误回环与完成总结仍需人工 smoke；这些体验项不作为机器独立完成门。
