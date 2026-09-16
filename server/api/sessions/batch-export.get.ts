import type { PlatformType, SessionMessage, UnifiedSession } from '../../utils/types'

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const format = (query.format as string) || 'json'
  const itemsParam = (query.items as string) || ''

  const items: Array<{ id: string, cli: string }> = []
  for (const part of itemsParam.split(',').filter(Boolean)) {
    const [cli, ...idParts] = part.split('::')
    const id = idParts.join('::')
    if (cli && id) items.push({ id, cli })
  }

  if (items.length === 0) {
    throw createError({ statusCode: 400, message: 'No items specified. Use items=cli::id,cli::id' })
  }

  const sessions: Array<{ session: UnifiedSession, messages: SessionMessage[], messageCount: number }> = []
  for (const item of items) {
    try {
      const result = getSessionMessages(item.cli as PlatformType, item.id)
      if (result.session) {
        sessions.push({
          session: result.session,
          messages: result.messages,
          messageCount: result.messages.length
        })
      }
    } catch {
      // skip sessions that fail to load
    }
  }

  if (format === 'markdown') {
    let md = `# AI Session Hub 导出报告\n\n`
    md += `> 导出时间: ${new Date().toISOString()}\n`
    md += `> 会话数: ${sessions.length}\n\n---\n\n`

    for (const s of sessions) {
      md += `## ${s.session.title}\n`
      md += `- **平台**: ${s.session.cli}\n`
      md += `- **项目**: ${s.session.cwd || '-'}\n`
      md += `- **时间**: ${new Date(s.session.updatedAt).toISOString()}\n\n`

      for (const msg of s.messages) {
        const role = msg.role === 'user' ? '👤 用户' : msg.role === 'assistant' ? '🤖 AI' : '🔧 工具'
        md += `### ${role}\n\n${msg.content.slice(0, 500)}\n\n`
        if (msg.thought) md += `> 💭 思考: ${msg.thought.slice(0, 200)}\n\n`
      }
      md += `---\n\n`
    }

    setHeader(event, 'Content-Type', 'text/markdown; charset=utf-8')
    setHeader(event, 'Content-Disposition', `attachment; filename="session-hub-export-${Date.now()}.md"`)
    return md
  }

  // Default JSON export
  return {
    success: true,
    data: {
      exportedAt: Date.now(),
      count: sessions.length,
      sessions
    }
  }
})
