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
        toolsCount: 8,
        tools: [
          {
            name: 'list_sessions',
            description: '列出本地由 AI Session Hub 管理的所有 CLI 和 App 历史会话（支持按平台、CWD、关键词筛选）'
          },
          {
            name: 'get_session_details',
            description: '获取指定会话的完整对话历史记录、思考链路与工具调用数据'
          },
          {
            name: 'distill_knowledge',
            description: '对选定会话进行多维分析提炼，生成结构化总结'
          },
          {
            name: 'get_hub_stats',
            description: '获取各 CLI/App 会话与技能宏观统计指标'
          },
          {
            name: 'search_knowledge_vault',
            description: '检索知识金库中的架构决策(ADR)、避坑经验(Gotcha)、设计模式与里程碑'
          },
          {
            name: 'get_project_adrs',
            description: '获取指定工作区目录或全局所有的架构决策记录 (ADR)'
          },
          {
            name: 'capture_session_insight',
            description: '直接向 Session Hub 知识金库写入一条新的经验资产'
          },
          {
            name: 'evaluate_session_value',
            description: '对指定会话调用多维价值量化评估引擎 (ValueScoringEngine)'
          }
        ]
      }
    ]
  }
}
