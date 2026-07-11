# 决策档案索引

> 只收「难逆转 + 无上下文会困惑 + 有真实权衡」的决策（刻碑，记了就不删）。新增 / 更新 ADR 时同步本索引。每条一行：编号 + 标题 + 一句话主旨（写「定了什么」不写「为什么」，深读点文件）。0006 是基本盘，统领架构。

| 编号 | 标题 | 一句话主旨 |
|---|---|---|
| [0001](./0001-Task-Plan的goal与step两层分离.md) | Task Plan 的 goal/step 两层分离 | plan 分 goal（冻结）/ step（可改）两层，解开稳定性与适应性 |
| [0002](./0002-启动闸门与工具回调提交计划.md) | 启动闸门与工具回调提交计划 | 启动闸门确认方向，进 loop 后 step 可改；启动靠工具回调提交 plan |
| [0003](./0003-dgoal-check单工具承载自检与终审.md) | dgoal_check 单工具承载自检与终审 | 一个工具承载阶段建检与终审两个粒度 |
| [0004](./0004-状态机扩展rejected与两种paused.md) | 状态机扩展 rejected 与两种 paused | goal 加 rejected，paused 区分用户暂停与建检失败暂停 |
| [0005](./0005-step-blocked状态.md) | step blocked 状态 | step 加 blocked 状态，表达执行阻塞 |
| [0006](./0006-建检循环心智模型与三层结构.md) | 建检循环心智模型 + 三层结构 | dgoal = 定义 goal + 完成后 check；goal/phase/task 三层 + 双可见性轴，统领架构 |
| [0007](./0007-contextSummary与verification分字段.md) | contextSummary 与 verification 分字段 | 两者职责不同保持双字段，verification 可默认继承 contextSummary 的验收部分 |
| [0008](./0008-dgoal-s-modal-形态选型.md) | `/dgoal s` 命令弹窗形态选型 | `/dgoal s` 采用 top-center overlay modal 形态 |
| [0009](./0009-TUI视觉编码改为层级靠颜色状态靠字符.md) | TUI 视觉编码改为层级靠颜色状态靠字符 | goal/phase/task 用层级基色区分，状态统一用前缀字符；覆盖 0008 视觉编码部分 |
| [0010](./0010-done-phase软遗忘注入只留标题行.md) | done phase 软遗忘，注入只留标题行 | done phase 注入只保留标题行，其下 task 软遗忘以聚焦当前进度 |
| [0011](./0011-建检反馈持久化到LoopGoal.md) | 建检反馈持久化到 LoopGoal | 建检失败报告持久化到 LoopGoal，不靠 transcript 存活 |
| [0012](./0012-阶段建检闸门锁定与事件流化审核器.md) | 阶段建检闸门锁定 + 事件流化审核器 | 建检不过则锁当前 phase，审核子进程改事件流导向 |
| [0013](./0013-auditorModel配置落点选独立文件.md) | auditorModel 配置落点选独立文件 | 审核器选模用 pi-dgoal.json 而非借道 settings.json，不依赖 Pi 未文档化的未知字段容忍 |
| [0014](./0014-审核器配置初始化与双范围专用模型.md) | 审核器配置初始化与双范围专用模型 | 首次实际审核初始化双 null 模板，阶段与目标审核模型各自持久配置 |
| [0015](./0015-审核模型候选链与错误回退.md) | 审核模型候选链与错误回退 | 两级审核分别配置有序候选链，仅在审核器技术异常时回退，耗尽后暂停 |
| [0016](./0016-阶段与目标只接受LLM可独立验收条件.md) | 阶段与目标只接受 LLM 可独立验收条件 | 完成门只收 LLM 可核验条件；人工体验复核在 dgoal 完成后明确交付 |
