import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { BaseJsonMcpProvider, parseJsonSafe } from './base-mcp-provider'
import type { UnifiedMcpServer, McpServerType } from '../mcp-manager-types'

interface ZCodeMcpServerItem {
  type?: 'stdio' | 'http' | 'sse' | 'local' | 'remote'
  command?: string | string[]
  args?: string[]
  url?: string
  headers?: Record<string, string>
  enabled?: boolean
  disabled?: boolean
  protocolVersion?: string
  [key: string]: unknown
}

interface ZCodeConfigFile {
  mcp?: {
    servers?: Record<string, ZCodeMcpServerItem>
    [key: string]: unknown
  }
  [key: string]: unknown
}

export class ZCodeMcpProvider extends BaseJsonMcpProvider {
  constructor() {
    const configPath = path.join(os.homedir(), '.zcode', 'cli', 'config.json')

    super({
      platform: 'zcode',
      platformName: 'ZCode',
      configPath,
      rootKey: 'mcp'
    })
  }

  override getServers(): UnifiedMcpServer[] {
    if (!this.isAvailable()) return []

    const servers: UnifiedMcpServer[] = []
    try {
      const raw = fs.readFileSync(this.configPath, 'utf-8')
      const data = parseJsonSafe(raw) as ZCodeConfigFile
      const serversObj = (data.mcp?.servers || {}) as Record<string, ZCodeMcpServerItem>

      for (const [id, cfg] of Object.entries(serversObj)) {
        if (!cfg || typeof cfg !== 'object') continue

        let type: McpServerType = 'stdio'
        if (cfg.type === 'sse' || (cfg.url && cfg.url.includes('/sse'))) {
          type = 'sse'
        } else if (cfg.type === 'http' || (cfg.url && !cfg.url.includes('/sse'))) {
          type = 'http'
        } else if (cfg.type === 'stdio' || cfg.type === 'local' || cfg.command) {
          type = 'stdio'
        }

        let command: string | undefined
        let args: string[] | undefined

        if (Array.isArray(cfg.command)) {
          command = cfg.command[0]
          args = cfg.command.slice(1)
        } else if (typeof cfg.command === 'string') {
          command = cfg.command
          args = cfg.args
        }

        let disabled = false
        if (cfg.disabled !== undefined) {
          disabled = Boolean(cfg.disabled)
        } else if (cfg.enabled !== undefined) {
          disabled = !cfg.enabled
        }

        servers.push({
          id,
          name: id,
          platform: this.platform,
          platformName: this.platformName,
          type,
          command,
          args,
          url: cfg.url,
          headers: cfg.headers,
          disabled,
          configPath: this.configPath,
          toolsCount: 0
        })
      }
    } catch (e) {
      console.error('[ZCodeMcpProvider] Failed reading ZCode config:', e)
    }

    return servers
  }

  override saveServer(server: Partial<UnifiedMcpServer> & { id: string }, isNew?: boolean): { success: boolean, message?: string } {
    const data = this.loadConfigData() as ZCodeConfigFile
    if (!data.mcp || typeof data.mcp !== 'object') {
      data.mcp = {}
    }
    if (!data.mcp.servers || typeof data.mcp.servers !== 'object') {
      data.mcp.servers = {}
    }

    const serversObj = data.mcp.servers as Record<string, ZCodeMcpServerItem>

    if (isNew && serversObj[server.id]) {
      return { success: false, message: `服务 ID '${server.id}' 在 ZCode 中已存在` }
    }

    const item: ZCodeMcpServerItem = {}
    if (server.type === 'stdio') {
      item.type = 'stdio'
      item.command = server.command || server.id
      item.args = server.args || []
    } else if (server.type === 'sse') {
      item.type = 'sse'
      item.url = server.url || ''
      if (server.headers && Object.keys(server.headers).length > 0) {
        item.headers = server.headers
      }
    } else {
      item.type = 'http'
      item.url = server.url || ''
      if (server.headers && Object.keys(server.headers).length > 0) {
        item.headers = server.headers
      }
    }

    if (server.disabled !== undefined) {
      item.enabled = !server.disabled
    }

    serversObj[server.id] = item
    return this.saveConfigData(data as Record<string, unknown>)
  }

  override deleteServer(id: string): { success: boolean, message?: string } {
    const data = this.loadConfigData() as ZCodeConfigFile
    const serversObj = data.mcp?.servers as Record<string, ZCodeMcpServerItem> | undefined
    if (!serversObj || !serversObj[id]) {
      return { success: false, message: `服务 ID '${id}' 未找到` }
    }

    Reflect.deleteProperty(serversObj, id)
    return this.saveConfigData(data as Record<string, unknown>)
  }

  override toggleServer(id: string, disabled: boolean): { success: boolean, message?: string } {
    const data = this.loadConfigData() as ZCodeConfigFile
    const serversObj = data.mcp?.servers as Record<string, ZCodeMcpServerItem> | undefined
    if (!serversObj || !serversObj[id]) {
      return { success: false, message: `服务 ID '${id}' 未找到` }
    }

    serversObj[id].enabled = !disabled
    Reflect.deleteProperty(serversObj[id], 'disabled')
    return this.saveConfigData(data as Record<string, unknown>)
  }
}
