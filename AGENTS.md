# AI Session Hub - Agent 开发与协同工作规约

本项目是面向开发者的多源 AI 编码会话聚合、智能检索、效能诊断与知识资产沉淀中枢。  
所有参与本项目的 AI Coding Agent（包括 Antigravity、Claude Code、Cursor 等）必须严格遵守以下技术规范、**UI/样式避坑指南**、**数据一致性准则**与 **DocMind 产品文档协同维护规约**。

---

## 1. 技术栈与架构全景

- **核心框架**：Nuxt 4 (Vue 3 / Nitro Engine) + TypeScript 5
- **UI 与样式**：Tailwind CSS v4 + @nuxt/ui (v3/v4 架构) + Lucide / Simple Icons + ECharts
- **数据与存储**：
  - 本地 SQLite (`better-sqlite3` + FTS5 全文检索虚表 + `Intl.Segmenter` 中英分词)
  - 知识图谱数据库：Grafeo (`@grafeo-db/js`) 作为单一记忆图谱与知识事实源（ADR-0001）
- **协议集成**：Model Context Protocol (MCP) Streamable HTTP (`/api/mcp/streamable`) 与 SSE (`/api/mcp/sse`)
- **工作区结构 (Monorepo)**：
  - `packages/core`：核心协议数据模型、Plugin 抽象基类与通用工具
  - `packages/analyzer`：会话解构、摩擦检测与效能指标提取
  - `packages/llm`：LLM 接口封装与容错降级矩阵
  - `packages/plugin-*`：各 Agent 独立会话解析适配器（Pi, Claude, Codex, OpenCode, AGY, WorkBuddy, ZCode, DSH 等）
  - `server/`：Nitro 服务端、FTS5 检索、评估打分引擎、诊断索引、Grafeo 图谱服务及 MCP 端点
  - `app/`：Nuxt 4 前端页面、组件系统、Composables 与全局样式
- **运行端口**：
  - Web 控制台：`http://localhost:3877`（开发运行：`pnpm dev`，默认 3000 或指定 3877）

---

## 2. 常用开发与质量保证命令

在执行提交或宣告任务完成前，必须保证以下命令通过：

```bash
pnpm dev             # 启动本地开发服务
pnpm run build       # 全量构建 (先编译 packages/** 再编译 nuxt)
pnpm test            # 运行价值评估引擎与关键单测 (node --import tsx --test)
pnpm run typecheck   # 跨 workspace 完整类型检查 (包含 packages 与 nuxt)
pnpm run lint        # 代码规范校验
```

---

## 3. 前端 UI 与样式设计避坑规约 (重大必读)

项目中多次发生“深色背景上按钮呈现突兀白底”、“文字发白/发虚导致完全看不清”的样式反噬问题。开发时必须遵循以下规则：

### 3.1 警惕 Nuxt UI 的 `variant="outline"` 实心背景机制
- **认知误区**：误以为 `variant="outline"` 是背景透明 (`bg-transparent`)。
- **底层现实**：`@nuxt/ui` 的 `outline` 变体预设了 `--ui-bg` 实体背景（在 Light 模式下为 `#ffffff` 纯白实体底）。将其放在浅灰背景、半透明面板或深色底栏中，会强制冒出一块突兀的纯白底色。
- **选型准则**：
  - 面板/卡片次级操作优先使用 `variant="subtle"` 或 `variant="ghost"`。
  - 需要微弱实体边框时，显式指定半透明边框与背景，例如：
    `class="bg-white hover:bg-zinc-100 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-700"`

### 3.2 局部深色容器（Dark Island）必须显式声明 `class="dark"`
- **问题本质**：当网页处于全局浅色模式时，手写的黑色浮动条（如 Dock / Floating Bar）或黑色卡片（如 `bg-zinc-900`），其内部的 Nuxt UI 组件（`UButton`, `UInput`）依然按全局浅色模式规则计算背景（注入白底）。若开发者在组件上打补丁追加 `text-white` 或 `text-zinc-200`，就会导致灾难性的**“纯白底色 + 浅白文字”**。
- **铁律**：
  凡是局部固定为深色背景的容器，必须在最外层显式声明 `class="dark"`：
  ```html
  <!-- 正确做法：显式加上 dark 作用域 -->
  <div class="dark fixed bottom-6 ... bg-zinc-900/95 text-white ...">
    <UButton variant="subtle" class="bg-zinc-800 text-zinc-100 ..." />
  </div>
  ```

### 3.3 文本高对比度安全准则
- 严禁随意组合 `text-zinc-300` / `text-zinc-400` 与浅色/中性色背景；
- 按钮文本颜色在 Light 模式下必须达到深黑灰级别（如 `text-zinc-800` / `text-zinc-900`），Dark 模式下使用纯白或亮灰（`dark:text-zinc-100` / `dark:text-white`），确保 WCAG AA 级以上对比度。

