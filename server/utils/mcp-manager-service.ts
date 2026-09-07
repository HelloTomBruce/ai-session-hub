import { mcpRegistry } from './mcp-providers/mcp-provider-registry'
import type { UnifiedMcpServer, McpServerDetailResponse, McpStats } from './mcp-manager-types'

export class McpManagerService {
  getAllServers(platformFilter?: string, protocolFilter?: string, query?: string): { servers: UnifiedMcpServer[], stats: McpStats } {
    return mcpRegistry.getAllServers(platformFilter, protocolFilter, query)
  }

  getServerDetail(platform: string, id: string): McpServerDetailResponse | null {
    return mcpRegistry.getServerDetail(platform, id)
  }
}

export const mcpManagerService = new McpManagerService()
export * from './mcp-manager-types'
export { mcpRegistry } from './mcp-providers/mcp-provider-registry'
export { BaseJsonMcpProvider, type McpProvider } from './mcp-providers/base-mcp-provider'
