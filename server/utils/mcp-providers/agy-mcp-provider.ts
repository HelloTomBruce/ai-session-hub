import fs from 'node:fs'
import path from 'node:path'
import type { McpProvider } from './base-mcp-provider'
import { homeDir } from './base-mcp-provider'
import type { UnifiedMcpServer, McpToolSchema } from '../mcp-manager-types'

export class AgyMcpProvider implements McpProvider {
  readonly platform = 'agy'
  readonly platformName = 'AGY CLI'
  readonly baseDir = path.join(homeDir, '.gemini', 'antigravity-cli', 'mcp')

  isAvailable(): boolean {
    return fs.existsSync(this.baseDir)
  }

  getServers(): UnifiedMcpServer[] {
    const servers: UnifiedMcpServer[] = []
    if (!this.isAvailable()) return servers

    try {
      const entries = fs.readdirSync(this.baseDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue
        const serverDir = path.join(this.baseDir, entry.name)
        const toolFiles = fs.readdirSync(serverDir).filter(f => f.endsWith('.json'))
        const tools: McpToolSchema[] = []

        for (const tf of toolFiles) {
          try {
            const raw = fs.readFileSync(path.join(serverDir, tf), 'utf-8')
            const parsed = JSON.parse(raw)
            tools.push({
              name: parsed.name || tf.replace('.json', ''),
              description: parsed.description || '',
              inputSchema: parsed.parameters || parsed.inputSchema
            })
          } catch {
            // ignore schema error
          }
        }

        const instrPath = path.join(serverDir, 'instructions.md')
        const hasInstructions = fs.existsSync(instrPath)

        servers.push({
          id: entry.name,
          name: entry.name,
          platform: this.platform,
          platformName: this.platformName,
          type: 'directory',
          disabled: false,
          configPath: serverDir,
          toolsCount: tools.length,
          tools: tools.length > 0 ? tools : undefined,
          instructions: hasInstructions ? fs.readFileSync(instrPath, 'utf-8') : undefined
        })
      }
    } catch (e) {
      console.error('[AgyMcpProvider] Failed reading AGY MCP directory:', e)
    }

    return servers
  }
}
