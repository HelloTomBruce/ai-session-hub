# TOMB-2 插件体系与数据接入审计报告

审计对象：`session-hub`（本地 `/Users/zhangbei/code/session-hub`），packages/core + 6 个平台适配器 + server 模板插件/缓存层。
验证方式：本机真实数据实测 + 模拟数据边界测试 + 零代码接入端到端测试（均通过 tsx 直接加载插件源码/产物执行）。

## 一、插件能力矩阵

| 适配器 | 格式 | 会话列表 | 消息解析 | 工具调用 | Thinking | 标题提取 | 创建 | 重命名 | 删除 | 本机实测 | 结论 | 评分(/10) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Pi | JSONL | ✅ | ✅ | ✅(230条) | ✅(162) | ✅(session/custom_title/首条用户消息) | ✅ | ✅ | ✅ | 23会话/603消息 | **可正常使用** | 8.5 |
| Claude | JSONL | ✅ | ✅ | ✅ | ✅ | ✅(ai-title/custom_title) | ✅ | ✅ | ✅(含 sidecar 目录) | 2会话/9消息 | **可正常使用** | 8 |
| OpenCode | SQLite | ✅ | ✅ | ✅(130) | ✅(133) | ✅(title/slug) | ✅ | ✅ | ✅ | 4会话/154消息 | **部分可用** | 7 |
| Codex | SQLite+Rollout | ✅ | ✅ | ⚠️ 未解析工具调用 | ⚠️ 仅 summary | ✅(含 TRANSCRIPT 正则提取) | ✅ | ✅ | ✅(软删归档) | 7会话/124消息 | **部分可用** | 6.5 |
| AGY | SQLite+JSONL | ✅ | ✅ | ✅(709) | ✅(64) | ✅(title/preview) | ✅ | ✅ | ✅ | 19会话/1543消息 | **可正常使用**（有边界问题） | 7.5 |
| WorkBuddy | SQLite+JSONL | ⚠️ | ✅ | ✅ | ✅ | ✅(custom_title) | ✅ | ✅ | ✅(软删) | 库内79行全部 `deleted_at` 非空 → 列表 **0**；消息解析实测正常(165条) | **部分可用**（无法端到端验证） | 5 |
| 模板 JSONL | 声明式 | ✅ | ✅ | ❌ | ❌ | ⚠️ titleField 文档承诺但未实现 | ✅ | ⚠️ 假成功 | ✅ | 模拟数据 e2e 通过 | **部分可用** | 6.5 |
| 模板 SQLite | 声明式 | ✅ | ⚠️ 消息 FK 列名硬编码 | ❌ | ❌ | ✅ | ⚠️ 假成功(不落库) | ⚠️ 假成功 | ✅ | 模拟数据：列表✅/消息❌ | **部分可用** | 5 |

统一规范（packages/core）设计合理：`UnifiedSession`/`SessionMessage`/`SessionPlugin` 接口完整，读写生命周期齐全。

## 二、问题清单（严重级别 / 影响范围）

### 高严重度

| # | 问题 | 位置 | 影响范围 |
|---|---|---|---|
| H1 | **适配器静默失败**：OpenCode/Codex/AGY `getSessions()` catch 后直接 `return []` 无任何日志；Pi/Claude 扫描层 catch 静默 | `plugin-opencode/index.ts:139`、`plugin-codex`、`plugin-agy`、`plugin-pi`、`plugin-claude` | 目标工具升级导致 SQLite schema 漂移或文件损坏时，该平台会话**整体消失且无日志**；FTS 缓存仍展示旧数据，列表与搜索不一致 |
| H2 | **模板 SQLite 消息列名硬编码** `WHERE session_id = ? OR conversation_id = ?`，配置不可指定；README 宣称零代码接入任意 SQLite 工具，实测非该命名的 schema 直接查错（仅 console 报错，UI 显示空消息） | `server/utils/plugins/template-sqlite-plugin.ts:83` | 所有声明式 SQLite 插件 |
| H3 | **假成功操作**：`TemplateSqlitePlugin.createSession` 不 INSERT（刷新即消失）；`TemplateJsonlPlugin/TemplateSqlitePlugin.updateSession` 恒返回 true 不改任何数据 | `template-sqlite-plugin.ts:129`、`template-jsonl-plugin.ts:112` | 零代码插件的创建/重命名功能完全不可信 |
| H4 | **缓存无 prune**：`cacheService.sync()` 只 upsert 不删除，源端被删的会话在 `sessions_cache` 永久残留，列表页继续展示"幽灵会话"，点进去 404/空 | `server/utils/cache-service.ts:sync()` | 全部平台 |

### 中严重度

