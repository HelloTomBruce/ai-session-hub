# @session-hub/plugin-dsh

DeepSeek Harness（dsh，`@deepseek-ai/dsh`）会话解析插件，为 AI Session Hub 提供 dsh 历史会话聚合、消息流解析、思维链与工具调用提取能力。

## 特性

- 自动探查 `~/.dsh/sessions/` 目录，遍历 `<cwd 目录>/<sessionId>/session[.vN].jsonl.zstd`
- 基于 fzstd（纯 JS）解压多帧拼接的 zstd 日志（dsh 追加式逐帧写入，无 Node 版本要求、无原生依赖）
- 同目录多版本日志并存时自动选择最新版本（v4 > v2 > 旧版 `session.jsonl.zstd`）
- 解析多轮对话（区分真人输入与 runtime-context / skill-catalog / plugin 注入）、系统消息、思考链（Reasoning）与工具调用（按 callId 关联调用与结果）
- 提取会话标题（LLM 优化后的 `session/title`，缺失时回退首条用户消息）、模型 / Provider、Turn 数与 Subagent 委派元信息

## 说明

- dsh 会话为 zstd 压缩的追加式事件日志，插件只读解析，不支持改名 / 删除 / 新建
- Subagent 子会话（`origin=subagent`）同样纳入聚合，通过 `extra.parent_session` / `extra.origin` 标记

## 使用方式

```ts
import { DshPlugin } from '@session-hub/plugin-dsh'

const dsh = new DshPlugin()          // 默认读取 ~/.dsh/sessions/
const sessions = dsh.getSessions()   // UnifiedSession[]
const messages = dsh.getMessages(sessions[0].id)
```
