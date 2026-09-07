import fs from 'node:fs'
import path from 'node:path'
import type { McpProvider } from './base-mcp-provider'
import { homeDir } from './base-mcp-provider'
import type { UnifiedMcpServer, McpServerType, McpToolSchema } from '../mcp-manager-types'

interface CachedToolItem {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

interface CachedServerEntry {
  tools?: CachedToolItem[]
  instructions?: string
}

export class PiMcpProvider implements McpProvider {
  readonly platform = 'pi'
  readonly platformName = 'Pi CLI'
  readonly filePath = path.join(homeDir, '.pi', 'agent', 'mcp.json')
  readonly cachePath = path.join(homeDir, '.pi', 'agent', 'mcp-cache.json')

  isAvailable(): boolean {
    return fs.existsSync(this.filePath)
  }

  getServers(): UnifiedMcpServer[] {
    const servers: UnifiedMcpServer[] = []
    if (!this.isAvailable()) return servers

    let cacheData: Record<string, CachedServerEntry | CachedToolItem[]> = {}
    if (fs.existsSync(this.cachePath)) {
      try {
        const raw = fs.readFileSync(this.cachePath, 'utf-8')
        const parsed = JSON.parse(raw)
        cacheData = parsed.servers || {}
      } catch (e) {
        console.error('[PiMcpProvider] Failed reading Pi mcp cache:', e)
      }
    }

    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'))
      const mcpServers = data.mcpServers || {}

      for (const [id, cfg] of Object.entries(mcpServers)) {
        const c = (cfg || {}) as {
          command?: string
          args?: string[]
          env?: Record<string, string>
          url?: string
          headers?: Record<string, string>
          type?: string
          disabled?: boolean
        }

        let type: McpServerType = 'stdio'
        if (c.url) {
          type = c.url.includes('/sse') ? 'sse' : 'http'
        } else if (c.type === 'sse') {
          type = 'sse'
        } else if (c.type === 'http') {
          type = 'http'
        }

        const serverEntry = cacheData[id]
        let rawTools: CachedToolItem[] = []
        let instructions: string | undefined

        if (Array.isArray(serverEntry)) {
          rawTools = serverEntry
        } else if (serverEntry && typeof serverEntry === 'object') {
          if (Array.isArray(serverEntry.tools)) {
            rawTools = serverEntry.tools
          }
          if (serverEntry.instructions) {
            instructions = serverEntry.instructions
          }
        }

        const tools: McpToolSchema[] = rawTools.map(t => ({
          name: t.name,
          description: t.description || '',
          inputSchema: t.inputSchema
        }))

        servers.push({
          id,
          name: id,
          platform: this.platform,
          platformName: this.platformName,
          type,
          command: c.command,
          args: c.args,
          env: c.env,
          url: c.url,
          headers: c.headers,
          disabled: false,
          configPath: this.filePath,
          toolsCount: tools.length,
          tools: tools.length > 0 ? tools : undefined,
          instructions
        })
      }
    } catch (e) {
      console.error('[PiMcpProvider] Failed reading Pi MCP config:', e)
    }

    return servers
  }
}
