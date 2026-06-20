# 24 - Pi 官方 `todo.ts` 例子与 `pi-tui-design` skill 借鉴参考

> 调研对象：Pi 官方 `examples/extensions/todo.ts`（同名命令 `/todos`）+ 第三方 `pi-tui-design` skill（joelhooks）。借解决"dgoal `/dgoal s` 是否值得改造成 modal 弹窗、按哪个 surface 实现"这个问题。来源：node_modules 内置 examples + lobehub marketplace。

## 1. 总体判断

**值得吸收，且对当前问题（`/dgoal s` 重新设计）给出直接答案：选 `ctx.ui.custom()` Component 形态，参考 `todo.ts` 的 `TodoListComponent` 1:1 实现。**

调研结论和"加重负担"无关——`todo.ts` 这个例子**已经存在**于 Pi 官方 examples，**正是同一个问题域**（"用一个命令查看完整列表"），且实现只有 ~150 行 Component。dgoal 改造 `/dgoal s` 不是引入新模式，是补全和已有例子齐平的视图层级。

## 2. 核心机制速览

### 2.1 Pi 的 6 个 delivery surface（按交互重量选）

来自 `pi-tui-design` skill 的明确分类：

| Surface | API | 适用 |
|---|---|---|
| Full-screen takeover | `ctx.ui.custom(component)` | 复杂交互：dashboard、游戏、多步 wizard |
| Overlay | `ctx.ui.custom(factory, { overlay: true })` | 浮层：快速选择、确认、panel |
| Widget | `ctx.ui.setWidget(...)` | 持久显示：状态、进度、列表 |
| Status line | `ctx.ui.setStatus(...)` | 单行 indicator |
| Tool rendering | `renderCall`/`renderResult` | 工具调用自定义显示 |
| Footer | `ctx.ui.setFooter(...)` | 替换整个 footer |

**`/dgoal s` 场景（"按需看完整 plan dashboard"）→ 对应 Full-screen takeover**。

### 2.2 Component 契约

```typescript
interface Component {
    render(width: number): string[];   // 输出行，每行 ≤ width
    handleInput?(data: string): void; // 键盘输入
    wantsKeyRelease?: boolean;        // Kitty 协议 key release
    invalidate(): void;               // 清除渲染缓存
}

// 可选实现 Focusable（接收输入）
interface Focusable {
    focused: boolean;
}
```

`render(width)` 是核心——返回 string 数组就是它的全部行为。**不是滚动组件**，但**通过维护内部 state + 每次 render 计算不同偏移**就能实现滚动/翻页。

### 2.3 `todo.ts` 的最小完整实现

```typescript
class TodoListComponent {
    constructor(todos: Todo[], theme: Theme, onClose: () => void) {}

    handleInput(data: string): void {
        if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
            this.onClose();
        }
    }

    render(width: number): string[] {
        // ╭─ Todos ─────────────────╮
        //   3/5 completed
        //   ✓ #1 todo text
        //   ✓ #2 done thing
        //   ○ #3 pending
        //   Press Escape to close
        // ╰─────────────────────────╯
    }

    invalidate(): void { /* clear cache */ }
}

// 注册：
pi.registerCommand("todos", {
    description: "Show all todos on the current branch",
    handler: async (_args, ctx) => {
        await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
            return new TodoListComponent(todos, theme, () => done());
        });
    },
});
```

**关键观察**：没有 overlay:true → 这是 full-screen 模式（不是浮层）。可以直接看到完整 plan，不被遮挡。

### 2.4 标准 Dialog 模式（来自 pi-tui-design）

```typescript
class DialogComponent implements Component, Focusable {
    focused = false;
    render(width: number): string[] {
        const inner = Math.max(20, width - 2);
        return [
            `╭${"─".repeat(...)} Header ${"─".repeat(...)}╮`,
            `│ Content line                │`,
            `├${"─".repeat(inner)}┤`,
            `│ ↑↓ nav • ⏎ select • esc cancel │`,
            `╰${"─".repeat(inner)}╯`,
        ];
    }
    handleInput(data: string) {
        if (matchesKey(data, "escape")) this.done();
    }
}
```

### 2.5 设计原则（pi-tui-design）

- ✅ 总是用 theme tokens（`theme.fg("accent", ...)`），不硬编码 ANSI
- ✅ 总是 `truncateToWidth()`（每行 ≤ width）
- ✅ 总是 `matchesKey()`（不手解 escape sequence）
- ✅ 总是 `dispose()` 清理定时器（如果有）
- ✅ 总是底部 hint 行（用 `keyHint()`）让快捷键可发现

## 3. 与 dgoal 的关系

### 3.1 设计冲突（明确不借）

无。dgoal 已经在用 widget（浮层）+ setStatus（底栏）+ notify（通知），加 modal 是**补全视图层级**而非引入新模式。

唯一需要小心的边界：dgoal 的浮层（widget）已经在 `aboveEditor` 占着空间，新加的 modal 如果用 `overlay: true` 模式会浮在编辑器之上，**和浮层位置正交**，不冲突。

### 3.2 同思路（已有，印证方向）

