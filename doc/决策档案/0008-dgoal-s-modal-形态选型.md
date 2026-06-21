# ADR 0008：`/dgoal s` 命令弹窗形态选型

> 选 `/dgoal s` 重新设计为 top-center overlay modal（Variant A）。完整探索过程和三个变体的取舍见 `doc/20-能力参考/25-dgoal-s-modal变体探索参考.md`，本 ADR 只记录决策与理由。

## 背景

`/dgoal s`（`status` 的单字母别名）当前在 `index.ts:1051` 用 `ctx.ui.notify(...)` 输出 5 行（objective + state + iteration + context preview + commands 提示）。底栏 status bar 也只显示 `🔁 active #N`。

两个视图都不能告诉用户**当前 plan 的完整状态**（goal + 所有 phase + 所有 task）。当 goal 包含 5+ phase / 20+ task 时，用户无法在 TUI 内一目了然看到"现在在做什么、已完成什么、被什么 block"。

507-research 阶段调研了 Pi 官方 `examples/extensions/todo.ts` 和 `pi-tui-design` skill（joelhooks）——两个都印证：`ctx.ui.custom()` Component 是"按需详细查询"的标准 surface（详见 24-pi官方todo例子与pi-tui-design借鉴参考）。

507-prototype 阶段写了 `prototype/dgoal-status-modal.prototype.ts` 试了 3 个变体（A/B/C），迭代 3 轮后选定 A。

## 决策

`/dgoal s` 重写为：调 `ctx.ui.custom()` 弹一个 **top-center overlay modal**（Variant A 形态），组件有：

1. **heading 钉顶**：`🎯 <objective 首行> (X/Y) ⏱️ <elapsed>`，accent 色 + bold
2. **body 可滚动**：每 phase 一行（前缀 emoji `✅/🔄/⬜/🚧` + status 色 + subject），phase 下 task 缩进（`│    ✓/◐/○/⚠` + dim/accent/warning/muted 色）
3. **底部 hint**：当前 offset 指示 + 键位（`↓/j · ↑/k · PgDn/PgUp · Home/End · ESC`）
4. **滚动行为**：scrollOffset state 由 Component 维护，纯函数 `computeScrollOffset(data, currentOffset, total, maxVisible)` 计算新 offset；vim 风格 j 下、k 上（G 大写跳底、g 小写跳顶）

overlay 配置：`anchor: "top-center"`, `width: "100%"`, `maxHeight: "85%"`, `margin: 1`。理由：
- top-center：modal 浮在 editor 上方，input + status bar 永远可见
- 100% 宽：与 terminal 等宽，布局稳定
- 85% 高：典型 terminal 30 行 × 85% = 25 行（够装完 heading + 20 行 body + hint + 边框）；剩余 15% 给底部 input + status bar
- margin 1：边框和 terminal 边缘留 1 行空隙

## 三个变体取舍（简略）

| 变体 | 形态 | 选 / 不选 | 理由 |
|---|---|---|---|
| **A. Top-center overlay + scroll** | overlay，anchor top-center，maxHeight 85% | **选** | 信息密度最高、不挡 input、heading 钉顶 + scroll 让长 plan 可完整呈现 |
| B. Center overlay，无 scroll | overlay，anchor center，maxHeight 60%，无滚动 | 不选 | 内容超过 60% 后无任何方式看完整 plan；用户要"看完整状态"的核心需求没满足 |
| C. Floating modal + scroll（备选） | overlay，anchor center，maxHeight 60% | 不选 | 居中浮窗让 chat history 也被挡；maxHeight 60% 比 A 矮；保留代码供将来切换 |

详细对比 + Pi TUI 约束分析见 25-dgoal-s-modal变体探索参考.md。

## 实施要点

1. **数据结构 `RenderLine[]`**：`{ type: "heading" | "spacer" | "phase" | "task", status?: PlanStatus, text: string }`。让 render 阶段根据 type + status 染色。
2. **滚动 offset 计算**：纯函数 `computeScrollOffset` 返回新 offset / "exit" / null，caller 赋值给 `this.scrollOffset`。**不能**在纯函数内修改新对象 `{ scrollOffset: this.scrollOffset }` —— 这是 v2 bug 根因（永远 0）。
3. **坐标轴统一**：handleInput 算 `totalLines` 用 `buildBodyLinesNoHeading(goal)`，render 用同一函数；之前 v2 用 buildBodyLines（33 行）和 buildBodyLinesNoHeading（31 行）混用是连带 bug。
4. **vim 翻页键约定**：`j` 下、`k` 上（不是反的）。`↑↓` 写在前只是说明两个键都支持。
5. **emoji + 颜色按 status**：

   | 层级 | completed | in_progress | pending | blocked |
   |---|---|---|---|---|
   | phase | ✅ green | 🔄 cyan+bold | ⬜ muted | 🚧 yellow |
   | task | ✓ dim | ◐ cyan+bold | ○ muted | ⚠ yellow |

## 副作用

- **无 Git 操作**（ADR 0001/0002 已约束）
- **无 dgoal_* 工具改动**（纯 UI 增强，status 字段不变）
- **i18n 软依赖**：emoji + 颜色文案走 theme；具体文案仍用 `t()`（如果 `pi-di18n` 在则本地化）
- **现有浮层不动**：`PlanOverlay` widget（`aboveEditor` placement）保留其"持续进度显示"职责；`/dgoal s` 是"按需详细查询"，职责正交

## 验证

- **行为**：走 `/dgoal s` 应弹 top-center overlay，j/k/↑↓/PgDn/PgUp/End/Home/ESC 工作正常
- **边界**：goal 30+ 行时 scroll 流畅；task 0 个的 phase 显示 phase 行无 task 子行；blocked phase 显示 `[blockedReason]` 后缀
- **性能**：每 Component 实例 ≤ 100 行；render 有缓存（`cachedWidth/cachedLines/cachedScrollOffset`）

## 后续

- 实施完成后，prototype 整个删除（throwaway）
- `index.ts:1051` 的 `showStatus` 重写，引入 `PlanStatusDialog` 类（~100 行 Component）
- 文档同步：`doc/10-架构与运行/13-启动闸门与TUI浮层.md` 加 `/dgoal s` 章节；`README.md` 的 Usage 段更新

## 决策记录

- 调研：`doc/20-能力参考/24-pi官方todo例子与pi-tui-design借鉴参考.md`（Pi 官方 `todo.ts` 形态 + pi-tui-design skill surface 选择规则）
- 探索过程：`doc/20-能力参考/25-dgoal-s-modal变体探索参考.md`（3 个变体的具体形态对比、Pi TUI 约束、v1→v2→v3 迭代 bug 复盘）
