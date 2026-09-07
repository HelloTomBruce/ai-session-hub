import type { McpProvider } from './base-mcp-provider'
import type { UnifiedMcpServer } from '../mcp-manager-types'

export class HubMcpProvider implements McpProvider {
  readonly platform = 'hub'
  readonly platformName = 'Session Hub'

  isAvailable(): boolean {
    return true
  }

  getServers(): UnifiedMcpServer[] {
    return [
      {
        id: 'ai-session-hub-mcp',
        name: 'AI Session Hub (内置服务)',
        platform: this.platform,
        platformName: this.platformName,
        type: 'sse',
        url: 'http://localhost:3000/api/mcp/sse',
        disabled: false,
        configPath: 'server/utils/mcp-server-instance.ts',
        toolsCount: 4,
        tools: [
          {
            name: 'list_sessions',
            description: '列出本地由 AI Session Hub 管理的所有 CLI 和 App 历史会话'
          },
          {
            name: 'get_session_details',
            description: '获取指定会话的完整对话历史记录、思考链路与工具调用数据'
          },
          {
            name: 'distill_sessions',
            description: '对选定会话进行多维分析提炼，生成结构化知识总结'
          },
          {
            name: 'get_stats',
            description: '获取各 CLI/App 会话与技能宏观统计指标'
          }
        ]
      }
    ]
  }
}
