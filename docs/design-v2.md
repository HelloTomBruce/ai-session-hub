# AI Session Hub v2 — 产品设计文档

> 版本：v0.2 · 最后更新：2026-09-11
>
> 本文档定义 AI Session Hub 从"会话聚合浏览器"演进为"AI 编码知识资产沉淀平台"的设计蓝图。

---

## 目录

1. [产品愿景](#1-产品愿景)
2. [现状分析](#2-现状分析)
3. [迭代路线图](#3-迭代路线图)
4. [Phase 1：基础体验升级](#4-phase-1-基础体验升级)
5. [Phase 2：AI 深度化](#5-phase-2-ai-深度化)
6. [Phase 3：平台化与协作](#6-phase-3-平台化与协作)
7. [技术架构演进](#7-技术架构演进)
8. [数据模型设计](#8-数据模型设计)
9. [API 设计](#9-api-设计)
10. [UI/UX 设计原则](#10-uiux-设计原则)
11. [里程碑与交付标准](#11-里程碑与交付标准)
12. [附录](#12-附录)

---

## 1. 产品愿景

### 1.1 一句话定位

> **把散落在多个 AI 工具中的碎片化编码经验，沉淀为可搜索、可关联、可复盘、可传承的工程知识资产。**

### 1.2 用户角色

| 角色 | 核心需求 | 使用场景 |
|------|---------|---------|
| **个人开发者 (P)** | 快速找回历史上下文，复盘个人工作 | 每日回顾、查 bug 方案、续接工作 |
| **Tech Lead (TL)** | 了解团队 AI 编码投入与质量 | 周报、Code Review 辅助、了解团队技术决策 |
| **团队 (T)** | 共享知识资产，减少重复踩坑 | ADR 共享、模式复用、新人 Onboarding |

### 1.3 产品原则

1. **本地优先** — 数据不离机，云端同步为可选增值
2. **渐进增强** — 核心功能离线可用，AI 特性按需接入
3. **协议开放** — MCP 接口始终可用，不锁平台
4. **可复盘** — 每个决策可追溯、可解释、可复用

---

## 2. 现状分析

### 2.1 当前能力

```
┌─ 数据层 ──────────────────────────────────────┐
│  11 个 Adapter（Pi, OpenCode, AGY, Claude,     │
│  Codex, WorkBuddy, Reasonix, Kimi, Trae,       │
│  Cursor, Mimo）                                 │
└───────────────────────────────────────────────┘
                       ↓
┌─ 服务层 ──────────────────────────────────────┐
│  会话 CRUD · 诊断 · 蒸馏 · 技能管理 · MCP 管理  │
└───────────────────────────────────────────────┘
                       ↓
┌─ 接口层 ──────────────────────────────────────┐
│  REST API (30+) · MCP SSE Server (3 tools)    │
└───────────────────────────────────────────────┘
                       ↓
┌─ 前端 ────────────────────────────────────────┐
│  会话清单 · 详情 · 诊断 · 蒸馏 · MCP 管理 · 技能 │
└───────────────────────────────────────────────┘
```

### 2.2 核心短板

| 短板 | 影响 | 根因 |
|------|------|------|
| **搜索只能搜标题/路径** | 无法在对话内容中检索 | 无内容索引 |
| **蒸馏需手动选会话** | 遗忘率 > 90%，很少有人手动点 | 无定时/自动触发 |
| **报告是扁平文本** | ADR 只能读不能查、不能关联 | 无持久化 + 无实体索引 |
| **无趋势/统计视图** | 说不清"这周 AI 帮我干了什么" | 无聚合计算 |
| **纯本地单机** | 团队无法复用知识 | 无共享机制 |

---

## 3. 迭代路线图

```
                    ┌─────────────────────────────┐
                    │        Phase 1               │
                    │  基础体验升级 (1-2 月)        │
                    │  ┌───┐ ┌───┐ ┌───┐ ┌───┐    │
                    │  │FTS│ │标  │ │批  │ │快  │    │
                    │  │全  │ │签  │ │量  │ │照  │    │
                    │  │文  │ │系  │ │操  │ │缓  │    │
                    │  │搜  │ │统  │ │作  │ │存  │    │
                    │  │索  │ │    │ │    │ │    │    │
                    │  └───┘ └───┘ └───┘ └───┘    │
                    └──────────────┬──────────────┘
                                   ↓
                    ┌─────────────────────────────┐
                    │        Phase 2               │
                    │  AI 深度化 (3-6 月)           │
                    │  ┌───┐ ┌───┐ ┌───┐ ┌───┐    │
                    │  │图  │ │定  │ │代  │ │模  │    │
                    │  │谱  │ │时  │ │码  │ │式  │    │
                    │  │知  │ │复  │ │证  │ │挖  │    │
                    │  │识  │ │盘  │ │据  │ │掘  │    │
                    │  │库  │ │    │ │链  │ │    │    │
                    │  └───┘ └───┘ └───┘ └───┘    │
                    └──────────────┬──────────────┘
                                   ↓
                    ┌─────────────────────────────┐
                    │        Phase 3               │
                    │  平台化与协作 (6-12 月)       │
                    │  ┌───┐ ┌───┐ ┌───┐ ┌───┐    │
                    │  │MCP│ │团  │ │云  │ │BI  │    │
                    │  │写  │ │队  │ │端  │ │仪  │    │
                    │  │入  │ │共  │ │同  │ │表  │    │
                    │  │    │ │享  │ │步  │ │盘  │    │
                    │  └───┘ └───┘ └───┘ └───┘    │
                    └─────────────────────────────┘
```

---

## 4. Phase 1：基础体验升级

### 4.1 全文语义搜索 (FTS5 + 可选向量)

#### 4.1.1 设计目标

当前：`搜索 → 字符串匹配 title/cwd/id`
Phase 1：`搜索 → FTS5 全文匹配 + 可选向量语义匹配`

#### 4.1.2 架构设计

```
                    ┌─ 增量索引 ─────────────────┐
各平台原始数据 → Adapter 解析 → 统一 Schema
                                   ↓
                    ┌─ 本地缓存层 ────────────────┐
                    │  SQLite (session-hub.db)    │
                    │  ├─ sessions_cache          │
                    │  ├─ messages_cache           │
                    │  └─ fts_messages (FTS5)      │
                    └─────────────────────────────┘
                                   ↓
                    搜索请求 → FTS5 MATCH
                           + 可选 rerank
```

#### 4.1.3 数据模型

```sql
-- 缓存表
CREATE TABLE sessions_cache (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  cwd TEXT NOT NULL DEFAULT '',
  message_count INTEGER DEFAULT 0,
  model TEXT,
  cost REAL,
  status TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  raw_location TEXT,
  tags TEXT DEFAULT '[]',
  summary TEXT DEFAULT '',
  ai_diagnosed INTEGER DEFAULT 0,
  distilled INTEGER DEFAULT 0,
  data_hash TEXT
);

CREATE TABLE messages_cache (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  thought TEXT DEFAULT '',
  tool_calls_json TEXT DEFAULT '[]',
  timestamp INTEGER,
  FOREIGN KEY (session_id) REFERENCES sessions_cache(id)
);

-- FTS5 虚拟表
CREATE VIRTUAL TABLE fts_messages USING fts5(
  content,
  session_id UNINDEXED,
  platform UNINDEXED,
  title UNINDEXED,
  role UNINDEXED,
  tokenize='unicode61'
);
```

#### 4.1.4 搜索 API

```
GET /api/search?q=<query>&platform=<filter>&tags=<filter>&limit=20

Response:
{
  "success": true,
  "query": "登录 bug",
  "total": 42,
  "results": [
    {
      "session_id": "abc123",
      "platform": "pi",
      "title": "修复登录页白屏问题",
      "snippet": "...修复 <mark>登录</mark> 页的 ...",
      "role": "assistant",
      "score": 8.7,
      "updated_at": 1725000000000
    }
  ]
}
```

#### 4.1.5 增量同步策略

```
每次请求 / 定时 5 分钟：

1. 遍历每个 Adapter，对比 data_hash
2. 有变动 → 增量更新 sessions_cache / messages_cache
3. 重建 fts_messages（增量 or 全量）
4. 用事务包裹保证一致性

data_hash = sha256(jsonl_content OR sqlite_row_hash)
```

### 4.2 标签系统

#### 4.2.1 标签元数据

```typescript
interface SessionTag {
  name: string
  color: string
  category?: 'auto' | 'manual' | 'ai'
  created_at: number
}
```

#### 4.2.2 自动标签规则

```
规则引擎（可配置）：
  - 含 "fix"/"bug"/"error"/"报错"    → 自动标注 #bugfix
  - 含 "refactor"/"重构"              → 自动标注 #refactor
  - 含 "deploy"/"发布"/"上线"         → 自动标注 #deploy
  - 含 "upgrade"/"升级"/"migrate"     → 自动标注 #migration
  - 含 "doc"/"docs"/"文档"           → 自动标注 #documentation
  - AI 蒸馏报告中出现频次 > 2         → 自动建议标签
```

### 4.3 批量操作

| 操作 | 实现方式 |
|------|---------|
| 批量删除 | `POST /api/sessions/batch-delete` |
| 批量导出 | `POST /api/sessions/batch-export` |
| 批量标签 | `POST /api/sessions/batch-tag` |
| 批量蒸馏 | 蒸馏页面拖选多会话 → 一键运行 |

### 4.4 本地缓存层

```
~/.session-hub/
├── session-hub.db          -- 主数据
├── tags.json               -- 标签定义
├── llm-provider.json       -- LLM 配置（已有）
├── distill-cache/          -- 蒸馏结果缓存
└── diagnoses/              -- 诊断结果缓存
```

---

## 5. Phase 2：AI 深度化

### 5.1 知识图谱

#### 5.1.1 实体提取管线

```
蒸馏管线输出的每个 Action/Decision → LLM 实体提取
                                      ↓
                         函数名 / 模块 / 框架 / API / 错误 / 模式
                                      ↓
                         图存储 (SQLite 关系模拟)
```

#### 5.1.2 图存储模型

```sql
CREATE TABLE graph_entities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,              -- function|module|framework|api|error|pattern|tool
  aliases TEXT DEFAULT '[]',
  first_seen INTEGER,
  last_seen INTEGER,
  session_count INTEGER DEFAULT 1
);

CREATE TABLE graph_edges (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  relation TEXT NOT NULL,          -- calls|extends|fixes|discusses|depends_on
  weight INTEGER DEFAULT 1,
  last_seen INTEGER
);

CREATE TABLE graph_session_refs (
  entity_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  relevance REAL DEFAULT 1.0,
  PRIMARY KEY (entity_id, session_id)
);
```

#### 5.1.3 前端交互

```
实体搜索框：输入 "useFetch" ↓

┌─ 实体详情面板 ─────────────────────────────────┐
│  useFetch (函数)                                  │
│  ● 关联会话 (3)                                    │
│    ├─ [Pi] 修复 useFetch 缓存 bug                  │
│    ├─ [Codex] Nuxt 4 升级中的 useFetch 行为变化     │
│    └─ [Kimi] SSG 模式下 useFetch 不触发             │
│  ● 关联模块: @nuxt/ui                              │
│  ● 关联错误: 500 Internal /api/users?ssr=true       │
└──────────────────────────────────────────────────┘
```

### 5.2 定时复盘报告

#### 5.2.1 架构

```
定时触发 (cron: 每日 23:00 + 每周日 22:00)
       ↓
增量蒸馏管线 (只处理 new/distilled=0 的会话)
       ↓
报告持久化 → 前端通知栏 + Markdown 下载
```

#### 5.2.2 周报格式

```markdown
# AI 编码周报 — 2026-W37

## 📊 本周概览
- 活跃平台：Pi CLI (12次) · Codex (5次) · Claude (3次)
- 涉及项目：session-hub, dataease-web
- 总消息数：1,247 条

## 🛠 完成工作主线
1. **会话聚合层扩展** — 新增 Kimi/Trae/Cursor/Mimo 适配器

## 🧠 关键架构决策
- ADR-003: 使用 BaseSqliteAdapter 模式统一 SQLite 适配器

## 💡 踩坑记录
- SQLite fileMustExist: true 下 isAvailable() 需先判断文件存在

## 📋 待办
- [ ] 全局历史会话的增量缓存和 FTS 索引
```

### 5.3 代码变更证据链

```
Adapter → Tool Call 提取 edit_file/write_file/run_command
       ↓
提取文件路径 + 修改内容
       ↓
关联 git diff（匹配会话时间窗口内的 commit）
       ↓
会话详情中展示代码级变更
```

### 5.4 模式挖掘

| 维度 | 指标 | 洞察 |
|------|------|------|
| 工具调用序列 | 高频工具组合 | "你总爱先搜索再改代码" |
| 决策速度 | first tool → done 步数 | 效率趋势 |
| 回溯率 | revert 频次 | AI 准确度指标 |

---

## 6. Phase 3：平台化与协作

### 6.1 MCP 写入能力

扩展 MCP 工具：
| 工具 | 说明 |
|------|------|
| `tag_session` | 给会话打标签 |
| `add_summary` | 添加 AI 摘要 |
| `link_adr` | 链接到 ADR |
| `share_session` | 标记为可共享 |

### 6.2 团队共享空间

```
Option A: 本地 + File Share (轻量)
  共享 reports/ 目录到 NAS / Git

Option B: 中心 Server (重量)
  PostgreSQL 后端 + 多用户认证 + WebSocket
```

### 6.3 BI 仪表盘

面向 Tech Lead：活跃度、平台分布、质量指标回溯、成员排名

---

## 7. 技术架构演进

### 7.1 v0.1 → v0.2 (Phase 1)

```
Adapters → 内存 → REST API → Vue SPA
       ↓
Adapters → 缓存层 (SQLite + FTS5) → REST API → Vue SPA
                ↓
           MCP SSE Server
```

### 7.2 v0.3 (Phase 2)

```
Adapters → 缓存层 → REST → SPA
                ↓              ↓
            知识图谱      定时蒸馏管线
                              ↓
                          ADR + 报告持久化
                              ↓
                          MCP SSE Server
```

### 7.3 v1.0 (Phase 3)

```
┌─ Client Locals ──┐     ┌─ Sharing Server (可选) ─┐
│  Adapter → 缓存   │ ← → │  API Gateway            │
│  MCP Client       │     │  DB (PG)                │
│  Local Graph      │     │  Auth + WebSocket       │
└───────────────────┘     └─────────────────────────┘
```

### 7.4 关键技术选型

| 组件 | 选型 | 理由 |
|------|------|------|
| 全文搜索 | SQLite FTS5 | 零依赖，内建 |
| 图存储 | SQLite 关系模拟 | < 10 万节点，足够 |
| 定时任务 | node-cron | 轻量，无外部依赖 |

---

## 8. 数据模型设计

完整 Schema 见源码，核心表：

| 表 | 用途 | Phase |
|-----|------|-------|
| `sessions_cache` | 统一会话缓存 | 1 |
| `messages_cache` | 消息缓存 | 1 |
| `fts_messages` | FTS5 全文索引 | 1 |
| `graph_entities` | 图谱实体 | 2 |
| `graph_edges` | 实体关系 | 2 |
| `graph_session_refs` | 实体-会话关联 | 2 |
| `adr_records` | ADR 持久化 | 2 |
| `reports` | 复盘报告 | 2 |
| `tag_defs` | 标签定义 | 1 |

---

## 9. API 设计

### 新增端点

```
# Phase 1
GET  /api/search?q=&platform=&tags=     # 全文搜索
POST /api/tags                          # 创建标签
POST /api/sessions/batch-tag            # 批量标签
POST /api/cache/sync                    # 触发缓存同步
GET  /api/cache/status                  # 缓存状态

# Phase 2
GET  /api/graph/entities?q=&type=       # 搜索实体
GET  /api/graph/entities/:id           # 实体详情
GET  /api/reports?type=weekly          # 历次报告
POST /api/reports/generate             # 触发报告
GET  /api/insights/profile             # 个人画像
GET  /api/insights/trends              # 效率趋势
```

---

## 10. UI/UX 设计原则

### 10.1 导航架构

```
📋 会话   🔍 搜索   📊 洞察   📝 报告   ⚙ 设置
```

### 10.2 关键交互

搜索页：搜索框 + 筛选侧栏 + 高亮结果列表
会话列表：批量选择栏 + 打标签/删除/导出
图谱页：实体搜索 + 关系网络可视化 (D3.js)
报告页：周报列表 + Markdown 预览 + 下载

---

## 11. 里程碑与交付标准

### 11.1 时间线

| 里程碑 | 内容 | 时间 |
|--------|------|------|
| M1.1 | 本地缓存层 | 2周 |
| M1.2 | FTS5 全文搜索 | 2周 |
| M1.3 | 标签系统 | 1周 |
| M1.4 | 批量操作 | 1周 |
| M2.1 | 定时复盘 | 3周 |
| M2.2 | 知识图谱 | 5周 |
| M2.3 | 代码证据链 | 3周 |
| M2.4 | 模式挖掘 | 3周 |
| M3.1 | MCP 写入 | 4周 |
| M3.2 | 共享空间 | 6周 |
| M3.3 | BI 仪表盘 | 4周 |

### 11.2 质量要求

| 维度 | 标准 |
|------|------|
| TypeScript | 100% strict mode |
| 测试覆盖率 | Phase 1 ≥ 40%, Phase 2 ≥ 60% |
| 性能 | FTS 搜索 < 100ms，图谱 < 200ms |
| 兼容性 | 向后兼容全部已有 API |

---

## 12. 附录

### 12.1 术语表

| 术语 | 定义 |
|------|------|
| Session | AI 工具中的一次对话/任务会话 |
| Adapter | 将不同平台原始数据格式转为统一 Schema |
| Distillation | 从原始对话中提取结构化知识 |
| ADR | Architecture Decision Record |
| FTS5 | SQLite 内置全文搜索引擎 |
| MCP | Model Context Protocol |
| Knowledge Graph | 实体关系网络 |

### 12.2 竞品参考

| 项目 | 定位 | 差异点 |
|------|------|--------|
| Sessions (Continue) | Dev 历史记录 | 只支持 VS Code |
| Wandb / MLflow | ML 实验追踪 | 不面向 Code Agent |
| Obsidian | 笔记知识管理 | 非 AI 编码原生 |

### 12.3 风险与缓解

| 风险 | 缓解 |
|------|------|
| 各平台数据格式变化 | Adapter 接口 + 异常降级 |
| FTS5 中文分词质量 | unicode61 + 可选 jieba 扩展 |
| 大量会话性能 | 增量缓存 + 分页 + 后台同步 |
| 用户不愿配 LLM Key | 无 LLM 降级为启发式规则 |
| 共享功能隐私 | 本地优先 + 脱敏 + 端到端加密 |

---

> 本文档是活文档，将随产品演进持续更新。
