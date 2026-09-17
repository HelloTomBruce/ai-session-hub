import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import type { SessionPlugin, PluginStatusInfo, TemplateJsonlConfig, TemplateSqliteConfig } from './plugin-types'
import type { UnifiedSession, SessionMessage, CreateSessionPayload, UpdateSessionPayload, PlatformType } from './types'
import { TemplateJsonlPlugin } from './plugins/template-jsonl-plugin'
import { TemplateSqlitePlugin } from './plugins/template-sqlite-plugin'

// Builtin / Standard Plugin Packages
import { PiPlugin } from '@session-hub/plugin-pi'
import { ClaudePlugin } from '@session-hub/plugin-claude'
import { OpenCodePlugin } from '@session-hub/plugin-opencode'
import { CodexPlugin } from '@session-hub/plugin-codex'
import { AgyPlugin } from '@session-hub/plugin-agy'
import { WorkBuddyPlugin } from '@session-hub/plugin-workbuddy'

const HUB_DIR = path.join(os.homedir(), '.session-hub')
const PLUGINS_DIR = path.join(HUB_DIR, 'plugins')
const PLUGINS_CONFIG_PATH = path.join(HUB_DIR, 'plugins-config.json')

export class PluginManager {
  private plugins = new Map<string, SessionPlugin>()
  private enabledStates = new Map<string, boolean>()
  private initialized = false

  constructor() {
    this.initBuiltinPlugins()
    this.initSync()
  }

  /**
   * 初始化标准插件包
   */
  private initBuiltinPlugins() {
    this.register(new PiPlugin())
    this.register(new ClaudePlugin())
    this.register(new OpenCodePlugin())
    this.register(new CodexPlugin())
    this.register(new AgyPlugin())
    this.register(new WorkBuddyPlugin())
  }

  /**
   * 注册插件
   */
  register(plugin: SessionPlugin): this {
    this.plugins.set(plugin.manifest.id, plugin)
    if (!this.enabledStates.has(plugin.manifest.id)) {
      this.enabledStates.set(plugin.manifest.id, plugin.manifest.defaultEnabled !== false)
    }
    return this
  }

  /**
   * 同步初始化配置与基础环境
   */
  private initSync() {
    try {
      if (!fs.existsSync(PLUGINS_DIR)) {
        fs.mkdirSync(PLUGINS_DIR, { recursive: true })
      }
      this.loadConfig()
      this.loadDeclarativeJsonPluginsSync()
    } catch (err) {
      console.error('[PluginManager] Error during sync init:', err)
    }
  }

  /**
   * 同步载入 ~/.session-hub/plugins/ 目录下的声明式 JSON 配置
   */
  private loadDeclarativeJsonPluginsSync() {
    if (!fs.existsSync(PLUGINS_DIR)) return
    try {
      const files = fs.readdirSync(PLUGINS_DIR)
      for (const file of files) {
        if (file.endsWith('.json') && file !== 'plugins-config.json') {
          const fullPath = path.join(PLUGINS_DIR, file)
          try {
            const raw = fs.readFileSync(fullPath, 'utf-8')
            const cfg = JSON.parse(raw) as Record<string, unknown>
            if (cfg.id && typeof cfg.id === 'string') {
              if (cfg.type === 'template-sqlite' || cfg.dbPath) {
                const plugin = new TemplateSqlitePlugin(cfg as unknown as TemplateSqliteConfig)
                this.register(plugin)
              } else if (cfg.type === 'template-jsonl' || cfg.baseDir) {
                const plugin = new TemplateJsonlPlugin(cfg as unknown as TemplateJsonlConfig)
                this.register(plugin)
              }
            }
          } catch (e) {
            console.error(`[PluginManager] Error loading JSON plugin ${file}:`, e)
          }
        }
      }
    } catch (err) {
      console.error('[PluginManager] Error scanning JSON plugins:', err)
    }
  }

  /**
   * 初始化外部插件与配置
   */
  async init(): Promise<void> {
    if (this.initialized) return

    try {
      if (!fs.existsSync(PLUGINS_DIR)) {
        fs.mkdirSync(PLUGINS_DIR, { recursive: true })
      }

      this.loadConfig()
      await this.loadExternalPlugins()
      this.initialized = true
    } catch (err) {
      console.error('[PluginManager] Error initializing plugin system:', err)
    }
  }

