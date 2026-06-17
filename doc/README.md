# doc/

pi-dgoal 的文档目录。

## 当前文档结构

pi-dgoal 是单文件扩展，当前**唯一权威文档是根 `README.md`**，本 `doc/` 暂无独立子文档。这个 `doc/README.md` 作为文档入口存在。

## 根 README 阅读地图

先读根 [`README.md`](../README.md)，它的结构是：

1. **功能** — `/dgoal` 目标模式、`loop_complete` 工具、会话内状态、自动续跑、安全暂停、启动背景固化
2. **安装到本机 Pi** — 加入 `packages` + `/reload`
3. **使用方式** — `/dgoal <目标>` 和控制命令（status / pause / resume / clear）；`/dloop` 是兼容旧命令
4. **测试** — `npm run test:rpc`
5. **文件结构**
6. **完成审核（auditor）** — 独立审核员子进程隔离设计（这是 ADR 级决策，见该节）
7. **设计边界** — 不做 Git、不替代测试、会话内单目标、背景固化是补充、审核员复用主模型

## 何时把内容迁入 doc/

当出现以下情况，把对应内容从根 README 迁入 `doc/`：

- **`doc/adr/`**：当完成审核员的进程隔离设计、不做持久化等决策需要从 README "完成审核"节抽出为独立 ADR 时。
- **`doc/术语表.md`**：当 `loop_complete` / auditor / background context 等词频繁被混用、需要收敛叫法时。

在此之前，根 README 是唯一权威文档，改动同步更新它。
