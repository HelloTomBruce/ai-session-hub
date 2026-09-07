import fs from 'node:fs'
import os from 'node:os'
import type { UnifiedMcpServer, McpServerType } from '../mcp-manager-types'

export const homeDir = os.homedir()

export interface RawMcpServerItem {
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  type?: string
  disabled?: boolean
  autoApprove?: string[]
}

export interface McpProvider {
  readonly platform: string
  readonly platformName: string
  isAvailable(): boolean
  getServers(): UnifiedMcpServer[]
}

export interface JsonMcpProviderOptions {
  platform: string
  platformName: string
  configPath: string
  rootKey?: string // e.g. 'mcpServers' or 'mcp', default: 'mcpServers'
  defaultDisabled?: boolean
}

/**
 * Reusable base provider for any CLI or App storing MCP config in a JSON file
 * (e.g. Claude Code, WorkBuddy, OpenCode, Cursor, Cline, Roo Code, etc.)
 */
export class BaseJsonMcpProvider implements McpProvider {
  readonly platform: string
  readonly platformName: string
  readonly configPath: string
  readonly rootKey: string
  readonly defaultDisabled: boolean

  constructor(options: JsonMcpProviderOptions) {
    this.platform = options.platform
    this.platformName = options.platformName
    this.configPath = options.configPath
    this.rootKey = options.rootKey || 'mcpServers'
    this.defaultDisabled = Boolean(options.defaultDisabled)
  }

  isAvailable(): boolean {
    return fs.existsSync(this.configPath)
  }

  getServers(): UnifiedMcpServer[] {
    if (!this.isAvailable()) return []

    const servers: UnifiedMcpServer[] = []
    try {
      const raw = fs.readFileSync(this.configPath, 'utf-8')
      const data = JSON.parse(raw)
      const serversObj = (data[this.rootKey] || {}) as Record<string, RawMcpServerItem>

      for (const [id, cfg] of Object.entries(serversObj)) {
        if (!cfg || typeof cfg !== 'object') continue

        let type: McpServerType = 'stdio'
        if (cfg.url) {
          type = cfg.url.includes('/sse') || cfg.type === 'sse' ? 'sse' : 'http'
        } else if (cfg.type === 'sse') {
          type = 'sse'
        } else if (cfg.type === 'http') {
          type = 'http'
        }

        servers.push({
          id,
          name: id,
          platform: this.platform,
          platformName: this.platformName,
          type,
          command: cfg.command,
          args: cfg.args,
          env: cfg.env,
          url: cfg.url,
          headers: cfg.headers,
          disabled: cfg.disabled !== undefined ? Boolean(cfg.disabled) : this.defaultDisabled,
          configPath: this.configPath,
          toolsCount: 0
        })
      }
    } catch (e) {
      console.error(`[McpProvider:${this.platform}] Failed reading JSON config at ${this.configPath}:`, e)
    }

    return servers
  }
}
