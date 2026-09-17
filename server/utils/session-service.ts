import { pluginManager } from './plugin-manager'
import type { PlatformType, CreateSessionPayload, UpdateSessionPayload } from './types'

// Export standard service wrappers directly backed by pluginManager
export function getAllSessions(cliFilter?: string) {
  return pluginManager.getAllSessions(cliFilter)
}

export function getSessionMessages(cli: PlatformType, id: string) {
  return pluginManager.getMessages(cli, id)
}

export function updateCliSession(cli: PlatformType, id: string, payload: UpdateSessionPayload) {
  return pluginManager.updateSession(cli, id, payload)
}

export function deleteCliSession(cli: PlatformType, id: string) {
  return pluginManager.deleteSession(cli, id)
}

export function createCliSession(cli: PlatformType, payload: CreateSessionPayload) {
  return pluginManager.createSession(cli, payload)
}

export function getStats() {
  return pluginManager.getStats()
}
