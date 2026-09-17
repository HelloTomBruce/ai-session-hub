import type { BaseSessionAdapter, UnifiedSession, SessionMessage, PlatformType, CreateSessionPayload, UpdateSessionPayload } from './types'
import { pluginManager } from './plugin-manager'

class SessionAdapterRegistry {
  register(_adapter: BaseSessionAdapter) {
    // No-op for legacy adapter registration
  }

  get(id: string): BaseSessionAdapter | undefined {
    const plugin = pluginManager.getPlugin(id)
    if (!plugin) return undefined
    // Return a BaseSessionAdapter duck-type wrapper for template plugins
    return {
      name: plugin.manifest.name,
      id: plugin.manifest.id,
      category: plugin.manifest.category,
      isAvailable: () => plugin.isAvailable(),
      getSessions: () => plugin.getSessions(),
      getMessages: (id, session) => plugin.getMessages(id, session),
      updateSession: (id, payload) => plugin.updateSession ? Boolean(plugin.updateSession(id, payload)) : false,
      deleteSession: (id) => plugin.deleteSession ? Boolean(plugin.deleteSession(id)) : true,
      createSession: (payload) => {
        if (!plugin.createSession) throw new Error(`Plugin ${id} does not support createSession`)
        return plugin.createSession(payload) as UnifiedSession
      }
    }
  }

  getAllAdapters(): BaseSessionAdapter[] {
    return pluginManager.getAllPlugins().map(p => {
      return {
        name: p.manifest.name,
        id: p.manifest.id,
        category: p.manifest.category,
        isAvailable: () => p.isAvailable(),
        getSessions: () => p.getSessions(),
        getMessages: (id, session) => p.getMessages(id, session),
        updateSession: (id, payload) => p.updateSession ? Boolean(p.updateSession(id, payload)) : false,
        deleteSession: (id) => p.deleteSession ? Boolean(p.deleteSession(id)) : true,
        createSession: (payload) => {
          if (!p.createSession) throw new Error(`Plugin ${p.manifest.id} does not support createSession`)
          return p.createSession(payload) as UnifiedSession
        }
      }
    })
  }

  getAllSessions(platformFilter?: string): UnifiedSession[] {
    return pluginManager.getAllSessions(platformFilter)
  }

  getSession(platform: string, id: string): UnifiedSession | null {
    return pluginManager.getSession(platform, id)
  }

  getMessages(platform: PlatformType, id: string): { session: UnifiedSession | null, messages: SessionMessage[] } {
    return pluginManager.getMessages(platform, id)
  }

  updateSession(platform: PlatformType, id: string, payload: UpdateSessionPayload): boolean {
    return pluginManager.updateSession(platform, id, payload)
  }

  deleteSession(platform: PlatformType, id: string): boolean {
    return pluginManager.deleteSession(platform, id)
  }

  createSession(platform: PlatformType, payload: CreateSessionPayload): UnifiedSession {
    const res = pluginManager.createSession(platform, payload)
    if (!res) {
      throw new Error(`Platform/Plugin ${platform} not found or does not support creation`)
    }
    return res
  }

  getStats() {
    return pluginManager.getStats()
  }
}

export const adapterRegistry = new SessionAdapterRegistry()
