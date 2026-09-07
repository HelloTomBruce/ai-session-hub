import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { UnifiedMcpServer, McpServerDetailResponse, McpStats, McpServerType, McpToolSchema } from './mcp-manager-types'

const homeDir = os.homedir()

interface RawServerConfig {
  command?: string
  args?: string[]
  url?: string
  headers?: Record<string, string>
  type?: string
  disabled?: boolean
}

interface CachedToolItem {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export class McpManagerService {
  private getPiServers(): UnifiedMcpServer[] {
    const filePath = path.join(homeDir, '.pi', 'agent', 'mcp.json')
    const cachePath = path.join(homeDir, '.pi', 'agent', 'mcp-cache.json')
    const servers: UnifiedMcpServer[] = []

    if (!fs.existsSync(filePath)) return servers

    let cacheData: Record<string, { tools?: CachedToolItem[] }> = {}
    if (fs.existsSync(cachePath)) {
      try {
        cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf-8')).servers || {}
      } catch (e) {
        void e
      }
    }

    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      const mcpServers: Record<string, RawServerConfig> = data.mcpServers || {}

      for (const [id, cfg] of Object.entries(mcpServers)) {
        const c = cfg
        let type: McpServerType = 'stdio'
        if (c.url) {
          type = c.url.includes('/sse') ? 'sse' : 'http'
        } else if (c.type === 'sse') {
          type = 'sse'
        } else if (c.type === 'http') {
          type = 'http'
        }

        const cachedTools = cacheData[id]?.tools || []
        const tools: McpToolSchema[] = cachedTools.map(t => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema
        }))