  /**
   * 从 ~/.session-hub/plugins-config.json 加载插件开关状态
   */
  private loadConfig() {
    if (fs.existsSync(PLUGINS_CONFIG_PATH)) {
      try {
        const raw = fs.readFileSync(PLUGINS_CONFIG_PATH, 'utf-8')
        const data = JSON.parse(raw) as { enabled?: Record<string, boolean> }
        if (data.enabled && typeof data.enabled === 'object') {
          for (const [id, val] of Object.entries(data.enabled)) {
            this.enabledStates.set(id, Boolean(val))
          }
        }
      } catch (err) {
        console.error('[PluginManager] Failed to read plugins-config.json:', err)
      }
    }
  }

  /**
   * 保存插件开关状态
   */
  private saveConfig() {
    try {
      if (!fs.existsSync(HUB_DIR)) {
        fs.mkdirSync(HUB_DIR, { recursive: true })
      }
      const enabled: Record<string, boolean> = {}
      for (const [id, val] of this.enabledStates.entries()) {
        enabled[id] = val
      }
      fs.writeFileSync(PLUGINS_CONFIG_PATH, JSON.stringify({ enabled }, null, 2), 'utf-8')
    } catch (err) {
      console.error('[PluginManager] Failed to save plugins-config.json:', err)
    }
  }

  /**
   * 解析 npm 插件包的真实入口文件路径
   */
  private resolvePackageEntry(pkgDir: string, pkgJson: Record<string, unknown>): string | null {
    // 1. 检查 exports
    if (pkgJson.exports) {
      if (typeof pkgJson.exports === 'string') {
        return path.resolve(pkgDir, pkgJson.exports)
      }
      if (typeof pkgJson.exports === 'object' && pkgJson.exports !== null) {
        const exportsObj = pkgJson.exports as Record<string, unknown>
        const dotEntry = exportsObj['.']
        if (typeof dotEntry === 'string') {
          return path.resolve(pkgDir, dotEntry)
        }
        if (typeof dotEntry === 'object' && dotEntry !== null) {
          const dotObj = dotEntry as Record<string, unknown>
          const candidate = (dotObj.import || dotObj.default || dotObj.node || dotObj.require) as string | undefined
          if (candidate && typeof candidate === 'string') {
            return path.resolve(pkgDir, candidate)
          }
        }
      }
    }

    // 2. 检查 module 或 main 字段
    if (typeof pkgJson.module === 'string') {
      return path.resolve(pkgDir, pkgJson.module)
    }
    if (typeof pkgJson.main === 'string') {
      return path.resolve(pkgDir, pkgJson.main)
    }

    // 3. 常见默认入口探查
    const defaultCandidates = ['dist/index.js', 'dist/index.mjs', 'index.js', 'index.mjs']
    for (const cand of defaultCandidates) {
      const full = path.resolve(pkgDir, cand)
      if (fs.existsSync(full)) {
        return full
      }
    }

    return null
  }

