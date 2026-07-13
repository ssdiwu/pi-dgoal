# ADR 0025：Goal Runtime 独占会话状态

> Status：已实现（vNext，含收敛说明）。

Goal Runtime 独占当前 goal、pending proposal、续跑、计数器、最新终审反馈、终审修复账本与结构化修复归因等可变 session 状态。plan 保持纯数据与 reducer；audit 只返回结论与归因；tui 只消费只读展示投影；index 只组装。

**收敛说明**：原草案以独立 `src/goal-runtime` 目录承载该职责。实际交付中 Goal Runtime 与 startup 编排合并于 `src/runtime`（见 0024 收敛说明）：会话状态确由 runtime 独占（无第二个模块持有可变 session 状态），只是未拆出单独目录。原草案提及「逐步移除入口级 `__*ForTest` 白盒钩子」属后续测试接缝收敛工作，不在本次 vNext 冻结范围；当前仍保留必要的行为测试入口（如审核器、背景总结候选循环、命令分发的受控替身），后续按真实公开行为测试面收敛。