---

## 4. 后端服务与数据一致性规约

### 4.1 会话删除的级联清理铁律
在单项会话删除 (`server/api/sessions/[id].delete.ts`) 与批量删除 (`server/api/sessions/batch-delete.post.ts`) 时，必须确保全链路级联清理：
1. **物理适配器**：调用 `deleteCliSession(cli, id)` 清理本地源会话目录/文件；
2. **SQLite 缓存与全文检索**：调用 `cacheService.deleteFromCache(id, cli)`，并在同一事务内清理：
   - `sessions_cache`（会话元数据）
   - `messages_cache`（消息详情缓存）
   - `fts_messages`（FTS5 全文索引记录）
   - `session_diagnoses`（关联的 AI 效能诊断记录，避免产生孤儿数据）

### 4.2 记忆图谱与知识中心准则
- **单一事实源**：根据 ADR-0001，所有架构决策（ADR）、排障经验（Gotcha）和代码模式（Pattern）统一沉淀至 Grafeo 图数据库，旧的 SQLite `knowledge_vault` 仅用于向后兼容只读，禁止写入新业务数据；
- **状态流转**：从会话蒸馏出的候选条目必须经过 `draft -> confirmed` 转正链路。

---

## 5. DocMind PRD 协同开发规约 (Pure MCP 驱动)

本项目的产品需求全景已沉淀至 **DocMind 知识工作台**。  
在任何功能开发、Bug 修复、算法调优或架构演进过程中，**代码与 DocMind 中的产品文档必须通过 MCP 保持双向同步**。

### 5.1 DocMind 基础设施与上下文
- **MCP 服务**：`DocMind`（Streamable HTTP: `http://127.0.0.1:6001/messages`，亦可使用 SSE: `http://127.0.0.1:6001/sse`）
- **项目定位**：完全通过 MCP 接口维护，**无需关心本地物理路径**。操作前调用：
  ```json
  activate_project({ "name": "Session-hub" })
  ```
- **核心需求模块树（13 个全景模块）**：
  - `01 产品概述与定位`：愿景、目标角色、架构设计原则
  - `02 多源会话统一管理`：各平台适配器、批量管理、标签系统
  - `03 全文检索中心`：FTS5 虚表、中英文智能分词、多维检索
  - `04 会话详情与效能诊断`：思维链追踪、工具调用时间线、LLM 效能诊断报告
  - `05 知识蒸馏与 ADR 归档`：Map-Reduce 会话提炼与架构决策归档
  - `06 会话价值评估引擎`：多策略量化打分（如 Rubric V2 证据链评估）
  - `07 记忆图谱与知识资产中心`：Grafeo 图数据库、单一事实源、经验召回
  - `08 洞察统计`：多平台投入、标签热度与高价值会话图表
  - `09 插件化架构与生态`：Monorepo npm 插件与零代码声明式接入
  - `10 内置 MCP 服务端与 Agent 协议`：Streamable HTTP 与 SSE 双端点、MCP 工具集
  - `11 MCP 管理中心与 Agent 技能管理`：各 Agent 配置托管与 Skills 库
  - `12 技术架构与数据模型`：SQLite 存储结构、Grafeo 实体关系、目录规范
  - `13 迭代路线图与演进规划`：阶段演进规划与后续特性

### 5.2 迭代协同标准工作流 (AI 必须严格执行)

#### 阶段一：任务开始（需求对齐与状态流转）
1. **激活上下文与查阅规格**：
   - 接收任务后，调用 `activate_project({ "name": "Session-hub" })`；
   - 调用 `search_requirements` 或 `get_requirement_detail` 查阅当前改动涉及的功能模块规格；
   - 若用户提出新特性或新增模块，调用 `add_node` 在相应父节点下建立子需求及初始设计。
2. **状态流转**：
   - 调用 `update_requirement_status(node_id, "in_progress")`。

#### 阶段二：编码实现与验证
- 遵循 Monorepo 模块分层与强类型规范；
- 遵循前端 UI 样式避坑准则与后端数据清理铁律；
- 关键逻辑需运行 `pnpm test` 与 `pnpm run typecheck` 验证通过。

#### 阶段三：交付闭环（文档同步与状态闭环）
1. **同步更新产品文档**：
   - 编码完成后，若涉及**接口变更、评估策略调整、新增 MCP 工具、插件扩展、交互设计或视觉规范**，必须同时调用 `update_node` 更新 DocMind 对应模块的 Markdown 需求规格；
   - 严禁“只改代码不改 PRD”导致文档漂移。
2. **状态闭环**：
   - 调用 `update_requirement_status(node_id, "completed")`。
3. **交付报告输出**：
   - 汇报时明确列出修改的代码文件清单，以及同步更新的 DocMind 需求模块名称与变更点。