  /**
   * 动态加载 ~/.session-hub/plugins/ 目录下的声明式与外部插件
   */
  async loadExternalPlugins(): Promise<void> {
    if (!fs.existsSync(PLUGINS_DIR)) return

    try {
      const files = fs.readdirSync(PLUGINS_DIR)
      const ts = Date.now()

      for (const file of files) {
        const fullPath = path.join(PLUGINS_DIR, file)

        // 1. 声明式 JSON 插件配置 (*.plugin.json 或 *.json)
        if (file.endsWith('.json') && file !== 'plugins-config.json') {
          try {
            const raw = fs.readFileSync(fullPath, 'utf-8')
            const cfg = JSON.parse(raw) as Record<string, unknown>
            if (cfg.id && typeof cfg.id === 'string') {
              if (cfg.type === 'template-sqlite' || cfg.dbPath) {
                const plugin = new TemplateSqlitePlugin(cfg as unknown as TemplateSqliteConfig)
                this.register(plugin)
                console.log(`[PluginManager] Loaded declarative SQLite plugin: ${cfg.id}`)
              } else if (cfg.type === 'template-jsonl' || cfg.baseDir) {
                const plugin = new TemplateJsonlPlugin(cfg as unknown as TemplateJsonlConfig)
                this.register(plugin)
                console.log(`[PluginManager] Loaded declarative JSONL plugin: ${cfg.id}`)
              }
            }
          } catch (e) {
            console.error(`[PluginManager] Error loading JSON plugin ${file}:`, e)
          }
        }

        // 2. 自定义 ESM 脚本插件 (*.plugin.js, *.plugin.mjs)
        if (file.endsWith('.plugin.js') || file.endsWith('.plugin.mjs')) {
          try {
            const fileUrl = pathToFileURL(fullPath).href
            const mod = await import(`${fileUrl}?t=${ts}`)
            const PluginClass = mod.default || mod.plugin
            const pluginInstance: SessionPlugin = typeof PluginClass === 'function' ? new PluginClass() : PluginClass
            if (pluginInstance && pluginInstance.manifest?.id) {
              this.register(pluginInstance)
              console.log(`[PluginManager] Loaded custom JS plugin: ${pluginInstance.manifest.id}`)
            }
          } catch (e) {
            console.error(`[PluginManager] Error loading custom JS plugin ${file}:`, e)
          }
        }
      }

      // 3. 扫描 ~/.session-hub/node_modules/ 中通过 npm/pnpm 安装的插件包 (@session-hub/plugin-* 或 session-hub-plugin-*)
      const userNodeModules = path.join(HUB_DIR, 'node_modules')
      if (fs.existsSync(userNodeModules)) {
        await this.scanNodeModulesPlugins(userNodeModules)
      }
    } catch (err) {
      console.error('[PluginManager] Error scanning external plugins dir:', err)
    }
  }

  /**
   * 扫描 node_modules 目录中的 npm 插件包
   */
  private async scanNodeModulesPlugins(nmDir: string) {
    try {
      const ts = Date.now()
      const scanScopeOrPkg = async (scopePath: string, isScope = false) => {
        const entries = fs.readdirSync(scopePath, { withFileTypes: true })
        for (const entry of entries) {
          if (!entry.isDirectory()) continue
          if (entry.name.startsWith('@') && !isScope) {
            await scanScopeOrPkg(path.join(scopePath, entry.name), true)
          } else if (entry.name.startsWith('plugin-') || entry.name.startsWith('session-hub-plugin-')) {
            const pkgDir = path.join(scopePath, entry.name)
            const pkgJsonPath = path.join(pkgDir, 'package.json')
            if (fs.existsSync(pkgJsonPath)) {
              try {
                const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8')) as Record<string, unknown>
                const entryFile = this.resolvePackageEntry(pkgDir, pkgJson)
                if (entryFile && fs.existsSync(entryFile)) {
                  const entryUrl = pathToFileURL(entryFile).href
                  const mod = await import(`${entryUrl}?t=${ts}`)
                  const PluginClass = mod.default || mod.plugin
                  const pluginInstance: SessionPlugin = typeof PluginClass === 'function' ? new PluginClass() : PluginClass
                  if (pluginInstance && pluginInstance.manifest?.id) {
                    this.register(pluginInstance)
                    console.log(`[PluginManager] Loaded npm plugin: ${pluginInstance.manifest.id} (${entry.name})`)
                  }
                } else {
                  console.warn(`[PluginManager] Could not resolve entry file for npm plugin at ${pkgDir}`)
                }
              } catch (e) {
                console.error(`[PluginManager] Failed to load npm plugin from ${pkgDir}:`, e)
              }
            }
          }
        }
      }
      await scanScopeOrPkg(nmDir, false)
    } catch (err) {
      console.error('[PluginManager] Error scanning node_modules plugins:', err)
    }
  }

  /**
   * 获取所有注册的插件列表
   */
  getAllPlugins(): SessionPlugin[] {
    return Array.from(this.plugins.values())
  }

  /**
   * 获取当前启用的插件列表
   */
  getActivePlugins(): SessionPlugin[] {
    return Array.from(this.plugins.values()).filter((plugin) => {
      const isEnabled = this.enabledStates.get(plugin.manifest.id) !== false
      return isEnabled && plugin.isAvailable()
    })
  }

  /**
   * 获取指定插件
   */
  getPlugin(id: string): SessionPlugin | undefined {
    return this.plugins.get(id)
  }

