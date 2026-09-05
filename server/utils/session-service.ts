import { adapterRegistry } from './adapter-registry'
import { PiSessionAdapter } from './adapters/pi-adapter'
import { OpenCodeSessionAdapter } from './adapters/opencode-adapter'
import { AgySessionAdapter } from './adapters/agy-adapter'
import { ClaudeSessionAdapter } from './adapters/claude-adapter'
import { CodexSessionAdapter } from './adapters/codex-adapter'
import { WorkBuddySessionAdapter } from './adapters/workbuddy-adapter'
import { ReasonixSessionAdapter } from './adapters/reasonix-adapter'

import type { PlatformType, CreateSessionPayload, UpdateSessionPayload } from './types'

// Register all adapters
adapterRegistry.register(new PiSessionAdapter())
adapterRegistry.register(new OpenCodeSessionAdapter())
adapterRegistry.register(new AgySessionAdapter())
adapterRegistry.register(new ClaudeSessionAdapter())
adapterRegistry.register(new CodexSessionAdapter())
adapterRegistry.register(new WorkBuddySessionAdapter())
adapterRegistry.register(new ReasonixSessionAdapter())

// Export standard service wrappers
export function getAllSessions(cliFilter?: string) {
  return adapterRegistry.getAllSessions(cliFilter)
}

export function getSessionMessages(cli: PlatformType, id: string) {
  return adapterRegistry.getMessages(cli, id)
}

export function updateCliSession(cli: PlatformType, id: string, payload: UpdateSessionPayload) {
  return adapterRegistry.updateSession(cli, id, payload)
}

export function deleteCliSession(cli: PlatformType, id: string) {
  return adapterRegistry.deleteSession(cli, id)
}

export function createCliSession(cli: PlatformType, payload: CreateSessionPayload) {
  return adapterRegistry.createSession(cli, payload)
}

export function getStats() {
  return adapterRegistry.getStats()
}

export * from './types'
export { adapterRegistry }
