# 14 - TUI 边界与状态机容错

> dgoal 的状态机、持久化和建检结果是业务事实；TUI 只是展示层。任何 TUI 渲染异常都不能阻断 goal 闭环。

## 背景

`pi-dgoal` 同时有业务状态机和 TUI 表面：启动闸门、计划浮层、状态栏、完成提示、审核进度流。TUI 帮用户理解 loop，但不拥有状态事实。

近期多个 Pi 扩展反复遇到 `Spacer is not defined`。该错误来自 Pi 主程序 TUI 渲染层：某条渲染路径引用了未定义组件。对 dgoal 来说，最危险的不是“少显示一个浮层”，而是 UI 抛错打断 `finalizeGoal`，导致终审已通过但 `currentGoal` / 持久化状态没有清空，goal 卡死无法关闭。

## 总原则

- 状态机一致性优先于 UI 展示完整性。
- `currentGoal`、`persistGoal(null)`、phase/task 状态和审核报告注入不能依赖 UI 渲染成功。
- TUI 调用必须 fail-soft（失败降级）：渲染失败只影响展示，不影响 loop 推进或终结。
- UI 错误不能吞掉建检结果；用户至少要能从命令返回或后续状态看到真实结果。

## 高风险路径

| 路径 | 风险 | 要求 |
|---|---|---|
| `finalizeGoal` | goal done 后完成浮层 / 状态栏清空抛错，阻断 `persistGoal(null)` | 先完成状态清理，UI 展示独立容错 |
| `dgoal_done` | 终审通过但最终提示渲染失败 | 工具结果仍返回完成信号，goal 仍关闭 |
| `dgoal_check` | 审核进度流或报告展示异常 | 审核结论和 phase 状态优先落地 |
| plan overlay / status bar | aboveEditor 或状态栏组件异常 | 降级或跳过刷新，不影响 task/phase 状态 |
| startup gate | 确认 UI 异常 | 不得创建半激活 goal；要返回可读错误或保持 pending 可恢复 |

## `finalizeGoal` 边界

`finalizeGoal` 的目标是结束 goal，不是展示动画。正确顺序是：

1. 确认终审通过。
2. 将 goal 状态推进到 `done`。
3. 清空运行态引用并持久化：`currentGoal = null` / `persistGoal(null)`。
4. 尝试展示完成浮层、清空状态栏、发通知。
5. 如果第 4 步抛错，只记录或降级，不回滚 1–3 步。

也就是说，UI 是“after-effect（后效）”，不是事务主体。

## 测试要求

涉及完成、审核、overlay、status、notification、startup gate 的改动，必须至少覆盖一个 UI 抛错场景：

1. 模拟 TUI 展示函数抛出 `Error("Spacer is not defined")` 或等价异常。
2. 触发对应业务路径（如终审通过后的 `finalizeGoal`）。
3. 断言 goal 状态已经正确清空或推进。
4. 断言持久化状态与内存状态一致。
5. 断言工具返回仍可读，不把 UI 堆栈当成业务失败。

## 手工验证

真实 Pi TUI smoke test 重点看三件事：

```text
/dgoal <一个可快速完成的小目标>
# agent 完成最后一个 phase 后触发 dgoal_done
/dgoal status
```

期望：

- 终审通过后 loop 停止。
- `/dgoal status` 不再显示旧 goal 卡住。
- 完成浮层或状态栏即使展示异常，也不影响 goal 关闭。

## 不做

- 不在 dgoal 内修 Pi 主程序的 `Spacer` 组件问题；那是上游 TUI 根因。
- 不把所有 UI 异常静默吞掉；开发/调试路径仍应保留可诊断信息。
- 不用 UI 成功与否判断建检是否通过；建检结论只来自 `dgoal_check` / 审核器结果。
