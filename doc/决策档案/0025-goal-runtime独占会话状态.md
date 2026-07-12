# ADR 0025：Goal Runtime 独占会话状态

> Status：已决，待实现。

`src/goal-runtime` 独占当前 goal、pending proposal、续跑、计数器、最新终审反馈、终审修复账本与结构化修复归因等可变 session 状态。plan 保持纯数据与 reducer；audit 只返回结论与归因；startup 只生成输入结果；tui 只消费只读展示投影；index 只组装。测试通过 runtime 的公开行为和系统边界 adapter 替身验证，逐步移除入口级 `__*ForTest` 白盒钩子，避免可变全局状态跨模块泄漏。
