# AI Session Hub 🚀

<div align="center">

**极简、高效的多源 AI 编码会话聚合、智能检索、效能诊断与知识资产沉淀中枢**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Nuxt](https://img.shields.io/badge/Nuxt-3.x-00DC82?logo=nuxt&logoColor=white)](https://nuxt.com/)
[![Nuxt UI](https://img.shields.io/badge/Nuxt_UI-v3-00DC82?logo=nuxt&labelColor=020420)](https://ui.nuxt.com)
[![SQLite FTS5](https://img.shields.io/badge/SQLite-FTS5_Fulltext-003B57?logo=sqlite&logoColor=white)](https://www.sqlite.org/fts5.html)
[![MCP](https://img.shields.io/badge/MCP-SSE_Supported-9B51E0)](https://modelcontextprotocol.io/)

[功能特性](#-核心功能特性) • [插件生态](#-插件化架构与生态) • [快速开始](#-快速开始) • [声明式零代码扩展](#-接入自定义-agent零代码) • [MCP 服务](#-内置-mcp-sse-服务)

</div>

---

## 🌟 项目简介

随着日常开发中引入多种 AI Coding Agent（如 **Claude Code**, **Pi CLI**, **OpenCode**, **Codex**, **AGY / Antigravity**, **WorkBuddy** 等），开发者往往面临会话割裂、历史知识难以检索、方案决策分散、缺乏效能复盘等痛点。

**AI Session Hub** 是一个专为开发者设计的本地会话管理与知识提炼中枢：
- 聚合多端 Agent 的会话数据，提供统一的浏览、编辑、标签与批量导出能力；
- 内置 **SQLite FTS5 + 中英文智能分词** 全文检索，毫秒级定位跨工具的对话、思维链与代码修改轨迹；
- 依托 LLM 驱动的 **会话效能诊断** 与 **Map-Reduce 知识提炼（ADR 架构决策）**；
- 采用 **Monorepo 独立插件化架构**，支持 npm 模块化扩展与零代码声明式接入；
- 内置 **MCP SSE 协议服务端**，可作为各 Agent 的共享知识源。

---

## 🎯 核心功能特性

### 1. 🗂️ 多源会话统一管理
- **多平台无缝聚合**：统一接入 Pi、Claude Code、OpenCode、Codex、AGY、WorkBuddy 等平台会话。
- **动态配置驱动**：顶部平台 Tab、统计卡片与会话徽章完全根据插件的启用状态与元数据动态渲染。
- **会话批量操作**：支持按平台快速筛选、多选批量删除、批量打标签、批量导出为 JSON 或 Markdown 格式。
- **标题智能提取**：支持智能识别 Agent 自动生成的 AI 标题（如 Claude `ai-title`）与自定义重命名。

### 2. 🔍 全库智能全文检索 (FTS5 + 中英文分词)
- **毫秒级跨端检索**：支持对海量会话内容、思考过程（Thinking）、工具调用入参与返回结果、工作目录及标签进行多维全文搜索。
- **智能分词与高亮**：基于 `Intl.Segmenter` 实现高质量中英文混合分词，关键词智能黄色高亮显示。
- **双视图随心切换**：
  - **按会话聚合 (Group by Session)**：展示每个匹配会话下的命中间隙与匹配次数，便于快速理清上下文。
  - **全部平铺 (Flat Message List)**：逐条查看命中消息并支持一键精准锚点定位。

### 3. 🧠 思考路径与会话效能诊断 (AI Diagnosis)
- **完整思维链展示**：提取 Agent 的深层推导依据（Thinking Process）与工具调用执行记录。
- **AI 量化评估**：从直接推进度（Directness）、决策合理性（Soundness）、周转效率（Turn Velocity）及动作密度等多维度量化打分（S / A / B / C 评级）。
- **扣分归因与处方建议**：精准检测思路修正/返工、搜索过于密集、多轮拉扯等摩擦事件，并给出改进建议。
- **流式报告生成与缓存**：支持自定义配置 LLM Provider（OpenAI / DeepSeek / Claude / 自建端点），诊断结果本地持久化。

### 4. 📚 知识提炼与 ADR 架构资产归档 (Distill & Harvest)
- **Map-Reduce 跨会话提炼**：多选历史会话后流式生成综合复盘报告（完成工作、关键技术决策、排坑避坑要点、未竟待办）。
- **结构化 ADR 架构决策提炼**：自动识别技术选型、上下文与后果，支持一键批量归档至「知识资产库」。
- **知识资产中心**：集中检索已沉淀的 ADR，支持多格式全量导出。

### 5. 🔌 内置 MCP SSE 服务端
- 内置 `/api/mcp/sse` 端点，支持 Model Context Protocol (MCP) 标准协议。
- 可在 Claude Code、Cursor、AGY、OpenCode 等工具中直接配置 Session Hub 作为 MCP 服务器，实现跨 Agent 知识联动。

---

## 📦 插件化架构与生态

项目基于 **pnpm workspace monorepo** 架构，将核心规范与各个 Agent 适配器完全解耦为独立的 npm 插件包：

```
session-hub/
├── packages/
│   ├── core/                  # @session-hub/core: 插件基类、类型定义与统一生命周期规范
│   ├── plugin-pi/             # @session-hub/plugin-pi: Pi CLI 插件
│   ├── plugin-claude/         # @session-hub/plugin-claude: Claude Code 插件
│   ├── plugin-opencode/       # @session-hub/plugin-opencode: OpenCode CLI 插件
│   ├── plugin-codex/          # @session-hub/plugin-codex: Codex App 插件
│   ├── plugin-agy/            # @session-hub/plugin-agy: Antigravity (AGY) 插件
│   └── plugin-workbuddy/      # @session-hub/plugin-workbuddy: WorkBuddy 插件
├── app/                       # Nuxt 3 前端界面与交互层
├── server/                    # Nitro 后端引擎、PluginManager 与 SQLite 缓存层
└── pnpm-workspace.yaml
```

### 插件包一览

| 插件包 | 目标平台 | 数据格式 | 说明 |
| :--- | :--- | :--- | :--- |
| **`@session-hub/core`** | 基础核心 | - | 插件 Manifest、统一会话类型与生命周期接口 |
| **`@session-hub/plugin-pi`** | Pi CLI | JSONL | 支持树状分支会话、Thinking 与 Skill 解析 |
| **`@session-hub/plugin-claude`** | Claude Code | JSONL | 智能识别 `ai-title`、复合 Content 块与工具调用 |
| **`@session-hub/plugin-opencode`** | OpenCode CLI | SQLite | 自动解析多项目 Worktree、Part 消息与工具执行 |
| **`@session-hub/plugin-codex`** | Codex App | SQLite / Rollout | 高性能解析 Thread 会话与 Rollout 日志 |
| **`@session-hub/plugin-agy`** | AGY CLI | JSONL | 深度解析 Brain 轨迹、Prompt 交互与工具流 |
| **`@session-hub/plugin-workbuddy`**| WorkBuddy | SQLite | 企业级工作助手本地会话解析 |

---

## 🛠️ 接入自定义 Agent（零代码）

除了安装 npm 插件包外，Session Hub 支持通过声明式 JSON 配置接入任意工具。只需在 `~/.session-hub/plugins/` 放置一个 JSON 配置文件即可自动识别！

### 示例 1：JSONL 类型工具 (`~/.session-hub/plugins/my-agent.json`)
```json
{
  "id": "my-agent",
  "name": "My Agent CLI",
  "category": "cli",
  "icon": "i-lucide-terminal",
  "description": "自定义终端 Agent",
  "type": "template-jsonl",
  "baseDir": "~/.my-agent/sessions",
  "filePattern": "*.jsonl",
  "roleField": "role",
  "contentField": "content",
  "titleField": "title"
}
```

### 示例 2：SQLite 类型工具 (`~/.session-hub/plugins/my-sqlite-tool.json`)
```json
{
  "id": "my-tool",
  "name": "My SQLite App",
  "category": "app",
  "icon": "i-lucide-database",
  "description": "自定义 SQLite 架构开发工具",
  "type": "template-sqlite",
  "dbPath": "~/.my-app/data.db",
  "sessionsTable": "conversations",
  "idColumn": "id",
  "titleColumn": "title",
  "updatedAtColumn": "updated_at"
}
```

### 💡 插件图标（Icon）规范与查询
Session Hub 采用 Iconify 图标系统（Nuxt UI 内置）。编写插件时，在 `icon` 字段填入符合规范的图标名称：
- **通用图形（Lucide）**：`i-lucide-<name>`，如 `i-lucide-terminal`、`i-lucide-bot`、`i-lucide-code-2`、`i-lucide-sparkles`、`i-lucide-database`、`i-lucide-cpu`
- **品牌与工具 Logo（Simple Icons）**：`i-simple-icons-<brand>`，如 `i-simple-icons-anthropic`、`i-simple-icons-openai`、`i-simple-icons-github`
- **在线查找图标**：可访问 [Icônes (icones.js.org)](https://icones.js.org/) 或 [Lucide Icons (lucide.dev)](https://lucide.dev/icons) 搜索，复制图标名称并加上 `i-` 前缀即可。

进入系统后点击导航栏右上角 **「插件」** 按钮，点击「重新扫描」即可立即启用并出现在会话列表顶部！

---

## 🚀 快速开始

### 前置要求
- Node.js >= 18.0.0
- pnpm >= 9.0.0

### 安装与启动

1. **克隆项目并安装依赖**
   ```bash
   git clone https://github.com/your-org/session-hub.git
   cd session-hub
   pnpm install
   ```

2. **编译核心与插件包**
   ```bash
   pnpm --filter @session-hub/* build
   ```

3. **启动开发服务器**
   ```bash
   pnpm dev
   ```
   访问 `http://localhost:3877` 即可开始使用。

4. **构建生产版本**
   ```bash
   pnpm build
   node .output/server/index.mjs
   ```

---

## 🤖 内置 MCP SSE 服务

Session Hub 原生支持 MCP (Model Context Protocol) SSE 服务端协议。

### 在 Claude Code 中配置
在 `~/.claude.json` 中添加：
```json
{
  "mcpServers": {
    "session-hub": {
      "url": "http://localhost:3877/api/mcp/sse"
    }
  }
}
```

### 在 Cursor / 其他客户端中配置
添加 SSE MCP 服务器：
- **Name**: `session-hub`
- **Type**: `sse`
- **URL**: `http://localhost:3877/api/mcp/sse`

配置后，AI 即可在对话中直接调用 Session Hub 检索跨工具的会话上下文、排错经验与 ADR 架构决策！

---

## 📄 License

MIT License © 2026 Session Hub Contributors.
