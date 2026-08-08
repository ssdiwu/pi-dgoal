# 14 - TUI 边界与状态机容错

> Goal / Work List / Plan Contract、持久化和建检记录是业务事实；TUI 只是展示层。任何渲染异常都不能阻断关闭、恢复或审核落盘。

## 总原则

- 状态一致性优先于动画、浮层、状态栏或通知完整性。
- `dgoal-work-v1` done / null tombstone、Plan Run History 归档与运行态清理不能依赖 UI 成功。
- TUI 调用必须 fail-soft（失败降级）：失败只影响展示，不回滚业务事实。
- UI 错误不能吞掉工具结果；用户至少从工具返回、`work_read` 或后续 `/dgoal s` 看到真实状态。

## 高风险路径

| 路径 | 风险 | 要求 |
|---|---|---|
| soft 最后一个 terminal update | 自动收口后 snapshot / status 抛错 | Goal 仍 tombstone，工具仍返回 completion summary |
| `work_update(goal,done)` | 归档或 UI 后效打断清理 | 先归档（如适用）、done、tombstone、运行态清理，再做 UI |
| `phase_check` / `goal_check` | 活性或报告展示异常 | CheckRecord 优先落地；check 不代写 Phase / Goal done |
| overlay / status bar | widget 组件或宽度路径异常 | 降级或跳过刷新，不影响状态 |
| startup gate | select / editor / confirm 抛错 | 不半激活；保留原 Work List 与可恢复 proposal |
| Current / History Modal | render / input handler 异常 | 只关闭 Modal，不修改 current / history |

## 完成事务

统一关闭 helper 的顺序：

1. 校验 terminal Work Item、真实 Phase、planned evidence 与当前 check 守卫。
2. Plan Contract 需要归档时，先把脱敏 Plan Run History 持久化成功。
3. 持久化 Goal `status=done`。
4. 持久化 `{ goal: null }` tombstone 并清除内存 current Goal。
5. 取消 continuation，清 proposal、错误/no-progress 计数、auditor workspace tracker、check snapshot、三类授权与模型错误恢复 token。
6. 清状态栏，尝试 done snapshot / overlay hide。
7. 返回带 `summary` / `verification` / `profile` / `archived` / `autoClosed` 的工具结果及 `dgoal 完成信号`。

第 6 步是 after-effect（后效）。任何异常都不能回滚 2–5 步，也不能把完成伪装成失败。

## Proposal 原子性

高保障 proposal 只有在授权、结构、语义与用户确认全部成功后才写 active Goal。确认 UI 失败时恢复 pending proposal；拒绝或反馈保持原 Goal / Work List；session generation 改变时丢弃迟到 proposal 结果。

## 测试要求

涉及 completion、check、overlay、status、notification、startup gate 或 History 的改动至少覆盖：

1. 模拟 `setWidget` / `setStatus` / `notify` / `ctx.ui.custom` 抛出代表性异常。
2. 触发真实公共工具或 session 重同步路径。
3. 断言内存状态、`dgoal-work-v1` 写序列与 History 一致。
4. 对 completion 断言 done 写入先于 null tombstone，且返回可读总结。
5. 对 check 断言 UI 失败不改变 approved / rejected / audit_error 事实，也不提前 done。
6. 对 proposal 断言失败不留下半激活状态。

## 手工验证

真实 Pi TUI 至少检查三条链：

```text
# soft 自动收口
work_list → work_update(last item, done) → /dgoal status 不再显示旧清单

# Goal Check
/dgoal → goal_plan → goal_check → work_update(goal, done)

# Staged Check + History
/dgoal → staged_plan → phase_check → work_update(phase, done)
→ goal_check → work_update(goal, done) → /dgoal status History tab
```

期望：check approved 后仍 active；只有 `work_update` 收口。完成反馈包含总结；Current 清空而 History（Plan Contract only）可读；任一展示异常不使旧 Goal 残留。

## 不做

- 不在 dgoal 内修 Pi 主程序组件根因；只隔离展示失败。
- 不以静默吞错替代开发诊断；测试与日志仍应保留可定位信号。
- 不用 UI 成功判断建检通过；结论只来自结构化 check。
- 不让 History 成为第二个 active 状态或 resume 入口。
