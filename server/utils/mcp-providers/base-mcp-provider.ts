import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { UnifiedMcpServer, McpServerType } from '../mcp-manager-types'

const homeDir = os.homedir()

export function parseJsonSafe(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw)
  } catch {
    // Strip comments for JSONC files
    const stripped = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/(?<=[,{[])\s*\/\/[^\n]*/g, '')
      .replace(/,\s*([\]}])/g, '$1')
    return JSON.parse(stripped)
  }
}

export interface RawMcpServerItem {
  command?: string | string[]
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  type?: string
  disabled?: boolean
  enabled?: boolean
  autoApprove?: string[]
}

export interface McpConfigFileInfo {
  platform: string
  platformName: string
  path: string
  content: string
  format: 'json' | 'toml' | 'directory'
  isAvailable: boolean
}

export interface McpProvider {
  readonly platform: string
  readonly platformName: string
  readonly configPath?: string
  isAvailable(): boolean
  getServers(): UnifiedMcpServer[]
  getRawConfig?(): McpConfigFileInfo | null
  saveRawConfig?(content: string): { success: boolean, message?: string }
  saveServer?(server: Partial<UnifiedMcpServer> & { id: string }, isNew?: boolean): { success: boolean, message?: string }
  deleteServer?(id: string): { success: boolean, message?: string }
  toggleServer?(id: string, disabled: boolean): { success: boolean, message?: string }
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
      const data = parseJsonSafe(raw)
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

        let command: string | undefined
        let args: string[] | undefined

        if (Array.isArray(cfg.command)) {
          command = cfg.command[0]
          args = cfg.command.slice(1)
        } else if (typeof cfg.command === 'string') {
          command = cfg.command
          args = cfg.args
        }

        let disabled = this.defaultDisabled
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
          env: cfg.env,
          url: cfg.url,
          headers: cfg.headers,
          disabled,
          configPath: this.configPath,
          toolsCount: 0
        })
      }
    } catch (e) {
      console.error(`[McpProvider:${this.platform}] Failed reading JSON config at ${this.configPath}:`, e)
    }

    return servers
  }

  getRawConfig(): McpConfigFileInfo {
    const isAvailable = this.isAvailable()
    let content = ''
    if (isAvailable) {
      try {
        content = fs.readFileSync(this.configPath, 'utf-8')
      } catch (e) {
        console.error(`[McpProvider:${this.platform}] Failed reading raw config:`, e)
      }
    } else {
      content = JSON.stringify({ [this.rootKey]: {} }, null, 2)
    }

    return {
      platform: this.platform,
      platformName: this.platformName,
      path: this.configPath,
      content,
      format: 'json',
      isAvailable
    }
  }

  saveRawConfig(content: string): { success: boolean, message?: string } {
    try {
      const parsed = parseJsonSafe(content)
      const dir = path.dirname(this.configPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(this.configPath, JSON.stringify(parsed, null, 2), 'utf-8')
      return { success: true }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { success: false, message: 'JSON 格式解析错误: ' + msg }
    }
  }

  protected loadConfigData(): Record<string, unknown> {
    if (this.isAvailable()) {
      try {
        return parseJsonSafe(fs.readFileSync(this.configPath, 'utf-8'))
      } catch {
        return { [this.rootKey]: {} }
      }
    }
    return { [this.rootKey]: {} }
  }

  protected saveConfigData(data: Record<string, unknown>): { success: boolean, message?: string } {
    try {
      const dir = path.dirname(this.configPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(this.configPath, JSON.stringify(data, null, 2), 'utf-8')
      return { success: true }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { success: false, message: '写入配置文件失败: ' + msg }
    }
  }

  saveServer(server: Partial<UnifiedMcpServer> & { id: string }, isNew?: boolean): { success: boolean, message?: string } {
    const data = this.loadConfigData()
    if (!data[this.rootKey] || typeof data[this.rootKey] !== 'object') {
      data[this.rootKey] = {}
    }

    const serversObj = data[this.rootKey] as Record<string, RawMcpServerItem>

    if (isNew && serversObj[server.id]) {
      return { success: false, message: `服务 ID '${server.id}' 在 ${this.platformName} 中已存在` }
    }

    const item: RawMcpServerItem = {}
    if (server.type === 'stdio') {
      item.command = server.command || server.id
      item.args = server.args || []
      if (server.type === 'stdio' && this.platform !== 'opencode') {
        item.type = 'local'
      }
    } else {
      item.url = server.url || ''
      if (server.headers && Object.keys(server.headers).length > 0) {
        item.headers = server.headers
      }
      if (server.type === 'sse') {
        item.type = 'sse'
      }
    }

    if (server.disabled !== undefined) {
      item.disabled = Boolean(server.disabled)
    }

    serversObj[server.id] = item
    return this.saveConfigData(data)
  }

  deleteServer(id: string): { success: boolean, message?: string } {
    const data = this.loadConfigData()
    const serversObj = (data[this.rootKey] || {}) as Record<string, RawMcpServerItem>
    if (!serversObj[id]) {
      return { success: false, message: `服务 ID '${id}' 未找到` }
    }

    Reflect.deleteProperty(serversObj, id)
    return this.saveConfigData(data)
  }

  toggleServer(id: string, disabled: boolean): { success: boolean, message?: string } {
    const data = this.loadConfigData()
    const serversObj = (data[this.rootKey] || {}) as Record<string, RawMcpServerItem>
    if (!serversObj[id]) {
      return { success: false, message: `服务 ID '${id}' 未找到` }
    }

    serversObj[id].disabled = disabled
    return this.saveConfigData(data)
  }
}
