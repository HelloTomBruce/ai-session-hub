export type PlatformType = string
export type CliType = PlatformType
export type CategoryType = 'cli' | 'app'

/**
 * 常用推荐图标 (配合 IDE 自动补全)，同时也支持任意合法的 Iconify 图标字符串
 * 图标库查询网站: https://icones.js.org/ 或 https://lucide.dev/icons
 */
export type CommonPluginIcon
  // 常用通用与控制类图标 (Lucide)
  = | 'i-lucide-terminal'
    | 'i-lucide-bot'
    | 'i-lucide-code-2'
    | 'i-lucide-sparkles'
    | 'i-lucide-cpu'
    | 'i-lucide-briefcase'
    | 'i-lucide-database'
    | 'i-lucide-folder-code'
    | 'i-lucide-brain-circuit'
    | 'i-lucide-message-square'
    | 'i-lucide-layers'
    | 'i-lucide-wrench'
    | 'i-lucide-box'
    | 'i-lucide-smartphone'
    | 'i-lucide-pen-tool'
    | 'i-lucide-cursor-arrow'
  // 常用品牌与大模型 Logo (Simple Icons)
    | 'i-simple-icons-anthropic'
    | 'i-simple-icons-openai'
    | 'i-simple-icons-github'
    | 'i-simple-icons-google'
    | 'i-simple-icons-vscodethemes'
    | 'i-simple-icons-visualstudiocode'
    | 'i-simple-icons-zedindustries'
  // 支持输入任意其它合法图标名
    | (string & {})

export interface SessionToolCall {
  id?: string
  name?: string
  type?: string
  arguments?: unknown
  args?: unknown
  input?: unknown
  output?: unknown
  [key: string]: unknown
}

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
  extra?: Record<string, unknown>
}

export interface SessionMessage {
  id?: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  name?: string
  content: string
  timestamp?: number
  model?: string
  toolCalls?: SessionToolCall[]
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

export interface SessionPluginManifest {
  id: string
  name: string
  category: CategoryType
  /** 插件图标，推荐使用 CommonPluginIcon 或任何 Iconify 标准命名 (如 i-lucide-terminal) */
  icon: CommonPluginIcon
  version?: string
  description?: string
  author?: string
  homepage?: string
  type?: 'builtin' | 'template-jsonl' | 'template-sqlite' | 'custom' | 'npm'
  defaultEnabled?: boolean
}

export interface SessionPlugin {
  readonly manifest: SessionPluginManifest

  /** 初始化插件资源 */
  init?(): Promise<void> | void

  /** 检测本地是否存在该工具的数据环境 */
  isAvailable(): boolean

  /** 读取所有会话列表 */
  getSessions(): UnifiedSession[]

  /** 读取指定会话的消息详情 */
  getMessages(id: string, session?: UnifiedSession): SessionMessage[]

  /** 更新会话标题或元数据（可选） */
  updateSession?(id: string, payload: UpdateSessionPayload): boolean | Promise<boolean>

  /** 删除会话及物理文件（可选，建议幂等返回 true） */
  deleteSession?(id: string): boolean | Promise<boolean>

  /** 创建新会话（可选） */
  createSession?(payload: CreateSessionPayload): UnifiedSession | Promise<UnifiedSession>

  /** 销毁清理资源（可选） */
  onDestroy?(): Promise<void> | void
}

export interface PluginStatusInfo {
  manifest: SessionPluginManifest
  isAvailable: boolean
  isEnabled: boolean
  sessionCount: number
  source: 'builtin' | 'user' | 'npm'
}

/** 声明式 JSONL 插件配置格式 */
export interface TemplateJsonlConfig {
  id: string
  name: string
  category?: CategoryType
  icon?: CommonPluginIcon
  description?: string
  baseDir: string
  filePattern?: string
  roleField?: string
  contentField?: string
  timestampField?: string
  titleField?: string
}

/** 声明式 SQLite 插件配置格式 */
export interface TemplateSqliteConfig {
  id: string
  name: string
  category?: CategoryType
  icon?: CommonPluginIcon
  description?: string
  dbPath: string
  sessionsTable: string
  messagesTable?: string
  idColumn?: string
  titleColumn?: string
  updatedAtColumn?: string
  cwdColumn?: string
  deleteSql?: string
}
