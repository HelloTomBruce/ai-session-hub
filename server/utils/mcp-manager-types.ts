export type McpServerType = 'stdio' | 'sse' | 'http' | 'directory'

export interface McpToolSchema {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export interface UnifiedMcpServer {
  id: string
  name: string
  platform: string
  platformName: string
  type: McpServerType
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  disabled?: boolean
  configPath: string
  toolsCount: number
  tools?: McpToolSchema[]
  instructions?: string
  sharedWith?: string[]
}

export interface McpServerDetailResponse {
  server: UnifiedMcpServer
  rawConfig: Record<string, unknown>
  configSnippets: {
    json: string
    toml: string
  }
}

export interface McpStats {
  total: number
  uniqueCount: number
  counts: Record<string, number>
  protocolCounts: Record<string, number>
}
