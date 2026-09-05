import type { BaseSessionAdapter, UnifiedSession, SessionMessage, PlatformType, CreateSessionPayload, UpdateSessionPayload } from './types'

class SessionAdapterRegistry {
  private adapters = new Map<string, BaseSessionAdapter>()

  register(adapter: BaseSessionAdapter) {
    this.adapters.set(adapter.id, adapter)
  }

  get(id: string): BaseSessionAdapter | undefined {
    return this.adapters.get(id)
  }

  getAllAdapters(): BaseSessionAdapter[] {
    return Array.from(this.adapters.values())
  }

  getAllSessions(platformFilter?: string): UnifiedSession[] {
    let sessions: UnifiedSession[] = []
    if (!platformFilter || platformFilter === 'all') {
      for (const adapter of this.adapters.values()) {
        if (adapter.isAvailable()) {
          try {
            sessions.push(...adapter.getSessions())
          } catch (e) {
            console.error(`Error loading sessions for ${adapter.id}:`, e)
          }
        }
      }
    } else {
      const adapter = this.adapters.get(platformFilter)
      if (adapter && adapter.isAvailable()) {
        sessions = adapter.getSessions()
      }
    }
    return sessions.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  getMessages(platform: PlatformType, id: string): { session: UnifiedSession | null, messages: SessionMessage[] } {
    const adapter = this.adapters.get(platform)
    if (!adapter) return { session: null, messages: [] }

    const all = adapter.getSessions()
    const session = all.find(s => s.id === id) || null
    if (!session) return { session: null, messages: [] }

    const messages = adapter.getMessages(id, session)
    return { session, messages }
  }

  updateSession(platform: PlatformType, id: string, payload: UpdateSessionPayload): boolean {
    const adapter = this.adapters.get(platform)
    if (!adapter) return false
    return adapter.updateSession(id, payload)
  }

  deleteSession(platform: PlatformType, id: string): boolean {
    const adapter = this.adapters.get(platform)
    if (!adapter) return false
    return adapter.deleteSession(id)
  }

  createSession(platform: PlatformType, payload: CreateSessionPayload): UnifiedSession {
    const adapter = this.adapters.get(platform)
    if (!adapter) {
      throw new Error(`Platform adapter ${platform} not found`)
    }
    return adapter.createSession(payload)
  }

  getStats() {
    const counts: Record<string, number> = {}
    let total = 0
    for (const [key, adapter] of this.adapters.entries()) {
      if (adapter.isAvailable()) {
        const count = adapter.getSessions().length
        counts[key] = count
        total += count
      } else {
        counts[key] = 0
      }
    }
    return { total, counts }
  }
}

export const adapterRegistry = new SessionAdapterRegistry()
