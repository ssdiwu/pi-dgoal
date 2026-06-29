# ADR 0013：auditorModel 配置落点选独立文件而非 settings.json

独立审核子进程的选模配置（`auditorModel`）用 dgoal 专属配置文件 `pi-dgoal.json`（全局 `~/.pi/agent/pi-dgoal.json` + 项目 `.pi/pi-dgoal.json`），不借用 Pi 本体的 `settings.json`。

## 背景

v0.5.3 引入 `auditorModel`，允许独立审核子进程单独选模。配置落点有两个候选：

1. **借道 settings.json**：往 `~/.pi/agent/settings.json` 或 `.pi/settings.json` 加 dgoal 自定义字段（如顶层 `auditorModel` 或命名空间 `pi-dgoal.auditorModel`）。
2. **独立文件**：dgoal 自管 `pi-dgoal.json`，自己实现全局/项目两级读取、信任边界与合并。

## 决策

选独立文件 `pi-dgoal.json`。

## 理由

### 1. Pi 没有官方扩展配置 API

调研 `@earendil-works/pi-coding-agent` 的 `SettingsManager` 与 `ExtensionContext` 后确认：

- `settings.json` 没有严格 schema 校验：`SettingsManager.loadFromStorage()` 只做 `JSON.parse` + 少量 `migrateSettings`，未知字段不会报错。
- `persistScopedSettings()` 写回时只覆盖本次改动过的字段，未知字段会被保留。
- **但**：`ExtensionContext` 上没有 `ctx.settings` / `pi.getSetting()` 这类扩展读取设置的正式入口；`Settings` 类型也未开放给扩展做命名空间注册。

也就是说，把 `auditorModel` 塞进 settings.json 当前可行，但它依赖的是"Pi 当前实现对未知字段的宽松容忍"，不是"Pi 承诺的扩展配置接口"。一旦 Pi 未来收紧 schema、或给 `Settings` 加严格校验，借道方案就会脆断，且 dgoal 仍要自己读文件做合并（没有官方 API 可省）。

独立文件则完全不依赖 Pi 内部实现：dgoal 自己读、自己解析、自己合并、自己降级，Pi 怎么改 settings.json 都不影响 dgoal。

### 2. 语义更清楚，不混入 Pi 本体配置

`settings.json` 是 Pi 本体的运行配置（provider、model、compaction、retry、theme 等）。`auditorModel` 是 dgoal 这个扩展的业务配置。混进去会让"这个字段谁认"变模糊，也让 `settings.json` 的字段归属变杂。独立文件一眼可辨归属，也便于 dgoal 自己做 schema 校验和提示。

### 3. 同样能复用信任边界，不损失安全模型

独立文件方案完全对齐 Pi 的信任语义：项目级 `.pi/pi-dgoal.json` 只在 `ctx.isProjectTrusted()` 为真时读取，与 Pi 对 project-local 资源的信任边界一致。不借道 settings.json 不损失任何安全性。

## 取舍

- **代价**：dgoal 要自己实现全局/项目两级路径拼接、读取、合并、非法降级与一次性提示（`loadDgoalConfig` / `resolveAuditorModelId`），不能复用 Pi 的 `SettingsManager` 基础设施。
- **换来的**：配置能力不依赖 Pi 未文档化的内部行为，路径稳定可预判；扩展与本体配置物理隔离，归属清晰。

## 边界

- 配置文件**不被自动创建**：避免给不需要选模的用户产生全局副作用和垃圾文件；首次审核且无任何配置时一次性 i18n 提示路径即可。
- 项目级配置受 `ctx.isProjectTrusted()` 保护，与 Pi 信任边界一致。
- 该配置只影响独立审核子进程选模，不改变主执行线程模型。
