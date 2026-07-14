# audit

审核结果的无副作用解析与格式化：结论 marker、进度摘要和用户复核建议提取。`checkpoint.ts` 保存来自独立审核 child（子进程）的脱敏工具执行事实：同一工作区 fingerprint（指纹）下已成功结束的精确命令可供候选切换或 resume（恢复）复用；运行中、失败或工作区变化的记录不算完成。审核进程编排、Goal Runtime 状态写入与 Pi UI 仍由上层模块负责。`usage.ts` 只记录脱敏用量账本，不保存 prompt、报告或工具输出。
