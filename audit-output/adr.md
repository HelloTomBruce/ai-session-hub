# 架构与方案决策记录 (ADR Collection)
> 💡 *提示：当前使用本地启发式规则生成。*

### ADR-001: 1. 仓库维度：数据以哪个仓库为上下文？选项：A) 页面内仓库选择器（默认最近 push 的仓库）;...
- **状态 (Status)**: `Accepted`
- **来源会话 (Source)**: `PI` (Session: 01a0bd74-efae-7208-beeb-bf1fca2e01a2)
- **背景与痛点 (Context)**: 在 PI 会话 [接下来做 GitHub CLI 的详情页] 中遇到方案选型。
- **做出的决定 (Decision)**:
  > 1. 仓库维度：数据以哪个仓库为上下文？选项：A) 页面内仓库选择器（默认最近 push 的仓库）; B) 只显示"我相关的"跨仓库视图（gh pr status, gh run list --user?）; C) 固定一个仓库可配置。
- **影响与后果 (Consequences)**: 保障了功能落地，兼顾 PI 工作流规范与代码维护性。

---

### ADR-002: - 阶段2：CI 运行列表 + 重跑（需要仓库上下文 → 仓库选择器）
- **状态 (Status)**: `Accepted`
- **来源会话 (Source)**: `PI` (Session: 01a0bd74-efae-7208-beeb-bf1fca2e01a2)
- **背景与痛点 (Context)**: 在 PI 会话 [接下来做 GitHub CLI 的详情页] 中遇到方案选型。
- **做出的决定 (Decision)**:
  > - 阶段2：CI 运行列表 + 重跑（需要仓库上下文 → 仓库选择器）
- **影响与后果 (Consequences)**: 保障了功能落地，兼顾 PI 工作流规范与代码维护性。

---

### ADR-003: A) 以我为中心（gh status + gh pr status，跨仓库；CI 加仓库选择器）
- **状态 (Status)**: `Accepted`
- **来源会话 (Source)**: `PI` (Session: 01a0bd74-efae-7208-beeb-bf1fca2e01a2)
- **背景与痛点 (Context)**: 在 PI 会话 [接下来做 GitHub CLI 的详情页] 中遇到方案选型。
- **做出的决定 (Decision)**:
  > A) 以我为中心（gh status + gh pr status，跨仓库；CI 加仓库选择器）
- **影响与后果 (Consequences)**: 保障了功能落地，兼顾 PI 工作流规范与代码维护性。

---

### ADR-004: B) 仓库优先（顶部仓库选择器，PR/issue/CI/search 全部限定该仓库）
- **状态 (Status)**: `Accepted`
- **来源会话 (Source)**: `PI` (Session: 01a0bd74-efae-7208-beeb-bf1fca2e01a2)
- **背景与痛点 (Context)**: 在 PI 会话 [接下来做 GitHub CLI 的详情页] 中遇到方案选型。
- **做出的决定 (Decision)**:
  > B) 仓库优先（顶部仓库选择器，PR/issue/CI/search 全部限定该仓库）
- **影响与后果 (Consequences)**: 保障了功能落地，兼顾 PI 工作流规范与代码维护性。

---

### ADR-005: - `GET /api/tools/gh/repos` — 仓库选择器数据源（我最近操作的仓库列表）
- **状态 (Status)**: `Accepted`
- **来源会话 (Source)**: `PI` (Session: 01a0bd74-efae-7208-beeb-bf1fca2e01a2)
- **背景与痛点 (Context)**: 在 PI 会话 [接下来做 GitHub CLI 的详情页] 中遇到方案选型。
- **做出的决定 (Decision)**:
  > - `GET /api/tools/gh/repos` — 仓库选择器数据源（我最近操作的仓库列表）
- **影响与后果 (Consequences)**: 保障了功能落地，兼顾 PI 工作流规范与代码维护性。

---

### ADR-006: repos/route.ts      — GET 仓库选择器数据
- **状态 (Status)**: `Accepted`
- **来源会话 (Source)**: `PI` (Session: 01a0bd74-efae-7208-beeb-bf1fca2e01a2)
- **背景与痛点 (Context)**: 在 PI 会话 [接下来做 GitHub CLI 的详情页] 中遇到方案选型。
- **做出的决定 (Decision)**:
  > repos/route.ts      — GET 仓库选择器数据
- **影响与后果 (Consequences)**: 保障了功能落地，兼顾 PI 工作流规范与代码维护性。

---

### ADR-007: - 搜索：type 选择 + 输入，结果列表带跳转链接
- **状态 (Status)**: `Accepted`
- **来源会话 (Source)**: `PI` (Session: 01a0bd74-efae-7208-beeb-bf1fca2e01a2)
- **背景与痛点 (Context)**: 在 PI 会话 [接下来做 GitHub CLI 的详情页] 中遇到方案选型。
- **做出的决定 (Decision)**:
  > - 搜索：type 选择 + 输入，结果列表带跳转链接
- **影响与后果 (Consequences)**: 保障了功能落地，兼顾 PI 工作流规范与代码维护性。

---

### ADR-008: User chose subagent-driven development. Per writin...
- **状态 (Status)**: `Accepted`
- **来源会话 (Source)**: `PI` (Session: 01a0bd74-efae-7208-beeb-bf1fca2e01a2)
- **背景与痛点 (Context)**: 在 PI 会话 [接下来做 GitHub CLI 的详情页] 中遇到方案选型。
- **做出的决定 (Decision)**:
  > User chose subagent-driven development. Per writing-plans skill: "如果选择子代理驱动：必需子技能：使用 subagent-driven-development". I must read that skill file now and follow it.
- **影响与后果 (Consequences)**: 保障了功能落地，兼顾 PI 工作流规范与代码维护性。

