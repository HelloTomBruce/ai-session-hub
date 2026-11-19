# AI Session Hub - Agent 开发与协同工作规约

本文件是本仓库的架构与协作契约。`CLAUDE.md` 引用本文件，其他 Agent（Cursor / Codex / DSH 等）直接读取本文件。**动手前先读完对应章节，不要凭印象改架构。**

## 1. 项目定位

面向开发者的本地单机中枢：把多个 AI 编码工具（CLI / App）的会话聚合进本机 SQLite 与 Grafeo 图数据库，提供全文检索、效能诊断、价值评估与记忆沉淀，并通过内置 MCP 服务把跨工具历史上下文回供给 Agent 自己。数据不出本机，默认只监听 `127.0.0.1`。

## 2. 技术栈

- 框架：Nuxt 4（Vue 3 + Nitro）、TypeScript、Node >= 20.19
- UI：Tailwind CSS v4 + `@nuxt/ui` v4、ECharts
- 存储：`better-sqlite3`（FTS5 全文索引 + `Intl.Segmenter` 中英分词）、Grafeo（`@grafeo-db/js` 图数据库）
- 协议：MCP Streamable HTTP（`/api/mcp/streamable`）与旧版 SSE（`/api/mcp/sse`）
- 工程：pnpm workspace monorepo（`packages/*` + 仓库根目录本身也是 workspace 成员）

## 3. 目录职责

| 路径 | 职责 |
| :--- | :--- |
| `app/` | Nuxt 4 前端：`pages/`、`components/`、`composables/`、`assets/`。只做展示与交互，不直连数据库 |
| `shared/` | 前后端同构的纯函数（如 `utils/session-text.ts` 的注入内容剥离），server 与 app 都可 import |
| `server/api/` | Nitro 路由层（`sessions` `cache` `search` `memory` `knowledge` `diagnoses` `insights` `mcp` `plugins` `skills` `tags` `platforms` `cli` `settings`）。只做参数校验与编排 |
| `server/utils/` | 服务端核心：`db`（SQLite 连接与迁移入口）、`cache-service`（缓存服务）、`cache-search` / `fts-query`（全文检索）、`plugin-manager`、`memory-service`（Grafeo）、`mcp/`（工具集、data-fence、secret-guard、instructions）、诊断与知识蒸馏 |
| `server/middleware/` | Nitro 中间件（启动期初始化插件等） |
| `packages/core/` | 统一数据类型与 `SessionPlugin` 接口契约，被所有插件与服务端依赖 |
| `packages/plugin-*` | 各工具适配器：`pi` `claude` `opencode` `codex` `agy` `workbuddy` `zcode` `dsh` |
| `packages/analyzer/` | 纯逻辑：会话解构、证据归一化、Rubric v2 价值评估（无宿主 IO） |
| `packages/llm/` | 纯逻辑：LLM 客户端（流式/非流式、端点兼容降级、JSON 提取） |
| `test/` | `node:test` 单测，按域分目录：`cache` `evaluator` `llm` `memory` `mcp` `plugins` `diagnoses` `tags` `validate` `db` `security` `shared`；全部通过 `HUB_HOME` 写入仓库内 `.test-hub`，不碰真实数据目录 |
| `scripts/` | 运维脚本：`check-db-lock.mjs`（启动前锁自检）、`generate-favicon.mjs`、`record-demo.ts`、`test-evaluator-engine.ts` |
| `bin/hub.mjs` | 终端 CLI（`hub` 命令），直连本地 SQLite 与 HTTP API |
| `skills/` | 分发给 Agent 的 Skill 文档 |

## 4. 插件契约

契约唯一定义在 `packages/core/src/index.ts`，是**接口 + duck typing，没有基类**：

- 必备成员：`manifest`、`isAvailable()`、`getSessions()`、`getMessages(id, session?)`
- 可选成员：`init()`、`updateSession()`、`deleteSession()`、`createSession()`、`onDestroy()`
- 输出必须是统一类型（`UnifiedSession` / `SessionMessage` / `SessionToolCall`），**禁止把各工具的原始格式泄漏到上层**
- 插件只读宿主工具的数据目录；写操作（改标题、删除）必须幂等，删除失败不得抛穿到 API 层
- 新增内置插件：`packages/plugin-<id>/` 实现接口 → 在 `server/utils/plugin-manager.ts` 的 `initBuiltinPlugins()` 注册 → 根 `package.json` 加 `workspace:*` 依赖 → README 插件表补一行
- 声明式零代码接入：`~/.session-hub/plugins/*.json` 里带 `id`，且满足 `type: "template-jsonl"` + `baseDir`（或 `type: "template-sqlite"` + `dbPath`）即自动注册为 `TemplateJsonlPlugin` / `TemplateSqlitePlugin`；开关状态存于 `~/.session-hub/plugins-config.json`

## 5. 数据层约定

