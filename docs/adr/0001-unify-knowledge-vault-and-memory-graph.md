# ADR 0001: 统一知识沉淀存储 —— 以 Grafeo 记忆图谱为单一事实源，知识金库降级退役

## Status

Accepted

## Date

2026-09-20

## Related

- Multica issue TOMB-11
- `docs/design-v2.md` Phase 2（知识图谱章节）
- 引入 Grafeo 的提交：`3eb45b4 feat(memory): 基于 Grafeo 嵌入式图数据库实现会话记忆模块与 MCP 智能召回`

## Context

session-hub 目前存在两套职责重叠的知识沉淀体系：

| 维度 | 知识金库 (`knowledge-service.ts`) | 记忆模块 (`memory-service.ts` + Grafeo) |
|------|----------------------------------|------------------------------------------|
| 存储 | SQLite `knowledge_vault` 平表 | Grafeo 嵌入式图库（`~/.session-hub/memory.grafeo`） |
| 数据形态 | 结构化 ADR 记录（context / decision / consequence / score / grade） | Memory 节点 + Project / TechConcept / Problem / PatternSnippet 实体与关系边 |
| 类型体系 | `ValueCategory`：ADR / Gotcha / Pattern / Milestone / Trivial（封闭枚举） | `PresetMemoryType`：ADR / Gotcha / BestPractice / Pattern / Workflow / Config / Security / Performance / ApiSpec（开放可扩展） |
| 写入路径 | 量化评估自动沉淀（`autoHarvestFromEvaluation`）、REST POST、MCP `distill_knowledge` | LLM 会话记忆抽取（`memory-extractor.ts`）、REST POST、MCP `save_memory` |
| 召回入口 | REST `/api/knowledge/*`、MCP `search_knowledge_vault`、Markdown 导出 | REST `/api/memory/*`、MCP `recall_memories` / `search_memory_graph`、图谱可视化 |
| 关系能力 | 无 | SUPERSEDES 演进链、APPLIES_TO、RELATES_TO、SOLVES、PRODUCES |
| 前端页面 | `app/pages/knowledge.vue` | `app/pages/memory.vue` |

具体问题：

1. **同一概念两处存储**：蒸馏产出的 ADR / Gotcha / Pattern 既可能进 `knowledge_vault` 也可能进 Grafeo，无去重机制，内容会逐渐分叉。
2. **写入路径分叉**：评估管线（自动）与记忆抽取管线（自动）各自独立写库；MCP 有 `distill_knowledge` 与 `save_memory` 两个写入工具，调用方（Agent）无法判断该用哪个。
3. **召回入口分叉**：MCP 同时暴露 `search_knowledge_vault` 与 `recall_memories`，召回结果不完整（各查各的库）。
4. **架构偏离未评审**：`design-v2.md` Phase 2 规划的是「SQLite 关系模拟图谱」（`graph_entities` / `graph_edges` 表，见 §5.1.2、§7.4），实现却引入了 Grafeo 图数据库，设计文档未同步，选型未经评审。

## Decision

采用**分层统一**方案：**Grafeo 记忆图谱作为唯一的知识存储（Single Source of Truth），SQLite 知识金库降级为评估质量门并退役**。

### 1. 存储分层

```
┌─ 质量门层（SQLite，保留）─────────────────────────┐
│  session_evaluations  —— 会话量化评估报告            │
│  （评分/评级/是否值得沉淀，是诊断产物，不是知识实体）    │
└──────────────────┬───────────────────────────────┘
                   │ isWorthSaving = true
                   ▼
┌─ 知识存储层（Grafeo，唯一 SoT）────────────────────┐
│  Memory 节点 + Project / TechConcept /            │
│  Problem / PatternSnippet 实体 + 关系边            │
└──────────────────┬───────────────────────────────┘
                   ▼
        召回 / 可视化 / 导出（视图层）
```

- 所有蒸馏、评估沉淀、LLM 记忆抽取、手动记录产出的**知识实体**统一写入 Grafeo 记忆图谱。
- `session_evaluations` 表保留：它记录的是「会话效能评分」这一诊断产物，作为写入知识层的质量门，本身不是知识实体，不属于重叠范围。

### 2. 写入路径统一

- `autoHarvestFromEvaluation` 改为调用 `memoryService.saveMemory`（评分与评级存入 `sourceMeta`）。
- MCP 写入只保留 `save_memory`；`distill_knowledge` 标记 deprecated，内部代理到 `memoryService`，一个版本周期后删除。
- REST `POST /api/knowledge` 同样代理到 `memoryService` 并标记 deprecated。

### 3. 召回入口统一

- MCP 召回以 `recall_memories` 为唯一入口（支持 query / cwd / tech / type 过滤与图谱拓扑）。
- `search_knowledge_vault` 标记 deprecated，内部代理到 `memoryService.listMemories`，一个版本周期后删除。

### 4. 实体去重策略

- 写入前按 `(type, 规范化 title)`（小写、去空白）查询已有 Memory 节点：
  - 命中且内容实质相同 → 更新原节点（刷新 `updatedAt`、补充实体关联）。
  - 命中但内容演进 → 新建节点并建立 `SUPERSEDES` 边（复用已有机制）。
