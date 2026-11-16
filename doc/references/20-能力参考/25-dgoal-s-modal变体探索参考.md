# 25 - `/dgoal s` Modal 变体探索参考

> 探索 `/dgoal s`（`status` 命令）重新设计为 modal 的全过程。决策权威在 `doc/决策档案/0008-dgoal-s-modal-形态选型.md`，本文是研究过程 + 三个变体的具体取舍 + 迭代 bug 复盘。

## 1. 总体判断

**选定 Variant A**：top-center overlay + heading 钉顶 + scroll + 颜色 + emoji 标志。理由是同时满足信息密度、视图独立性、Pi TUI 约束三条；其余变体各有致命短板。

## 2. 三个变体形态

### 2.1 Variant A — Top-center overlay + scroll（选）

```
overlays: [
  { anchor: "top-center", width: "100%", maxHeight: "85%", margin: 1 },
]

╭────────────────── Dgoal Plan Status — Top overlay ──────────────────╮
 🎯 把仓库从「按日期组织的博客文件夹」重组为「以选题/作品为主线」 (2/8) ⏱️ 7m 3s
 ├─ ✅ 建目录骨架 + 统一 doc/... (green, completed)
 │    ✓ 建顶层 doc/ 目录与各子目录职责 (dim, completed)
 │    ✓ 写项目根 AGENTS.md（中文行为规范） (dim, completed)
 ├─ ✅ 搬迁：课程归位 + 历史与平台规范归档 (green, completed)
 │    ...
 ├─ 🔄 提取全局碎片到 fragments/... (cyan+bold, in_progress) ← 最显眼
 │    ✓ 扫描全仓库提取可复用碎片 (dim)
 │    ◐ 建立碎片索引与双向引用 (cyan+bold, in_progress)
 │    ○ 验证 0 个孤儿引用 (normal)
 ├─ 🚧 建检索层：Bases 视图 + Canvas 策展图 [等 Obsidian 重注册完成] (yellow)
 │    ...
 ├─ ⬜ 收尾：... (muted, pending)
 A · top overlay    lines 1-20 / 31    ↓/j · ↑/k · PgDn/PgUp · Home/End · ESC
╰─────────────────────────────────────────────────────────────────────────╯
```

**位置**：从 terminal 顶部 row 1 开始（marginTop=1），向下扩展 maxHeight=85%。terminal 30 行 × 85% = 25 行。

**输入栏可见性**：底部留 15% 给 input + status bar（约 5 行），input 永远可见。

**关键设计**：
- heading 钉顶（不被 scroll 滚走）
- body 用 RenderLine[] 结构，render 阶段按 status 染色
- 翻页 vim 风格：j 下、k 上（G 跳底、g 跳顶、PgDn/PgUp 跳 10）
- ESC 退出

### 2.2 Variant B — Center overlay，无 scroll（不选，v1 写过，v2 删）

```
overlays: [
  { anchor: "center", width: "70%", margin: 1 },
]

╭───────────────────────────╮
│ 🎯 ... 2/8 ⏱️ 7m 3s        │
│                          │
│ ✓ 建目录骨架...           │
│ ✓ 搬迁...                 │
│ ◐ 提取全局碎片...          │
│ ⚠ 建检索层...             │
│                          │
│ B · center overlay · ESC │
╰───────────────────────────╯
```

**致命短板**：
- **不显示 task 子行**——只显示 phase。如果 plan 有 30+ task，用户完全看不到任务细节。
- **不滚动**——内容超过 maxHeight 后看不到下面的 phase。
- 70% 宽太窄，长 phase subject 被截断严重。

→ 用户核心需求"看完整 plan 状态"未满足。v2 删除。

### 2.3 Variant C — Floating modal + scroll（备选）

```
overlays: [
  { anchor: "center", width: "100%", maxHeight: "60%", margin: 1 },
]

╭─────────────────────────────────────────────────────────────────────────╮
│ 🎯 ... (2/8) ⏱️ 7m 3s                                                   │
│ ├─ ✅ 建目录骨架... (completed)                                          │
│ ...                                                                      │
│ C · floating modal (备选)    lines 1-16 / 31    ↓/j · ↑/k · ESC          │
╰─────────────────────────────────────────────────────────────────────────╯
```

**形态**：和 A 类似（都是 overlay），区别在 anchor（center vs top-center）和 maxHeight（60% vs 85%）。

**为什么降级备选**：
- 居中浮窗让 chat history 上下都被挡，视野损失大
- maxHeight 60% 比 85% 矮，30 行 terminal 只有 18 行 modal 空间，scroll 频次更高
- 用户在 v2 迭代反馈"A 往上移动至少不遮 input"——top-center 在物理位置上更靠近 input 上方，符合直觉

**保留**：C 代码留作将来"需要居中浮窗"的备选场景（例如想看 plan 但不想动 chat history 视野时）。

## 3. Pi TUI 约束（决定 A 是 top-center 不是别的形态）

研究 Pi 源码（`@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-tui/dist/tui.js`）发现的硬约束：

### 3.1 widget 总共 10 行限制

