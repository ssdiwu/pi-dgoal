# Phase 审核使用局部修订号

> Status：已接受，已实现。

Goal Plan 的 `phase_check` 改为匹配所属 phase 的局部修订号；task、description 或该 phase 的受审事实变更时，只使该 phase 的批准失效。任意 Plan 写操作仍增加全局 Plan revision 并使 `goal_check` 失效，最终审核继续复核跨 phase 影响。

全局 revision 会令一个 phase 的修复迫使所有已完成 phase 重审，已在真实会话中产生大量无关审核。局部 revision 保留阶段审核作为该阶段里程碑的价值；以全局 `goal_check` 维持整体交付的保守性。