        servers.push({
          id,
          name: id,
          platform: 'pi',
          platformName: 'Pi CLI',
          type,
          command: c.command,
          args: c.args,
          url: c.url,
          headers: c.headers,
          disabled: c.disabled || false,
          configPath: filePath,
          toolsCount: tools.length,
          tools: tools.length ? tools : undefined
        })
      }
    } catch (e) {
      console.error('Failed reading Pi MCP config:', e)
    }

    return servers
  }

  private getWorkBuddyServers(): UnifiedMcpServer[] {
    const filePath = path.join(homeDir, '.workbuddy', 'mcp.json')
    const servers: UnifiedMcpServer[] = []

    if (!fs.existsSync(filePath)) return servers

    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      const mcpServers = data.mcpServers || {}

      for (const [id, cfg] of Object.entries(mcpServers)) {
        const c = cfg as RawServerConfig
        let type: McpServerType = 'stdio'
        if (c.url) {
          type = c.url.includes('/sse') ? 'sse' : 'http'
        } else if (c.type === 'sse') {
          type = 'sse'
        } else if (c.type === 'http') {
          type = 'http'
        }

        servers.push({
          id,
          name: id,
          platform: 'workbuddy',
          platformName: 'WorkBuddy',
          type,
          command: c.command,
          args: c.args,
          url: c.url,
          headers: c.headers,
          disabled: Boolean(c.disabled),
          configPath: filePath,
          toolsCount: 0
        })
      }
    } catch (e) {
      console.error('Failed reading WorkBuddy MCP config:', e)
    }

    return servers
  }

  private getClaudeServers(): UnifiedMcpServer[] {
    const filePath = path.join(homeDir, '.claude.json')
    const servers: UnifiedMcpServer[] = []

    if (!fs.existsSync(filePath)) return servers

    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      const mcpServers = data.mcpServers || {}

      for (const [id, cfg] of Object.entries(mcpServers)) {
        const c = cfg as RawServerConfig
        let type: McpServerType = 'stdio'
        if (c.url) {
          type = c.url.includes('/sse') || c.type === 'sse' ? 'sse' : 'http'
        } else if (c.type === 'sse') {
          type = 'sse'
        } else if (c.type === 'http') {
          type = 'http'
        }

        servers.push({
          id,
          name: id,
          platform: 'claude',
          platformName: 'Claude Code',
          type,
          command: c.command,
          args: c.args,
          url: c.url,
          headers: c.headers,
          disabled: false,
          configPath: filePath,
          toolsCount: 0
        })
      }
    } catch (e) {
      console.error('Failed reading Claude Code MCP config:', e)
    }

    return servers
  }

  private getReasonixServers(): UnifiedMcpServer[] {
    const filePath = path.join(homeDir, '.reasonix', 'config.toml')
    const servers: UnifiedMcpServer[] = []

    if (!fs.existsSync(filePath)) return servers

    try {
      const toml = fs.readFileSync(filePath, 'utf-8')
      const blocks = toml.split('[[plugins]]')

      for (let i = 1; i < blocks.length; i++) {
        const block = blocks[i]
        const lines = block.split('\n')

        let name = ''
        let command = ''
        let args: string[] = []
        let url = ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed.startsWith('#') || !trimmed) continue
          if (trimmed.startsWith('[')) break // new section

          const nameMatch = trimmed.match(/^name\s*=\s*"([^"]+)"/)
          if (nameMatch) name = nameMatch[1]

          const cmdMatch = trimmed.match(/^command\s*=\s*"([^"]+)"/)
          if (cmdMatch) command = cmdMatch[1]

          const urlMatch = trimmed.match(/^url\s*=\s*"([^"]+)"/)
          if (urlMatch) url = urlMatch[1]

          const argsMatch = trimmed.match(/^args\s*=\s*\[(.*)\]/)
          if (argsMatch) {
            try {
              args = JSON.parse(`[${argsMatch[1]}]`)
            } catch (e) {
              void e
            }
          }
        }

        if (name || command || url) {
          const id = name || (command ? path.basename(command) : 'reasonix-plugin')
          let type: McpServerType = 'stdio'
          if (url) {
            type = url.includes('/sse') ? 'sse' : 'http'
          }

          servers.push({
            id,
            name: id,
            platform: 'reasonix',
            platformName: 'Reasonix',
            type,
            command: command || undefined,
            args: args.length ? args : undefined,
            url: url || undefined,
            disabled: false,
            configPath: filePath,
            toolsCount: 0
          })
        }
      }
    } catch (e) {
      console.error('Failed reading Reasonix MCP config:', e)
    }

    return servers
  }

  private getAgyServers(): UnifiedMcpServer[] {
    const mcpDir = path.join(homeDir, '.gemini', 'antigravity-cli', 'mcp')
    const servers: UnifiedMcpServer[] = []

    if (!fs.existsSync(mcpDir)) return servers

    try {
      const entries = fs.readdirSync(mcpDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue
        const fullDir = path.join(mcpDir, entry.name)
        const files = fs.readdirSync(fullDir)

        const tools: McpToolSchema[] = []
        let instructions = ''

        for (const file of files) {
          if (file === 'instructions.md') {
            try {
              instructions = fs.readFileSync(path.join(fullDir, file), 'utf-8')
            } catch (e) {
              void e
            }
          } else if (file.endsWith('.json')) {
            try {
              const toolDef = JSON.parse(fs.readFileSync(path.join(fullDir, file), 'utf-8'))
              tools.push({
                name: toolDef.name || file.replace('.json', ''),
                description: toolDef.description,
                inputSchema: toolDef.inputSchema || toolDef.parameters
              })
            } catch (e) {
              void e
            }
          }
        }

        servers.push({
          id: entry.name,
          name: entry.name,
          platform: 'agy',
          platformName: 'AGY CLI',
          type: 'directory',
          disabled: false,
          configPath: fullDir,
          toolsCount: tools.length,
          tools,
          instructions: instructions || undefined
        })
      }
    } catch (e) {
      console.error('Failed reading AGY MCP schemas:', e)
    }

    return servers
  }

  private getOpenCodeServers(): UnifiedMcpServer[] {
    const filePath = path.join(homeDir, '.config', 'opencode', 'opencode.json')
    const servers: UnifiedMcpServer[] = []

    if (!fs.existsSync(filePath)) return servers

    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      const mcp = data.mcp || {}

      for (const [id, cfg] of Object.entries(mcp)) {
        const c = cfg as RawServerConfig
        let type: McpServerType = 'stdio'
        if (c.url) {
          type = c.url.includes('/sse') ? 'sse' : 'http'
        }

        servers.push({
          id,
          name: id,
          platform: 'opencode',
          platformName: 'OpenCode',
          type,
          command: c.command,
          args: c.args,
          url: c.url,
          disabled: false,
          configPath: filePath,
          toolsCount: 0
        })
      }
    } catch (e) {
      console.error('Failed reading OpenCode MCP config:', e)
    }

    return servers
  }

  private getHubServer(): UnifiedMcpServer {
    return {
      id: 'ai-session-hub-mcp',
      name: 'AI Session Hub (内置服务)',
      platform: 'hub',
      platformName: 'Session Hub',
      type: 'sse',
      url: 'http://localhost:3000/api/mcp/sse',
      disabled: false,
      configPath: 'server/utils/mcp-server-instance.ts',
      toolsCount: 4,
      tools: [
        {
          name: 'list_sessions',
          description: '列出本地由 AI Session Hub 管理的所有 CLI 和 App 历史会话'
        },
        {
          name: 'get_session_details',
          description: '获取指定会话的完整对话历史记录、思考链路与工具调用数据'
        },
        {
          name: 'distill_sessions',
          description: '对选定会话进行多维分析提炼，生成结构化知识总结'
        },
        {
          name: 'get_stats',
          description: '获取各 CLI/App 会话与技能宏观统计指标'
        }
      ]
    }
  }

  private scanAllServers(): UnifiedMcpServer[] {
    const list: UnifiedMcpServer[] = [
      this.getHubServer(),
      ...this.getPiServers(),
      ...this.getClaudeServers(),
      ...this.getWorkBuddyServers(),
      ...this.getReasonixServers(),
      ...this.getAgyServers(),
      ...this.getOpenCodeServers()
    ]

    // Cross-platform sharing mapping
    for (const s of list) {
      const peers = list.filter(item => item !== s && (item.id === s.id || (item.url && item.url === s.url)))
      if (peers.length > 0) {
        s.sharedWith = Array.from(new Set(peers.map(p => p.platform)))
      }
    }

    return list
  }

  getAllServers(platformFilter?: string, protocolFilter?: string, query?: string): { servers: UnifiedMcpServer[], stats: McpStats } {
    const all = this.scanAllServers()
    const counts: Record<string, number> = {
      all: all.length,
      pi: 0,
      claude: 0,
      workbuddy: 0,
      reasonix: 0,
      agy: 0,
      opencode: 0,
      hub: 0
    }
    const protocolCounts: Record<string, number> = {
      all: all.length,
      stdio: 0,
      sse: 0,
      http: 0,
      directory: 0
    }

    const uniqueIds = new Set<string>()

    for (const s of all) {
      uniqueIds.add(s.id)
      if (counts[s.platform] !== undefined) counts[s.platform]++
      if (protocolCounts[s.type] !== undefined) protocolCounts[s.type]++
    }

    let filtered = all
    if (platformFilter && platformFilter !== 'all') {
      filtered = filtered.filter(s => s.platform === platformFilter)
    }

    if (protocolFilter && protocolFilter !== 'all') {
      filtered = filtered.filter(s => s.type === protocolFilter)
    }

    if (query && query.trim()) {
      const q = query.toLowerCase().trim()
      filtered = filtered.filter(s =>
        s.name.toLowerCase().includes(q)
        || s.id.toLowerCase().includes(q)
        || (s.command && s.command.toLowerCase().includes(q))
        || (s.url && s.url.toLowerCase().includes(q))
        || (s.tools && s.tools.some(t => t.name.toLowerCase().includes(q) || (t.description && t.description.toLowerCase().includes(q))))
      )
    }

    return {
      servers: filtered,
      stats: {
        total: all.length,
        uniqueCount: uniqueIds.size,
        counts,
        protocolCounts
      }
    }
  }

  getServerDetail(platform: string, id: string): McpServerDetailResponse | null {
    const all = this.scanAllServers()
    const found = all.find(s => s.id === id && (platform === 'all' || s.platform === platform)) || null
    if (!found) return null

    // Generate JSON snippet (for Pi/Claude/WorkBuddy)
    const jsonConfig: Record<string, unknown> = {}
    if (found.type === 'stdio') {
      jsonConfig[found.id] = {
        command: found.command || found.id,
        args: found.args || [],
        type: 'local'
      }
    } else {
      jsonConfig[found.id] = {
        url: found.url || '',
        headers: found.headers || undefined
      }
    }

    // Generate TOML snippet (for Reasonix)
    let tomlConfig = `[[plugins]]\nname = "${found.id}"`
    if (found.command) {
      tomlConfig += `\ncommand = "${found.command}"`
      if (found.args && found.args.length) {
        tomlConfig += `\nargs = ${JSON.stringify(found.args)}`
      }
    }
    if (found.url) {
      tomlConfig += `\nurl = "${found.url}"`
    }

    return {
      server: found,
      rawConfig: jsonConfig[found.id] || {},
      configSnippets: {
        json: JSON.stringify(jsonConfig, null, 2),
        toml: tomlConfig
      }
    }
  }

  getStats(): McpStats {
    return this.getAllServers().stats
  }
}

export const mcpManagerService = new McpManagerService()