```javascript
// tui.js:1421
static MAX_WIDGET_LINES = 10;

// tui.js:1366
const container = new Container();
for (const line of content.slice(0, InteractiveMode.MAX_WIDGET_LINES)) {
    container.addChild(new Text(line, 1, 0));
}
if (content.length > InteractiveMode.MAX_WIDGET_LINES) {
    container.addChild(new Text(theme.fg("muted", "... (widget truncated)"), 1, 0));
}
```

→ **`setWidget(string[])` 最多 10 行**。modal 想完整显示 30+ 行 plan 必须用 `ctx.ui.custom()`（A 形态）而非 widget（已废弃方案）。

### 3.2 overlay anchor 系统

`ctx.ui.custom(factory, { overlay: true, overlayOptions: {...} })` 支持 9 个 anchor：`center, top-left/top-center/top-right, left-center/right-center, bottom-left/bottom-center/bottom-right`。

实测 anchor 表现：
- `center` (default)：viewport 中央
- `top-center`：terminal 顶部（margin.top=0 + margin.top=1 留 1 行空）
- `bottom-center`：terminal 底部——**和 Pi input box 冲突**（v1 C 失败原因）
- `top-left/top-right/left-center/right-center/bottom-left/bottom-right`：靠边

→ `top-center` 是"不挡底部" + "不和 input 冲突"的唯一合适位置。

### 3.3 `width` 和 `maxHeight` 是百分比字符串

`width: "100%"` 自动算成 `Math.floor(terminalWidth * 100 / 100)`。百分比/数字/`minWidth`/`maxHeight` 都支持。详见 `parseSizeValue` (tui.js:45)。

### 3.4 setFocus 是 Component handleInput 的前提

`ctx.ui.custom()` 自动 `setFocus(component)`（overlay 路径 `showOverlay` 内部调，full-screen 路径 `interactive-mode.js:1838` 调）。**只要 Component 实现 Focusable 接口（`focused` 字段在）**，handleInput 就会被调到。

A 走 overlay 路径（v3 改后）；v1/v2 A 走 full-screen 路径。两条都 setFocus。

### 3.5 Component 渲染缓存模式

```typescript
class MyComponent implements Component, Focusable {
    focused = false;
    private cachedWidth?: number;
    private cachedLines?: string[];
    private cachedScrollOffset?: number;
    
    render(width: number): string[] {
        if (this.cachedLines && 
            this.cachedWidth === width && 
            this.cachedScrollOffset === this.scrollOffset) {
            return this.cachedLines;
        }
        // ... compute
        this.cachedWidth = width;
        this.cachedLines = lines;
        this.cachedScrollOffset = this.scrollOffset;
        return lines;
    }
    
    invalidate(): void {
        this.cachedWidth = undefined;
        this.cachedLines = undefined;
        // scrollOffset 变化时也要 invalidate
    }
}
```

Pi-tui 的渲染器每秒可能调 `render()` 数十次（elapsed 计时器触发重渲），缓存至关重要。

## 4. 迭代 bug 复盘（教训）

### 4.1 v1 → v2：A 没有翻页

v1 A 的 hint 行写 `↑↓ 翻页`，但 `handleInput` 实际是 no-op——翻页键按了没反应。

**根因**：原型 A 没实现 scroll offset 逻辑，只写了占位文字。507 反馈"翻页没用"。

**教训**：写 UI hint 前先把对应逻辑实现；hint 是文档，不是 TODO。

### 4.2 v2 第一次迭代：翻页 bug 真根因

v2 给 A 加了 `handleScrollKey` 函数：

```typescript
function handleScrollKey(data, state, totalLines, maxVisible): boolean {
    if (matchesKey(data, "down")) {
        state.scrollOffset = Math.min(state.scrollOffset + 1, maxOffset);  // ← bug
        return true;
    }
}
```

调用处：

```typescript
handleInput(data: string): void {
    if (handleScrollKey(data, { scrollOffset: this.scrollOffset }, body.length, this.maxVisible)) {
        this.invalidate();
    }
}
```

**bug**：`{ scrollOffset: this.scrollOffset }` 创建**新对象**，handleScrollKey 修改新对象的 scrollOffset，不影响 `this.scrollOffset`。**scrollOffset 永远是 0**。

**表面观察**：preview 里 `variantA(offset=5)` 看起来工作，因为 preview 直接传 offset 不走 handleInput。但真 Pi TUI 里 handleInput 必须自己维护 state。

**修复**：handleScrollKey 改为纯函数 `computeScrollOffset(data, currentOffset, total, maxVisible)` 返回新 offset，caller 赋值给 `this.scrollOffset`：

```typescript
handleInput(data: string): void {
    const result = computeScrollOffset(data, this.scrollOffset, body.length, this.maxVisible);
    if (result === "exit") {
        this.done();
        return;
    }
    if (result !== null && result !== this.scrollOffset) {
        this.scrollOffset = result;  // ← 直接赋值 this
        this.invalidate();
    }
}
```

**教训**：写"修改新对象"的代码时问一句：caller 的 state 在哪里？这个 bug 被 headless preview 隐藏了——preview 绕过了 handleInput。