| dgoal 已有 | 印证了 |
|---|---|
| `PlanOverlay` widget（`aboveEditor`） | "持久状态用 widget"——同 surface 哲学 |
| `setStatus(STATUS_KEY, formatStatus(goal))` | "持续 indicator 用 status line"——同 surface 哲学 |
| `i18n` 软依赖（`t()` 函数） | "用户可见文案本地化"——pi-tui-design 也强调 theme-aware |
| `renderPlanLines` 纯函数（已有完整三层渲染） | "渲染逻辑独立、可测"——pi-tui-design 的 Component 模式也强调 |
| `currentGoal` 全局单例 + 各种事件回调更新 | "state 从 events 聚合，Component 只读"——todo.ts 同模式 |

### 3.3 候选（值得吸收）

#### 候选 1：用 `ctx.ui.custom()` 做 `/dgoal s`

**如果吸收，改 `index.ts:1051` 的 `showStatus`** ——把 `ctx.ui.notify(...)` 换成 `ctx.ui.custom((tui, theme, kb, done) => new PlanStatusDialog(...))`。

新增文件：`PlanStatusDialog` 类（约 100-150 行 Component），包含：
- `render(width)`：复用 `renderPlanLines(currentGoal, {expandTasks: true})` 拼完整三层 + Dialog 边框 + 底部 hint
- `handleInput(data)`：ESC/ctrl+c/q 退出 → `done()`
- `invalidate()`：cache 清理（如果加滚动需要）
- `dispose()`：no-op（无定时器）

**改造点**：`doc/10-架构与运行/13-启动闸门与TUI浮层.md` 加一段"按 s 看完整 plan"；README 的 `Usage` 段更新 `s` 的描述。

#### 候选 2：用 `SelectList` 现成 Component 实现可滚动列表

pi-tui 提供 `SelectList`（带 filter/scroll），直接复用：

```typescript
import { SelectList } from "@mariozechner/pi-tui";

class PlanStatusList {
    private list = new SelectList({
        items: renderPlanLines(goal, {expandTasks: true}),
        maxVisible: 20,
        theme,
        onSelect: () => {},
        onCancel: () => this.done(),
    });
    handleInput(data: string) { this.list.handleInput(data); }
    render(width: number) { return this.list.render(width); }
}
```

**优势**：自动获得上下键滚动、过滤、选择行为。
**劣势**：SelectList 是"列表选择"语义，用于"显示 plan"语义略不贴；没有头部边框/底部 hint 自定义控制。

**改造点**：同候选 1，但实现量更小。

#### 候选 3：保持现状，强化 notify

不算严格"候选"——是 B 方案（用户已排除）。但记录一下原因：notify 不能交互，按任意键就消失，无法滚动/翻页，无法满足"看完整 plan"的核心需求。

## 4. 可借鉴的具体文件 / 代码 / 资源

### 4.1 必读

- **`examples/extensions/todo.ts`** — Pi 官方 1:1 对应实现。重点：`TodoListComponent` 类（42-110 行）、`registerCommand` handler（285-300 行）。
- **`examples/extensions/overlay-test.ts`** — `Focusable` 实现标准、dialog 边框绘制（17-26 行是 dialog 主体）。
- **`examples/extensions/doom-overlay/`** — 极端 case（35 FPS 游戏），证明 `ctx.ui.custom()` 能承载任何复杂度。

### 4.2 pi-tui-design skill 关键章节

- **Delivery Surfaces** — 选 surface 的判断依据
- **The Component Contract** — `render/handleInput/invalidate` 三件套
- **Dialog pattern** — 圆角边框 + 标题 + 内容 + hint 的标准形态
- **Fuzzy filter list** — 如果要加"按 phase/task 过滤"功能参考
- **Segment-based rendering** — 状态栏分段思路（如果想把 elapsed/iteration 也加进来）

### 4.3 pi-tui 现成 Component

| Component | 适用 |
|---|---|
| `Text` | 多行 word-wrapped |
| `Container` | 垂直 stack |
| `Spacer` | 空行 |
| `Box` | 带 padding + 背景 |
| `SelectList` | 列表（带 scroll/filter） |
| `Markdown` | 渲染 markdown |
| `DynamicBorder` | 宽度自适应边框 |

`PlanStatusDialog` 应该只用 `Container + Text + Spacer + theme.fg` 自己拼（参照 `todo.ts`），不引入更重的 `Box` / `SelectList`，保持简单。

## 5. 决策记录

不够格进 `doc/adr/`——这是"实现参考"不是"难逆转决策"。等 `/dgoal s` 实际重写时，决策会落成 ADR：
- 选 full-screen 还是 overlay？→ 决定 ADR
- 加滚动还是固定展开？→ 决定 ADR
- 是否复用 `renderPlanLines` 还是新写？→ 决定 ADR

## 6. 下一步建议

按 507 系列递进：

1. **`507-grill`** — 把候选 1 vs 候选 2 问透：到底选 `ctx.ui.custom()` 自己写 Component，还是复用 `SelectList`？full-screen 还是 overlay？
2. **`507-prototype`** — 写个最小可交互原型（`/dgoal s` 弹出 TodoList 风格 Component），让 507 在 TUI 里实际体验效果。
3. **`507-prd-issues`** — 确认方案后，拆成可独立验证的 issue（Component 渲染 / 滚动 / 退出 / 多 phase 边界 / 测试）。

不进 ADR 的理由：当前阶段是"选 surface"，不是"承诺架构"。一旦选定 Component 形态且写完，相关约束（如"full-screen 而非 overlay"）才进 ADR。