- 存量 `knowledge_vault` 数据通过一次性迁移脚本转换为 Memory 节点（`context` / `decision` / `consequences` 拼接为 `content`，`score` / `grade` 存入 `sourceMeta`，原 `id` 存入 `sourceMeta.legacyId` 以便回溯）。

### 5. 类型体系统一

- 以开放可扩展的 `PresetMemoryType` 为准。
- `ValueCategory` 的 `Milestone` 映射为自定义类型 `'Milestone'`；`Trivial` 不沉淀（评估门已拦截）。
- `score` / `grade` 不再是知识实体的一等字段，降级为 `sourceMeta` 中的评估溯源信息；知识实体的质量信号统一用 `confidence` + SUPERSEDES 演进链表达。

### 6. 知识金库退役

- 立即停止 `knowledge_vault` 新写入；REST 导出 Markdown 能力（`formatItemToMarkdown` / `exportMarkdown`）迁移到 memory 层。
- 迁移完成并经过一个版本周期验证后，删除 `knowledge_vault` 表、`knowledge-service.ts`、`/api/knowledge/*` 路由与 `app/pages/knowledge.vue`（前端入口并入 `memory.vue`）。

### 7. 追认 Grafeo 选型并同步设计文档

- 正式追认 Grafeo（`@grafeo-db/js`）为图存储选型，替代 `design-v2.md` 中的「SQLite 关系模拟图谱」方案，理由见下文备选方案分析。
- 同步更新 `design-v2.md` 的 §5.1（知识图谱存储模型）、§7.2（架构演进图）、§7.4（技术选型表）、§8（数据模型表）。

## Alternatives Considered

### A. 保留双库、明确分工（金库 = 结构化评估报告，图谱 = 关系召回）

- Pros：零迁移成本，两套系统都不动。
- Cons：ADR / Gotcha / Pattern 仍是同一概念两处存储，去重问题无解；MCP 仍需两个召回入口或跨库聚合；前端两个页面长期并存。分工边界按「报告 vs 关系」划分，但用户心智模型是「知识 vs 会话」，边界违反直觉。
- Rejected：只掩盖了重叠，没有消除重叠。

### B. 合并回 SQLite 关系模拟图谱（design-v2 原案）

- Pros：回归设计文档，单一 SQLite 依赖，运维心智最低。
- Cons：需要废弃已完整实现的 Grafeo 层（658 行 service + MCP 三个工具 + 图谱可视化页面 + LLM 抽取管线），重写等价的实体/关系能力；`graph_entities` 平表模型对 SUPERSEDES 演进链、多度关联查询的表达力弱于原生图模型；SQLite 方案的优势是「零额外依赖」，但 Grafeo 同为嵌入式、零外部服务，该优势不成立。
- Rejected：回溯成本高于收敛成本，且图表达能力更弱。

### C. 合并到 Grafeo，金库退役（选定）

- Pros：唯一 SoT，写入/召回入口各一；保留已实现的图谱关系与可视化能力；迁移工作量集中在「存量数据转换 + 写入路径改道」，可控；类型体系更开放，匹配 LLM 抽取的可扩展分类。
- Cons：引入对 `@grafeo-db/js`（含原生绑定）的长期依赖；`score` / `grade` 结构化字段降级为 metadata 后，按分数排序需在应用层完成；需要一次数据迁移与一个版本周期的双读兼容。

## Consequences

### 正面

- 知识实体单一存储，去重与演进（SUPERSEDES）有落点。
- MCP 契约收敛为「写 `save_memory`、读 `recall_memories` / `search_memory_graph`」，Agent 调用方心智简单。
- 设计文档与实现恢复一致，后续评审以 ADR 为准绳。

### 代价与风险

- Grafeo 原生绑定的部署/打包需验证（Nuxt Nitro externals 配置已在 Gotcha 类记忆中记录过同类问题）。
- 迁移脚本必须幂等（`legacyId` 去重），失败可重跑。
- deprecated 的 MCP 工具与 REST 路由需保留一个版本周期，期间行为为「代理 + 警告字段」，避免破坏既有集成。

### 后续代码收敛子任务

1. 迁移脚本：`knowledge_vault` → Memory 节点（幂等，`legacyId` 溯源）。
2. `autoHarvestFromEvaluation` 写入路径切换至 `memoryService.saveMemory`。
3. Markdown 导出能力迁移到 memory 层（`GET /api/knowledge/export` → `/api/memory/export`）。
4. MCP 收敛：`distill_knowledge` / `search_knowledge_vault` 标记 deprecated 并代理；REST `/api/knowledge/*` 同步代理。
5. `saveMemory` 增加规范化 title 查重 + 自动 SUPERSEDES 逻辑。
6. 前端 `knowledge.vue` 与 `memory.vue` 页面整合。
7. 一个版本周期后删除 `knowledge_vault` 表、`knowledge-service.ts` 及 deprecated 路由/工具。
