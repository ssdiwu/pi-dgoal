# tui

TUI（终端界面）辅助函数与组件目录。`helpers.ts` 提供滚动键处理、耗时格式化、截断和删除线等无状态 helper；`plan-components.ts` 承载持续浮层与 `/dgoal s` Modal 的组件生命周期、缓存、滚动和选择状态。runtime 通过构造依赖注入提供当前 goal、i18n、状态判定和只读投影，TUI 模块不反向依赖 runtime。Goal Runtime 仍负责会话状态所有权；widget 默认只显示计划摘要、由 `Ctrl+O` 展开详情、完成快照完整展示，并按真实终端显示宽度裁切及防御渲染异常。
