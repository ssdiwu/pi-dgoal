# ADR 0004：状态机扩展——rejected + 两种 paused

## 背景

终审不过时，原 `loop_complete` 的处理是隐式软重回：返回审报告 + 靠 prompt 引导 agent 继续修再重调。这没有状态机硬约束，agent 理论可绕（无视报告又调，或干脆不调）。

## 决策

### 新增 `rejected` 状态

终审不过 → goal 进 `rejected`（active 的回环子态）→ 每轮续跑 prompt 强制带"上次终审未过，问题：X"→ agent 必须修完才能再调 `dgoal_done`。`rejected` 让重回从软约束升级成状态机硬约束，agent 无法假装没看见。TUI 浮层显示 ⚠。

### 3 次终审不过进 paused

`rejected` 计数到 3 → 进 `paused`（reason=`audit_failed_3x`）。paused 不自动续跑（现有代码只在 active 续跑），不烧 token。用户可 resume 或搁置。

### 两种 paused 语义分离 + pauseReason 字段

`LoopGoal` 加 `pauseReason?: "user_abort" | "model_error" | "audit_error" | "audit_failed_3x" | "no_progress"`。resume 时按 reason 决定清不清零 rejected 计数：

- 异常中断（user_abort / model_error / audit_error / no_progress）：resume **不清零**（瞬时故障或空转保护，重试合理，本就无 rejected 计数概念）。
- 能力到顶（audit_failed_3x）：resume **清零** rejected 计数（用户主动再给 agent 一次机会）。

### 状态机全图

```
pending ──→ active ──→ done          (正常路径)
              │  ↑
              ↓  │ rejected         (终审不过，硬约束重回，prompt 钉问题)
              │  │  ×3终审不过
              ↓  ↓
            paused (audit_failed_3x) ──resume清零──→ active
            paused (user_abort/model_error/audit_error/no_progress) ──resume不清零──→ active
```

## 为什么

**rejected**：把"终审不过的重回"显式化，呼应全程"可控、不靠 prompt 拍脑袋"的诉求。

**3 次进 paused 而非直接清退出**：3 次终审不过本质是 agent 能力到顶，但直接清退出会让用户丢失 goal 上下文。进 paused（不烧 token）给用户选择权：resume 清零重试，或搁置。两种 paused 用 reason 分开 resume 语义，避免"同状态不同恢复行为"的混乱。

## 权衡

**rejected 备选是隐式软重回**（现状）：简单但靠 agent 自觉，可绕。rejected 增加一个状态 + 续跑 prompt 分支，但硬约束值得。

**3 次处理备选是直接清退出（清 goal）**：不烧 token 且决绝，但用户丢上下文。进 paused + reason 兼顾"不烧 token"和"用户可介入重试"。

**两种 paused 备选是用 rejected 状态承担终态**：让 rejected 同时承担"单次不过回环"和"3 次不过终态"两种语义，状态机变复杂。用 paused + reason 承担终态，rejected 永远只是单次回环态，职责清晰。

## 代价

`LoopGoal` 加 `pauseReason` 字段 + rejected 计数 + resume 逻辑分支。但这是把现有散落的 pause 原因结构化，顺便补技术债。
