# pi-dgoal — Agent 规范

## 文件职责与阅读顺序

- 本文件只记录 Goal/Plan 生命周期长期安全与工程边界，不复制当前工具数量、状态字段、阈值、ADR 清单或实现完成度。
- 修改前读取 `README.md`、`doc/README.md`、`doc/术语表.md`、当前架构文档、目标源码与 `test/README.md`；具体 Plan 类型、工具契约和状态机以当前代码、类型和对应 ADR 为准。
- `doc/90-归档/` 只提供历史背景；被覆盖的 ADR 和旧持久化结构不得作为当前实现权威。

## Goal 与 Plan 安全边界

- 每个会话只维护一个当前 Goal/Work List；不得用平行状态或自由文本绕过公共工具和持久化契约。
- 软清单、持续执行、goal 独立终审和逐阶段建检具有不同保障；升级必须保持现有 ID、终态和证据，不静默替换用户已确认的目标。
- 需要独立审核的 Plan 必须先有显式用户授权、可自主验收的条件和原子 proposal；授权、结构或语义预审失败不得留下半激活状态。
- check 只记录独立审核结果，Phase / Goal 完成状态由 `work_update` 显式写入；不得建立“先 done 才能批准”的自指门。
- 软性 Work List 不启动 continuation、no-progress 计数或独立审核；任何 Work List / Plan Contract 收口都必须可靠清除活动状态并返回用户可见的结构化完成总结。
- LLM 负责语义取舍，运行时只依赖结构化 tool result、持久状态和可验证证据，不解析 assistant 文本或 shell 字符串来猜进展。
- 不替代目标项目测试，不自动执行 Git、删除、发布或其他未获授权副作用。

## 状态、审核与 TUI

- 状态更新、持久化、审核和 TUI 展示分离；渲染异常只能降级提示，不能阻断或伪造 Goal/Phase/Item 状态。
- 审核模型继承、候选回退、项目信任与配置兼容由当前类型和架构文档承担；凭据、模型配置和私有路径不得写入状态、日志或 prompt。
- 自动续跑必须有结构化活性熔断；阈值是实现参数，改变前以回归测试证明，不新增文本关键词判断或平行调度状态。
- done 不回退，abandoned/blocked/paused 必须有原因；声明 deliverable 时完成前逐项留下可复验证据。
- 持久化结构迁移必须遵循当前 ADR：需要迁移时保留可恢复路径并验证旧 session；明确破坏性隔离时必须拒绝旧 key，不得因 schema 错误清空新状态或建立永久双轨。

## 工程与失败恢复

- `index.ts` 保持组合入口，运行时职责按 `src/` 的真实边界组织；只有稳定重复或明确契约时才新增层。
- 修改 proposal、授权、check、update、persist、续跑或 TUI 时，先建立失败测试覆盖原子性、revision 失效、因果顺序和渲染降级。
- 连续两次同类失败且范围未缩小时停止原路径，重读当前 ADR、类型与最小复现；不得在旧新方案间保留永久双轨。

## 验证

按改动范围逐级运行：

```bash
npm run test:rpc
npm run test:context
npm test
```

- 真实模型 smoke 会消耗 token，只在任务需要且获得相应授权后运行 `npm run test:smoke`；先运行 runtime/cleanup 定向测试并使用隔离环境。
- Overlay、modal、确认门和错误回环需要真实 Pi TUI 人工复核；自动测试通过不等于 TUI 已验收。
- 汇报时分别说明单元、RPC、真实模型与人工 TUI 状态。

## 文档与 Git

- 公共工具、Plan 语义、状态机、配置、持久化或用户行为变化时同步 README、术语、架构文档和必要 ADR。
- `CHANGELOG.md` 只记录用户可感知变化。
- 未经用户明确要求，不执行 commit、push、tag 或 npm publish；不得强推受保护分支。
