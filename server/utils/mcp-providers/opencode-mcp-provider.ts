import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { BaseJsonMcpProvider, parseJsonSafe } from './base-mcp-provider'
import type { UnifiedMcpServer, McpServerType } from '../mcp-manager-types'

export class OpenCodeMcpProvider extends BaseJsonMcpProvider {
  constructor() {
    const jsoncPath = path.join(os.homedir(), '.config', 'opencode', 'opencode.jsonc')
    const jsonPath = path.join(os.homedir(), '.config', 'opencode', 'opencode.json')
    const resolvedPath = fs.existsSync(jsoncPath) ? jsoncPath : (fs.existsSync(jsonPath) ? jsonPath : jsoncPath)

    super({
      platform: 'opencode',
      platformName: 'OpenCode',
      configPath: resolvedPath,
      rootKey: 'mcp'
    })
  }

  override getServers(): UnifiedMcpServer[] {
    if (!this.isAvailable()) return []

    const servers: UnifiedMcpServer[] = []
    try {
      const raw = fs.readFileSync(this.configPath, 'utf-8')
      const data = parseJsonSafe(raw)
      const mcp = (data.mcp || {}) as Record<string, {
        type?: string
        command?: string | string[]
        args?: string[]
        url?: string
        headers?: Record<string, string>
        enabled?: boolean
        disabled?: boolean
      }>

      for (const [id, cfg] of Object.entries(mcp)) {
        if (!cfg || typeof cfg !== 'object') continue

        let type: McpServerType = 'stdio'
        if (cfg.url) {
          type = cfg.url.includes('/sse') ? 'sse' : 'http'
        } else if (cfg.type === 'remote') {
          type = cfg.url?.includes('/sse') ? 'sse' : 'http'
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
      console.error('[OpenCodeMcpProvider] Failed reading OpenCode config:', e)
    }

    return servers
  }

  override saveServer(server: Partial<UnifiedMcpServer> & { id: string }, isNew?: boolean): { success: boolean, message?: string } {
    const data = this.loadConfigData()
    if (!data.mcp || typeof data.mcp !== 'object') {
      data.mcp = {}
    }

    const mcpObj = data.mcp as Record<string, Record<string, unknown>>

    if (isNew && mcpObj[server.id]) {
      return { success: false, message: `服务 ID '${server.id}' 在 OpenCode 中已存在` }
    }

    const item: Record<string, unknown> = {}
    if (server.type === 'stdio') {
      item.type = 'local'
      const cmdArr = [server.command || server.id, ...(server.args || [])]
      item.command = cmdArr
    } else {
      item.type = 'remote'
      item.url = server.url || ''
      if (server.headers && Object.keys(server.headers).length > 0) {
        item.headers = server.headers
      }
    }

    if (server.disabled !== undefined) {
      item.enabled = !server.disabled
    }

    mcpObj[server.id] = item
    return this.saveConfigData(data)
  }

  override toggleServer(id: string, disabled: boolean): { success: boolean, message?: string } {
    const data = this.loadConfigData()
    const mcpObj = (data.mcp || {}) as Record<string, Record<string, unknown>>
    if (!mcpObj[id]) {
      return { success: false, message: `服务 ID '${id}' 未找到` }
    }

    mcpObj[id].enabled = !disabled
    Reflect.deleteProperty(mcpObj[id], 'disabled')
    return this.saveConfigData(data)
  }
}
