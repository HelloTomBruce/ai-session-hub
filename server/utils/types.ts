export type PlatformType = 'pi' | 'opencode' | 'agy' | 'claude' | 'codex' | 'workbuddy' | 'reasonix' | string
export type CategoryType = 'cli' | 'app'

export interface UnifiedSession {
  id: string
  cli: PlatformType
  category: CategoryType
  title: string
  cwd: string
  createdAt: number
  updatedAt: number
  messageCount?: number
  cost?: number
  model?: string
  status?: string
  rawLocation: string
  extra?: Record<string, any>
}

export interface SessionMessage {
  id?: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  timestamp?: number
  model?: string
  toolCalls?: any[]
  thought?: string
}

export interface CreateSessionPayload {
  title: string
  cwd: string
  initialPrompt?: string
}

export interface UpdateSessionPayload {
  title?: string
}

export interface BaseSessionAdapter {
  readonly name: string
  readonly id: PlatformType
  readonly category: CategoryType

  isAvailable(): boolean
  getSessions(): UnifiedSession[]
  getMessages(id: string, session?: UnifiedSession): SessionMessage[]
  updateSession(id: string, payload: UpdateSessionPayload): boolean
  deleteSession(id: string): boolean
  createSession(payload: CreateSessionPayload): UnifiedSession
}
