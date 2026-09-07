import fs from 'node:fs'
import path from 'node:path'
import type { McpProvider } from './base-mcp-provider'
import { homeDir } from './base-mcp-provider'
import type { UnifiedMcpServer, McpServerType } from '../mcp-manager-types'

export class ReasonixMcpProvider implements McpProvider {
  readonly platform = 'reasonix'
  readonly platformName = 'Reasonix'
  readonly filePath = path.join(homeDir, '.reasonix', 'config.toml')

  isAvailable(): boolean {
    return fs.existsSync(this.filePath)
  }

  getServers(): UnifiedMcpServer[] {
    const servers: UnifiedMcpServer[] = []
    if (!this.isAvailable()) return servers

    try {
      const content = fs.readFileSync(this.filePath, 'utf-8')
      const pluginBlocks = content.split('[[plugins]]').slice(1)

      for (const block of pluginBlocks) {
        const lines = block.split('\n')
        let name = ''
        let command = ''
        let args: string[] = []
        let url = ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed.startsWith('name =')) {
            name = trimmed.replace('name =', '').trim().replace(/^['"]|['"]$/g, '')
          } else if (trimmed.startsWith('command =')) {
            command = trimmed.replace('command =', '').trim().replace(/^['"]|['"]$/g, '')
          } else if (trimmed.startsWith('url =')) {
            url = trimmed.replace('url =', '').trim().replace(/^['"]|['"]$/g, '')
          } else if (trimmed.startsWith('args =')) {
            try {
              const arrayPart = trimmed.substring(trimmed.indexOf('=') + 1).trim()
              args = JSON.parse(arrayPart)
            } catch {
              // ignore parse errors
            }
          }
        }

        if (name) {
          let type: McpServerType = 'stdio'
          if (url) {
            type = url.includes('/sse') ? 'sse' : 'http'
          }

          servers.push({
            id: name,
            name,
            platform: this.platform,
            platformName: this.platformName,
            type,
            command: command || undefined,
            args: args.length > 0 ? args : undefined,
            url: url || undefined,
            disabled: false,
            configPath: this.filePath,
            toolsCount: 0
          })
        }
      }
    } catch (e) {
      console.error('[ReasonixMcpProvider] Failed reading Reasonix TOML config:', e)
    }

    return servers
  }
}