| # | 问题 | 位置 | 影响范围 |
|---|---|---|---|
| M1 | OpenCode `model` 原样透传 DB 里的 JSON 字符串（实测值 `{"id":"ling-3.0-flash-fin-free","providerID":"opencode",...}`），未提取 `modelID` | `plugin-opencode/index.ts:160` | OpenCode 模型展示/过滤 |
| M2 | Codex `role: 'developer'` 泄漏出 role 枚举（实测 124 条消息中 4 条），未归一化为 user/assistant | `plugin-codex/index.ts:getMessages` | Codex、前端角色渲染 |
| M3 | Codex 去重 `messages.some(m => m.content === text)`：O(n²)，且**内容相同即丢弃**——用户连续发送相同文本会丢消息 | `plugin-codex/index.ts` | Codex 消息完整性 |
| M4 | Codex `cost = tokens/1M × 2.5` 硬编码单价，与模型无关的伪成本数据 | `plugin-codex/index.ts` | 成本统计可信度 |
| M5 | AGY `getMessages` 行级 `JSON.parse` 无保护：一行坏数据导致整个 transcript 解析中断（返回部分数据且无日志）；消息 id 依赖 `step_index`，缺失时缓存层 `INSERT OR REPLACE` 主键冲突会**折叠丢消息** | `plugin-agy/index.ts:148`、`cache-service.ts` | AGY 消息完整性 |
| M6 | `PluginStatusInfo.source` 判定错误：内置插件 manifest.type='npm' 导致全部显示 'user'，'npm' 分支永不触发 | `server/utils/plugin-manager.ts:getPluginStatusList` | 插件面板来源展示 |
| M7 | AGY `createSession` 写入 SQLite `datetime('now')`（无时区 UTC 字符串），读取端 `new Date()` 按本地时区解析 → 8 小时偏移 | `plugin-agy/index.ts:196` | AGY 新建会话时间 |
| M8 | 声明式 JSON 配置无 schema 校验：缺 `baseDir`/`dbPath` 时构造期 TypeError（仅 console 日志，插件面板无失败原因）；表名/列名直接字符串拼接 SQL | `plugin-manager.ts:loadDeclarativeJsonPluginsSync`、两个模板插件 | 零代码接入体验 |
| M9 | `filePattern`、`titleField` 在 README 与 `TemplateJsonlConfig` 类型中声明，实现完全忽略（硬编码 `.jsonl` 后缀、标题恒为 `Session <id>`） | `template-jsonl-plugin.ts` | 零代码 JSONL 接入 |
| M10 | OpenCode `deleteSession` 只删 session 行，孤儿 message/part 数据残留（未开 foreign_keys pragma） | `plugin-opencode/index.ts:224` | OpenCode 数据库膨胀 |
| M11 | 搜索 `groupBy=session` 分页失效：offset 作用于消息行而非会话组，第二页起分组结果错乱；total 为消息数非会话数 | `cache-service.ts:search` | 前端聚合搜索翻页 |

### 低严重度

| # | 问题 | 影响范围 |
|---|---|---|
| L1 | Pi `getSessions` 为统计 messageCount/标题全量解析每个 JSONL；`getPluginStatusList` 每次全量统计；sync 时再解析一遍（双重 IO）。实测 20k 行文件 10ms/次，量大后线性劣化 | Pi/Claude 列表性能 |
| L2 | Codex `findRolloutPath` 在 `rollout_path` 失效时对整个 `~/.codex/sessions` BFS，每次消息拉取触发 | Codex 详情页性能 |
| L3 | 启动与 `reload()` 时声明式 JSON 被加载两次（`loadDeclarativeJsonPluginsSync` + `loadExternalPlugins`），日志重复（Map 去重，无功能问题） | 日志噪音 |
| L4 | Pi `role: 'toolResult'` 泄漏出 role 枚举 | Pi 前端渲染 |
| L5 | FTS 索引内容截断 50000 字符 | 超长消息搜索 |
| L6 | 会话详情 mtime 兜底：DB 类适配器以整个 DB 文件 mtime 判断，任一会话写入触发该库会话重同步（正确但浪费） | 性能 |
| L7 | 同步/解析无任何重试或降级策略，单次失败仅计入 sync 返回的 errors 计数；日志仅 console 无持久化，插件面板不显示加载失败原因 | 可观测性 |
| L8 | 自定义 `.plugin.js` 与 npm 插件的 `manifest.id` 与内置 id 冲突时静默覆盖内置插件 | 安全性（本地场景低） |

## 三、"零代码接入新平台"真实可用性评估

- **JSONL 模板：基本可用**。实测将 JSON 配置放入 `~/.session-hub/plugins/` 后重扫，会话与消息正确出现；坏行/缺字段容错正常。但 `filePattern`/`titleField` 未实现、创建/重命名假成功，距 README 承诺有差距。
- **SQLite 模板：可用性有限**。会话列表对任意列名可配置（实测通过），但消息表 FK 列名硬编码为 `session_id`/`conversation_id`，不满足即整个消息面不可用；`createSession` 不落库。**当前只能接入"恰好使用该命名"的库**。
- 配置无校验、失败原因不上屏，排障全靠服务端 console。
- 自定义 `.plugin.js` 路径能力最强（任意逻辑），但等于"写代码"，不属于零代码。

## 四、增量同步 / 重试 / 日志专项结论

- **增量同步**：hash（title/updatedAt/messageCount/cwd/extra）比对 + 变更会话整体重写消息与 FTS，机制正确；会话详情另有 mtime 兜底刷新，设计合理。
- **失败重试**：**缺失**。同步单次失败即跳过（返回 errors 计数），解析失败静默返回空，均无重试/降级。
- **异常日志**：**不满足**。全部 console 输出、无持久化；5 个适配器存在静默 catch（H1）；插件加载失败原因不在插件面板暴露。

## 五、建议优先修复项

- **P0**：H1 静默失败补日志并暴露到插件面板状态；H4 sync 增加"源端消失会话"prune；H2 模板 SQLite 消息 FK 列名可配置（如 `messageSessionIdColumn`）。
- **P1**：H3 模板插件 create/update 要么实现要么显式报"不支持"；M1 OpenCode model 提取 `modelID`；M2 Codex role 归一化；M5 AGY 行级容错 + 消息 id 退化策略。
- **P2**：M3/M4 Codex 去重与成本、M6 source 判定、M7 时区、M9 补齐或删除文档承诺、M11 聚合分页、L1/L2 性能。
