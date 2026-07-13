# ADR 0020：`/dgoal help` 命令由 AI 解释

> Status：已实现（vNext）。

`/dgoal help` 是用户命令，不注册为 `dgoal_help` AI 工具。仅在冷启动（无 current goal）或 `paused`（暂停）时可用：用户调用后由当前会话 AI 按用户语言解释 dgoal 的用途、启动方式、工具状态边界与常用命令，而非输出固定中英文帮助文本。`pending`、`active` 与 `rejected` 时不向 AI 投递 help prompt，避免打断启动闸门或正在推进的任务；命令只返回“请先暂停或等待当前目标结束”的轻量提示。help 不启动、恢复、暂停、清除或修改 goal，也不授予 AI 调用 `dgoal_*` 工具的额外权限；它只请求一次面向用户的说明。