### 4.3 v2 第二次迭代：A/C 坐标系错配

A/C handleInput 用 `buildBodyLines(mockGoal)` 算 totalLines（33 行，含 heading + 空行），但 render 用 `buildBodyLinesNoHeading(mockGoal)`（31 行）。坐标轴错配 2 行。

修了 4.2 后这个 bug 立刻显形：maxOffset 算错，scroll 到边界时 hint 数字超出预期。

**修复**：两边都改成 `buildBodyLinesNoHeading(mockGoal)`。

**教训**：handleInput 和 render 必须用同一坐标系（同一函数算 totalLines）。

### 4.4 C 宽度问题

v2 C 设了 `width: "90%"`，render 里又 `width * 0.9` = 实际 81%。

**修复**：`width: "100%"`（Pi 已经按 overlayOptions 算好 width 传给 render），render 直接用不要再乘。

**教训**：render 拿到的 `width` 是 Pi 算好的最终宽度，不要再自己乘比例。

### 4.5 A 的 full-screen 问题

v1/v2 A 走 `ctx.ui.custom(factory)`（不传 `overlay`）—— Pi 走 full-screen 路径，把 modal 替换 editorContainer 的内容。**input box 被遮**。

507 反馈"A 想往上移动至少不遮 input"。full-screen 物理上没法"往上移"——它就是 input 区。

**修复**：A 也走 overlay 路径，`overlay: true` + `overlayOptions: { anchor: "top-center", maxHeight: "85%" }`。

**教训**：full-screen takeover 适合"用户主动进入新视图"（比如 todo.ts 编辑 todo），不适合"按需查看辅助信息"——后者必须用 overlay。

## 5. 颜色 + emoji 设计决策

### 5.1 emoji 选型

**Phase 用 box-drawing-heavy emoji（✅🔄⬜🚧）**，task 用紧凑 ASCII（✓◐○⚠）：
- Phase 在外层，每行就是它自己的视觉锚点——emoji 大、醒目
- Task 在 phase 下，缩进紧、密集——ASCII 紧凑字符不抢 phase 视觉

### 5.2 颜色映射

```typescript
const color = 
    line.status === "in_progress" ? "accent"      // cyan, 最显眼
  : line.status === "completed"   ? (isPhase ? "success" : "dim")  // phase green, task dim
  : line.status === "blocked"     ? "warning"     // yellow
  : "muted";                                        // pending 灰
```

设计原则：
- **in_progress 最显眼**（cyan + bold）—— 这是用户当前应该关注的工作
- **completed phase 绿**——视觉完成感
- **completed task dim**——已完成不抢视线
- **blocked 黄**——警示但不刺眼
- **pending 灰**——待办，不强调

**颜色按 phase/task 区分**——phase 用 success（绿），task 用 dim（淡灰），避免完成态抢同一档颜色。

### 5.3 heading 单独强调

`🎯` emoji + accent 色 + bold——和 phase/task 视觉完全分开，让用户一眼定位"我在做什么"。

## 6. 决策链（为什么最终是 A）

507 反馈 → 原型迭代 → ADR：

| 轮次 | 反馈 | 改动 |
|---|---|---|
| v1 | "重新设计 `/dgoal s`，展示 goal + phase + task，文本流看不出状态" | 写 3 个变体（A/B/C），原 notify 改成 modal |
| v1 | "排除 BC，A 较合适" | v2 删 B |
| v2 | "A 没翻页、C 在 input 下方很奇怪" | v2 加 scroll offset + 改 C anchor |
| v2 | "翻页没用、C 不是满宽" | 修 handleScrollKey bug + C width 100% |
| v3 | "用 A 即可、C 降级备选、A 想往上移不遮 input" | A 改 top-center overlay（不是 full-screen）+ 颜色 + emoji |
| v3 | "高度再高一点" | maxHeight 70% → 85% |

## 7. 实施 checklist（吸收进 index.ts 时用）

- [ ] 把 `showStatus` (index.ts:1051) 替换为 `ctx.ui.custom(...)`
- [ ] 新增 `PlanStatusDialog` Component 类（~150 行）
  - [ ] `renderPlanLines(goal, { expandTasks: true })` 复用现有 renderPlanLines（在 index.ts:2566 行已写好）
  - [ ] 改造为 RenderLine[] 结构（type + status + text）
  - [ ] `colorize(line, theme)` 函数处理染色
  - [ ] `computeScrollOffset` 纯函数
  - [ ] Component handleInput + render + invalidate
- [ ] i18n：heading/phase/task 文案走 `t()`，emoji/颜色保留
- [ ] 测试：纯函数单元测试（renderPlanLines + computeScrollOffset + colorize）
- [ ] TUI smoke test：Pi TUI 里跑 `/dgoal s`，验证翻页键、ESC 退出、不挡 input
- [ ] 同步文档：`doc/10-架构与运行/13-启动闸门与TUI浮层.md` 加 `/dgoal s` 章节；`README.md` Usage 更新
- [ ] 删除 prototype 目录
