# tui

TUI（终端界面）纯辅助函数与组件的迁出目录。当前包含滚动键处理、耗时格式化、截断和删除线等无状态 helper；Goal Runtime 负责通过 widget `Component.render(width)` 接入 Pi UI，按真实终端显示宽度裁切持续浮层，并防御渲染异常。
