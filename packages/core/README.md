# @session-hub/core

AI Session Hub 核心 SDK 与插件接口标准定义包。

## 安装

```bash
npm install @session-hub/core
# 或
pnpm add @session-hub/core
```

## 图标（Icon）规范与查询指南

Session Hub 前端基于 [Iconify](https://icones.js.org/) 和 [Nuxt UI](https://ui.nuxt.com/) 进行图标渲染。在 `manifest.icon` 或 JSON 配置中，请使用以下规范的图标名称：

### 1. 图标格式
- **Lucide 图标集**（通用图形）：`i-lucide-<name>`（如 `i-lucide-terminal`, `i-lucide-bot`, `i-lucide-code-2`, `i-lucide-sparkles`）
- **Simple Icons 图标集**（品牌与工具 Logo）：`i-simple-icons-<brand>`（如 `i-simple-icons-anthropic`, `i-simple-icons-openai`, `i-simple-icons-github`）

### 2. 在线查找图标
- **[Icônes 综合检索 (icones.js.org)](https://icones.js.org/)**：搜索关键词（如 `terminal`, `chat`, `code`, `brain` 等），点击图标即可复制对应集合与名称（加上 `i-` 前缀）。
- **[Lucide Icons (lucide.dev)](https://lucide.dev/icons)**：查看所有 Lucide 图标。
- **[Simple Icons (simpleicons.org)](https://simpleicons.org/)**：查看所有知名品牌和开发工具 Logo。

### 3. TypeScript 智能补全
在引入 `@session-hub/core` 开发 TypeScript 插件时，`manifest.icon` 已内置 `CommonPluginIcon` 类型定义，输入单引号时 IDE 会自动弹出常用图标列表供选择。

---

## 编写自定义 Session Hub 插件示例

实现 `SessionPlugin` 接口即可发布到 npm：

```typescript
import type { SessionPlugin, SessionPluginManifest, UnifiedSession, SessionMessage } from '@session-hub/core'

export class MyAgentPlugin implements SessionPlugin {
  readonly manifest: SessionPluginManifest = {
    id: 'my-agent',
    name: 'My Agent CLI',
    category: 'cli',
    icon: 'i-lucide-bot', // 支持 IDE 自动补全
    version: '1.0.0',
    description: 'My custom agent session plugin',
    type: 'npm'
  }

  isAvailable(): boolean {
    // 检查本地运行环境（如 ~/.my-agent 目录是否存在）
    return true
  }

  getSessions(): UnifiedSession[] {
    // 读取本地会话列表
    return []
  }

  getMessages(id: string, session?: UnifiedSession): SessionMessage[] {
    // 读取会话消息列表
    return []
  }
}

export const plugin = new MyAgentPlugin()
export default plugin
```
