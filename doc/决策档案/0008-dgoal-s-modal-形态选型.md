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

## 追加决策：anchor 从 top-center 切 center（v0.5+）

实际使用后用户反馈 top-center 视觉上“挂”在顶部不够聚焦。复评后切到 **center**（原 Variant C 形态），理由：
- `/dgoal s` 是按需查询弹窗，用户主动唤起、查完即关，挡 chat history 的时间窗口短；用户此刻注意力在“看 plan 状态”上，不在读历史，当初否决 center 的核心理由偏弱。
- maxHeight 85% + scroll 已解决“内容看不全”（当初否决 C 的第二条理由已不成立）。
- 短 plan 在 top-center 下突兀，center 更稳。

overlay 配置改为 `anchor: "center"`（其余 `width: "100%"` / `maxHeight: "85%"` / `margin: 1` 不变）。不推翻本 ADR 的形态选型，是激活原备选 Variant C。

## 追加决策：列表/详情两层状态机（ADR 0042）

ADR 0042 在保留 center overlay 形态的基础上，把原单页滚动 body 升级为两层状态机：

- 列表页展示完整 goal description，并按逻辑 phase/task 选择；`↑/↓`、`j/k` 与 `g/G` 改变选择，窗口跟随。
- `PgDn/PgUp`、`Ctrl+D/Ctrl+U` 与 `Home/End` 只滚动物理行，不改变选择，使长 description 可完整浏览。
- `Enter` 进入所选项详情；详情独立滚动，`Esc` 返回并保留列表选择，`Ctrl+C` 直接关闭。

本追加决策覆盖下文“单页 body + offset hint”的交互细节；原型取舍和 `computeScrollOffset` 的纯函数约束保留为历史依据。

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

- **行为**：走 `/dgoal s` 应弹 center overlay；列表逻辑选择、物理行翻页、Enter 详情、Esc 返回/关闭与 Ctrl+C 关闭均正常。
- **边界**：超长 goal description 可从头浏览到尾；task 0 个的 phase 仍可查看；blocked phase/task 的详情展示 blocked reason；极窄宽度不输出超宽行。
- **性能**：render 按 width、elapsed second 与审核活性快照缓存；列表/详情换行结果按当前 width 复用。

## 后续

- 实施完成后，prototype 整个删除（throwaway）
- `index.ts:1051` 的 `showStatus` 重写，引入 `PlanStatusDialog` 类（~100 行 Component）
- 文档同步：`doc/10-架构与运行/13-启动闸门与TUI浮层.md` 加 `/dgoal s` 章节；`README.md` 的 Usage 段更新

## 决策记录

- 调研：`doc/20-能力参考/24-pi官方todo例子与pi-tui-design借鉴参考.md`（Pi 官方 `todo.ts` 形态 + pi-tui-design skill surface 选择规则）
- 探索过程：`doc/20-能力参考/25-dgoal-s-modal变体探索参考.md`（3 个变体的具体形态对比、Pi TUI 约束、v1→v2→v3 迭代 bug 复盘）
