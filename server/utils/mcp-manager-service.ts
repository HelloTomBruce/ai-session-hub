import { mcpRegistry } from './mcp-providers/mcp-provider-registry'
import type { UnifiedMcpServer, McpServerDetailResponse, McpStats } from './mcp-manager-types'

export class McpManagerService {
  getAllServers(platformFilter?: string, protocolFilter?: string, query?: string): { servers: UnifiedMcpServer[], stats: McpStats } {
    return mcpRegistry.getAllServers(platformFilter, protocolFilter, query)
  }

  getServerDetail(platform: string, id: string): McpServerDetailResponse | null {
    return mcpRegistry.getServerDetail(platform, id)
  }

  getStats(): McpStats {
    return mcpRegistry.getAllServers().stats
  }
}

export const mcpManagerService = new McpManagerService()
