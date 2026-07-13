# runtime

Goal Runtime 的合并承载层：管理当前会话的 dgoal 生命周期、可变 session 状态（当前 goal、pending proposal、续跑、计数器、终审反馈、终审修复账本）、工具与命令协调、启动闸门与背景总结编排。

`src/plan/`、`src/audit/`、`src/isolated-pi/`、`src/tui/` 已按真实职责迁出；本模块合并承载 goal runtime 与 startup 编排（单一消费者，未达二次分裂触发点，见 ADR 0024/0025 收敛说明）。未来若体积或接缝压力再次升高，再按 0025 边界拆出 `src/goal-runtime` 与 `src/startup`。
