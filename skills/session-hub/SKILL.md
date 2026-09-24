---
name: session-hub
description: 当在项目中开始编码工作、需要召回历史工程经验（ADR/避坑/模式）时；当刚解决一个难题、踩过坑或做出架构决策、值得跨会话沉淀时；当需要按关键词、报错或文件路径全文检索历史 AI 编码会话时使用。需要 session-hub MCP 服务（SSE）。
---

# session-hub 记忆与会话中枢

本地 MCP 服务，提供两类能力：**记忆图谱**（Grafeo，工程知识沉淀与召回）和**会话检索**（FTS5 全文索引，跨 11+ 个 AI 编码工具的历史会话）。

## 连接

- SSE 地址：`http://localhost:3877/api/mcp/sse`
- 服务由 session-hub 项目提供（项目目录下 `pnpm dev` 启动）。连接失败（connection refused）时，提示用户先启动服务。

## 记忆召回：两级模式（省上下文）

`recall_memories` 只返回**摘要级**信息（id/title/type/summary/置信度/实体标签，不含正文）。不要在召回后无脑拉取全部详情。

```text
1. recall_memories(query, cwd, tech, type, limit)
   → 得到候选列表（摘要 + 实体标签）
2. 凭 summary / techConcepts / problems 判断相关性
3. 仅对确认相关的条目 get_memory(id) 拉完整正文与代码片段
```

- `cwd` 传当前项目路径——图谱按项目挂载记忆，带 cwd 会优先召回本项目沉淀
- `tech` 传当前技术栈实体名数组（如 `["Nuxt", "SQLite"]`），按技术匹配度排序
- `type` 过滤：ADR | Gotcha | BestPractice | Pattern | Workflow | Config | Security | Performance | ApiSpec
- `search_memory_graph(type?, project?, limit?)`：需要看实体关系拓扑时用（节点+边），日常召回不需要

## 沉淀：save_memory

**何时沉淀**：解决了一个非显而易见的难题、踩了坑并找到根因、做出架构/技术选型决策、发现可复用模式或配置范式。**不要**沉淀琐碎改动、一次性操作或会话过程性内容。

字段规范：

| 字段 | 要求 |
|---|---|
| `title` | 动宾短语，脱离会话也能读懂（如「Nuxt 3 原生 C++ 绑定的 Nitro 外部化配置」） |
| `type` | 见上方类型表；内容不匹配预设类型时可自定义 |
| `summary` | 一句话核心结论 |
| `content` | 完整 Markdown：背景/痛点 → 方案 → 注意事项 |
| `projects` | `[{name, cwd}]`，当前项目必挂 |
| `techConcepts` | `[{name, category}]`，category ∈ framework/library/language/tool/db/infra/other |
| `problems` | `[{title, symptom, errorCode}]`，有报错必挂（召回时可按问题命中） |
| `supersededIds` | 内容演进替代旧记忆时传旧 id 数组，建立 SUPERSEDES 链；同主题新知识不要另起孤立节点 |

## 会话检索

| 工具 | 用途 | 关键参数 |
|---|---|---|
| `search_sessions_fts` | 全文检索历史会话正文/工具调用/修改过的文件路径/思考链 | `query`（必需，支持中文）、`platform`、`role`、`cwd`、`limit` |
| `list_sessions` | 按平台/工作目录/关键词列会话 | `platform`、`cwd`、`search`、`limit` |
| `get_session_details` | 拉取指定会话的完整对话与工具调用 | `platform` + `sessionId`（均必需，来自前两个工具的返回） |

典型流程：`search_sessions_fts("报错信息或文件路径")` → 命中会话 → `get_session_details` 看当时怎么解决的。

## 常见错误

| 错误 | 正确做法 |
|---|---|
| recall 后把所有结果的详情全 get 一遍 | 两级模式：只拉 summary 判断后确认相关的 |
| save_memory 不挂 techConcepts / projects | 实体是召回过滤的入口，不挂等于沉底 |
| 同主题知识反复新建节点 | 查已有记忆，内容演进用 `supersededIds` 关联 |
| 把会话过程记录（"用户说/助手说"）写进 content | 沉淀要解耦会话：提炼为通用经验，去掉对话口吻 |
| 连接失败就跳过 | 提示用户启动 session-hub 服务后重试 |
