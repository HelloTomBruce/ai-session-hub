/**
 * 会话文本净化（纯函数，前后端可共用）。
 *
 * 各平台 CLI 会把「环境上下文」当成一条 user 消息写进会话文件：
 * `# Environment`、`You are powered by ...`、技能清单、`<system-reminder>` 块等。
 * 这些内容既不是用户意图，也不应参与轮次导航与自动打标，需要先剥离。
 *
 * 从 app/pages/sessions/[id].vue 与 server/utils/tag-service.ts 中重复的启发式规则收敛而来：
 * 页面需要「剥离后可能为空」的字符串，打标只需要「这条是不是注入内容」的布尔判断，
 * 因此这里同时导出两个口径，避免两处规则再次漂移。
 */

/** 成对标签包裹的注入块（整段删除） */
const INJECTED_BLOCK_PATTERNS: RegExp[] = [
  /<system-reminder>[\s\S]*?<\/system-reminder>/gi,
  /<task-notification>[\s\S]*?<\/task-notification>/gi,
  /<total_tokens>[^<]*<\/total_tokens>/gi,
  /<env>[\s\S]*?<\/env>/gi
]

/** 整条消息本身就是平台注入时（剥离后应当视为空）的前缀特征 */
const INJECTED_PREFIX_PATTERNS: RegExp[] = [
  /^# Environment\b/,
  /^You are powered by\b/,
  /^Available agent types\b/,
  /^The following skills are available\b/,
  /^Caveat:/,
  /^# System Prompt\b/,
  /^# Session-Event(s)?\b/,
  /^As you answer the user's questions\b/,
  /^Today's date is\b/,
  /^The user hasn't heard from you\b/,
  /^The TodoWrite tool has(n't)? been used\b/,
  /^#\s*(Context|Instructions)\b/
]

/**
 * 剥离注入内容。若整条消息都是平台注入，返回空串。
 * 用于详情页轮次导航 / 真实用户输入提取。
 */
export function stripInjectedContent(raw: string): string {
  if (!raw) return ''
  let text = raw
  for (const pattern of INJECTED_BLOCK_PATTERNS) {
    text = text.replace(pattern, '')
  }
  text = text.trim()
  if (!text) return ''
  if (INJECTED_PREFIX_PATTERNS.some(p => p.test(text))) return ''
  return text
}

/**
 * 快速判定一条用户消息是否属于平台注入（不做字符串重建，供打标等热路径使用）。
 * 注意：`stripInjectedContent` 的判定更严格（先剥离成对块再判前缀），
 * 这里只把「一眼就是注入」的情况识别出来。
 */
export function looksLikeInjectedContent(raw: string): boolean {
  if (!raw) return false
  const head = raw.slice(0, 400)
  if (/^\s*<[a-z-]+>/i.test(head)) return true
  if (/<system-reminder>/i.test(head)) return true
  if (INJECTED_PREFIX_PATTERNS.some(p => p.test(head.replace(/^\s+/, '')))) return true
  return false
}

/** 取会话的首条「真实用户输入」，跳过平台注入的消息（用于标题提取、自动打标） */
export function firstRealUserMessage(
  messages: Array<{ role: string, content: string }>,
  options: { limit?: number, maxLength?: number } = {}
): string {
  const limit = options.limit ?? messages.length
  const maxLength = options.maxLength ?? 1500
  const users = messages
    .slice(0, limit)
    .filter(m => m.role === 'user' && typeof m.content === 'string' && m.content.trim().length > 0)
  const real = users.find(m => !looksLikeInjectedContent(m.content)) || users[0]
  return (real?.content || '').slice(0, maxLength)
}