- **唯一 SQLite 连接入口**：`server/utils/db.ts`（`getHubDb()` / `openHubDb()`，路径由 `hubHome()` / `hubFile()` 统一给出：`HUB_HOME` 优先，否则 `~/.session-hub`）。连接级 pragma（WAL / busy_timeout / foreign_keys）与建表迁移只由这一处拥有，**其他模块禁止自己 `new Database()` 拼数据目录**（否则测试无法隔离，会写进用户真实库）
- **缓存服务层**：`server/utils/cache-service.ts` 建在 `db.ts` 之上，负责会话/消息的同步与读写；业务代码一律经它访问缓存，不要直连连接
- **Schema 版本迁移**：表结构改 `server/utils/cache-schema.ts`（`SCHEMA_VERSION` + `CREATE_SCHEMA_SQL`），并同步递增版本号、在 `db.ts` 的 `migrate()` 里补「上一版 → 当前版」的幂等改动，保证老库平滑升级；禁止只改建表语句不管存量库
- **FTS5 检索**：`fts_messages` 由 `cache-service` 同步维护，检索实现是 `server/utils/cache-search.ts`，查询构造与中英分词在 `server/utils/fts-query.ts`；不要绕过它们手拼 FTS SQL
- **Grafeo 单写者**：`memory.grafeo` 是嵌入式单写者库，所有写入必须经 `withMemoryWriteLock(key, fn)`（`server/utils/memory-service.ts`）串行化；读路径要容忍 `GRAFEO-X001` 锁冲突
- 同一数据目录不能同时跑 `pnpm dev` 与 `.output` 生产服务，启动前由 `scripts/check-db-lock.mjs` 自检
- **删除必须级联**：物理适配器 → `sessions_cache` / `messages_cache` / `fts_messages` / 诊断与收割记录，不留孤儿数据
- 测试与演示用 `HUB_HOME` 指向 tmpdir 隔离，禁止写用户真实数据目录

## 6. 前端样式铁律（高频踩坑）

- `@nuxt/ui` 的 `variant="outline"` 是**实心背景**而非透明底，浅色/深色面板里会冒出突兀白块；次级操作优先 `subtle` / `ghost`
- 局部固定深色容器（Dock、浮动条、黑卡片）必须在最外层显式声明 `class="dark"`，否则内部组件仍按浅色模式注入白底，出现「白底 + 白字」
- 文字对比度按 WCAG AA 兜底：浅色模式用 `text-zinc-800/900`，深色模式用 `dark:text-zinc-100`

## 7. 质量门禁

提交或宣告完成前必须全绿：

```bash
pnpm run lint        # eslint（flat config：eslint.config.mjs → @nuxt/eslint）
pnpm run typecheck   # 先 build:packages 再 nuxt typecheck
pnpm run test        # 先重建 .test-hub，再 HUB_HOME=.test-hub node --import tsx --test（见 package.json）
pnpm run build       # build:packages + nuxt build
```

- CI（`.github/workflows/ci.yml`）步骤顺序：Install → Lint → Typecheck → Test → Build，任一红灯即不可合并
- 改 `server/`、`packages/*` 的纯逻辑必须补 `node:test` 单测；测试通过 `HUB_HOME=.test-hub` 隔离，禁止依赖或写入用户真实目录
- 服务端日志统一走 `server/utils/logger.ts`（级别由 `HUB_LOG_LEVEL` 控制），不要在 `server/` 直接 `console.*`
- API 入参统一走 `server/utils/validate.ts`（`requireString` / `requireInt` / `requireEntityRefs` …），不要 `query.x as string` 硬转
- 不要提交 `package-lock.json`（`pnpm-lock.yaml` 是唯一事实源）、`.output`、`node_modules`、`~/.session-hub` 数据

## 8. 提交规范

- 采用 Conventional Commits：`<type>(<scope>): <subject>`
- `type`：`feat` `fix` `refactor` `perf` `test` `docs` `chore` `build` `ci`
- `scope` 用模块名：`core` `ui` `sessions` `memory` `harvest` `mcp` `plugins` `insights` `evaluator` …
- `subject` 用中文动宾短语、不带句号，例：`feat(harvest): 摩擦事件驱动过滤 + 本地 .agents/gotchas.md 双写机制`
- 一个提交只做一件事；涉及接口、数据模型或 schema 变更时在正文写明影响面与迁移方式

## 9. DocMind PRD 协同（MCP 驱动）

产品需求全景维护在 DocMind 知识工作台，代码与 PRD 需双向同步：

1. **任务开始**：`activate_project`（项目名以 `list_projects` 返回为准）→ `search_requirements` / `get_requirement_detail` 查阅相关模块 → `update_requirement_status(node_id, "in_progress")`
2. **编码**：遵守本文件的分层、数据层约定与质量门禁
3. **交付**：接口、评估策略、MCP 工具、插件或交互有变更时，`update_node` 更新对应需求文档，再 `update_requirement_status(node_id, "completed")`
4. **DocMind 不可用时**（MCP 连接失败）：不要伪造同步，在交付说明中注明「未同步的模块 + 原因」，待服务恢复后补