  /**
   * 获取所有插件的状态列表
   */
  getPluginStatusList(): PluginStatusInfo[] {
    const list: PluginStatusInfo[] = []

    for (const plugin of this.plugins.values()) {
      const id = plugin.manifest.id
      const isEnabled = this.enabledStates.get(id) !== false
      const isAvailable = plugin.isAvailable()

      let sessionCount = 0
      if (isAvailable && isEnabled) {
        try {
          sessionCount = plugin.getSessions().length
        } catch {
          sessionCount = 0
        }
      }

      list.push({
        manifest: plugin.manifest,
        isAvailable,
        isEnabled,
        sessionCount,
        source: plugin.manifest.type === 'builtin' ? 'builtin' : 'user'
      })
    }

    return list
  }

  getPluginsStatus(): PluginStatusInfo[] {
    return this.getPluginStatusList()
  }

  /**
   * 切换插件启用/禁用状态
   */
  togglePlugin(id: string, enabled?: boolean): boolean {
    const plugin = this.plugins.get(id)
    if (!plugin) return false
    const currentState = this.enabledStates.get(id) !== false
    const nextState = enabled !== undefined ? enabled : !currentState
    this.enabledStates.set(id, nextState)
    this.saveConfig()
    return nextState
  }

  /**
   * 重新加载插件（清空非内置插件并重新扫描）
   */
  async reload(): Promise<void> {
    this.plugins.clear()
    this.initBuiltinPlugins()
    this.loadDeclarativeJsonPluginsSync()
    await this.loadExternalPlugins()
    this.loadConfig()
  }

  // ==========================================
  // 会话数据聚合统一接口
  // ==========================================

  getAllSessions(platformFilter?: string): UnifiedSession[] {
    let sessions: UnifiedSession[] = []

    if (!platformFilter || platformFilter === 'all') {
      for (const plugin of this.getActivePlugins()) {
        try {
          sessions.push(...plugin.getSessions())
        } catch (e) {
          console.error(`[PluginManager] Error loading sessions for ${plugin.manifest.id}:`, e)
        }
      }
    } else {
      const plugin = this.plugins.get(platformFilter)
      const isEnabled = this.enabledStates.get(platformFilter) !== false
      if (plugin && isEnabled && plugin.isAvailable()) {
        try {
          sessions = plugin.getSessions()
        } catch (e) {
          console.error(`[PluginManager] Error loading sessions for ${plugin.manifest.id}:`, e)
        }
      }
    }

    return sessions.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  getSession(platform: string, id: string): UnifiedSession | null {
    const plugin = this.plugins.get(platform)
    if (!plugin || !plugin.isAvailable()) return null
    return plugin.getSessions().find(s => s.id === id) || null
  }

  getMessages(platform: PlatformType, id: string): { session: UnifiedSession | null, messages: SessionMessage[] } {
    const plugin = this.plugins.get(platform)
    if (!plugin || !plugin.isAvailable()) return { session: null, messages: [] }

    const all = plugin.getSessions()
    const session = all.find(s => s.id === id) || null
    if (!session) return { session: null, messages: [] }

    const messages = plugin.getMessages(id, session)
    return { session, messages }
  }

  updateSession(platform: PlatformType, id: string, payload: UpdateSessionPayload): boolean {
    const plugin = this.plugins.get(platform)
    if (!plugin || !plugin.updateSession) return false
    return Boolean(plugin.updateSession(id, payload))
  }

  deleteSession(platform: PlatformType, id: string): boolean {
    const plugin = this.plugins.get(platform)
    if (!plugin || !plugin.deleteSession) return true
    try {
      return Boolean(plugin.deleteSession(id))
    } catch {
      return true
    }
  }

  createSession(platform: PlatformType, payload: CreateSessionPayload): UnifiedSession | null {
    const plugin = this.plugins.get(platform)
    if (!plugin || !plugin.createSession) return null
    return plugin.createSession(payload) as UnifiedSession
  }

  getStats(): { total: number, counts: Record<string, number> } {
    const counts: Record<string, number> = {}
    let total = 0

    for (const plugin of this.plugins.values()) {
      counts[plugin.manifest.id] = 0
      const isEnabled = this.enabledStates.get(plugin.manifest.id) !== false
      if (isEnabled && plugin.isAvailable()) {
        try {
          const sessions = plugin.getSessions()
          counts[plugin.manifest.id] = sessions.length
          total += sessions.length
        } catch {
          counts[plugin.manifest.id] = 0
        }
      }
    }

    return { total, counts }
  }
}

export const pluginManager = new PluginManager()
