import path from 'node:path'
import type { McpProvider, McpConfigFileInfo } from './base-mcp-provider'
import { BaseJsonMcpProvider, homeDir } from './base-mcp-provider'
import { PiMcpProvider } from './pi-mcp-provider'
import { ReasonixMcpProvider } from './reasonix-mcp-provider'
import { AgyMcpProvider } from './agy-mcp-provider'
import { HubMcpProvider } from './hub-mcp-provider'
import type { UnifiedMcpServer, McpStats, McpServerDetailResponse } from '../mcp-manager-types'

export class McpProviderRegistry {
  private providers = new Map<string, McpProvider>()

  register(provider: McpProvider): this {
    this.providers.set(provider.platform, provider)
    return this
  }

  unregister(platform: string): boolean {
    return this.providers.delete(platform)
  }

  get(platform: string): McpProvider | undefined {
    return this.providers.get(platform)
  }

  getAllProviders(): McpProvider[] {
    return Array.from(this.providers.values())
  }

  scanAllServers(): UnifiedMcpServer[] {
    const list: UnifiedMcpServer[] = []

    for (const provider of this.providers.values()) {
      if (provider.isAvailable()) {
        try {
          list.push(...provider.getServers())
        } catch (e) {
          console.error(`[McpProviderRegistry] Error scanning servers from ${provider.platform}:`, e)
        }
      }
    }

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
      all: all.length
    }
    const protocolCounts: Record<string, number> = {
      all: all.length,
      stdio: 0,
      sse: 0,
      http: 0,
      directory: 0
    }

    // Initialize provider counts
    for (const p of this.providers.values()) {
      counts[p.platform] = 0
    }

    const uniqueIds = new Set<string>()

    for (const s of all) {
      uniqueIds.add(s.id)
      counts[s.platform] = (counts[s.platform] || 0) + 1
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

    // Generate JSON snippet (for Pi/Claude/WorkBuddy/OpenCode)
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
      rawConfig: jsonConfig,
      configSnippets: {
        json: JSON.stringify(jsonConfig, null, 2),
        toml: tomlConfig
      }
    }
  }

  getAllConfigs(): McpConfigFileInfo[] {
    const configs: McpConfigFileInfo[] = []
    for (const provider of this.providers.values()) {
      if (provider.getRawConfig) {
        const cfg = provider.getRawConfig()
        if (cfg) configs.push(cfg)
      }
    }
    return configs
  }

  getConfigByPlatform(platform: string): McpConfigFileInfo | null {
    const provider = this.providers.get(platform)
    if (!provider || !provider.getRawConfig) return null
    return provider.getRawConfig()
  }

  saveConfig(platform: string, content: string): { success: boolean, message?: string } {
    const provider = this.providers.get(platform)
    if (!provider) {
      return { success: false, message: `平台 '${platform}' 不存在` }
    }
    if (!provider.saveRawConfig) {
      return { success: false, message: `平台 '${provider.platformName}' 不支持直接编辑配置文件` }
    }
    return provider.saveRawConfig(content)
  }

  saveServer(platform: string, server: Partial<UnifiedMcpServer> & { id: string }, isNew?: boolean): { success: boolean, message?: string } {
    const provider = this.providers.get(platform)
    if (!provider) {
      return { success: false, message: `平台 '${platform}' 不存在` }
    }
    if (!provider.saveServer) {
      return { success: false, message: `平台 '${provider.platformName}' 暂不支持保存服务对象` }
    }
    return provider.saveServer(server, isNew)
  }

  deleteServer(platform: string, id: string): { success: boolean, message?: string } {
    const provider = this.providers.get(platform)
    if (!provider) {
      return { success: false, message: `平台 '${platform}' 不存在` }
    }
    if (!provider.deleteServer) {
      return { success: false, message: `平台 '${provider.platformName}' 暂不支持删除服务` }
    }
    return provider.deleteServer(id)
  }

  toggleServer(platform: string, id: string, disabled: boolean): { success: boolean, message?: string } {
    const provider = this.providers.get(platform)
    if (!provider) {
      return { success: false, message: `平台 '${platform}' 不存在` }
    }
    if (!provider.toggleServer) {
      return { success: false, message: `平台 '${provider.platformName}' 暂不支持启停服务` }
    }
    return provider.toggleServer(id, disabled)
  }
}

export const mcpRegistry = new McpProviderRegistry()

// Register default providers
mcpRegistry
  .register(new HubMcpProvider())
  .register(new PiMcpProvider())
  .register(new BaseJsonMcpProvider({
    platform: 'claude',
    platformName: 'Claude Code',
    configPath: path.join(homeDir, '.claude.json'),
    rootKey: 'mcpServers'
  }))
  .register(new BaseJsonMcpProvider({
    platform: 'workbuddy',
    platformName: 'WorkBuddy',
    configPath: path.join(homeDir, '.workbuddy', 'mcp.json'),
    rootKey: 'mcpServers'
  }))
  .register(new ReasonixMcpProvider())
  .register(new AgyMcpProvider())
  .register(new BaseJsonMcpProvider({
    platform: 'opencode',
    platformName: 'OpenCode',
    configPath: path.join(homeDir, '.config', 'opencode', 'opencode.json'),
    rootKey: 'mcp'
  }))
