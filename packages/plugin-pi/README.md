# @session-hub/plugin-pi

Pi CLI 会话适配器插件，支持 AI Session Hub。

## 安装

```bash
npm install @session-hub/plugin-pi
# 或
pnpm add @session-hub/plugin-pi
```

## 使用方式

### 在 Session Hub 中注册

```typescript
import { pluginManager } from 'session-hub/server/utils/plugin-manager'
import { PiPlugin } from '@session-hub/plugin-pi'

pluginManager.register(new PiPlugin())
```
