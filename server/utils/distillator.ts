import type { PlatformType, SessionMessage, UnifiedSession } from './types'

export interface DistilledFact {
  type: 'action' | 'decision' | 'learning' | 'tool_use' | 'todo'
  summary: string
  detail?: string
  sourceSessionId: string
  platform: PlatformType
}

export interface ADRItem {
  id: string
  title: string
  context: string
  decision: string
  consequences: string
  status: 'Accepted' | 'Proposed' | 'Deprecated'
  platform: PlatformType
  sourceSessionId: string
}

export interface DistillReport {
  title: string
  timeRange: {
    from: number
    to: number
  }
  sessionCount: number
  sessions: Array<{
    id: string
    title: string
    platform: PlatformType
    cwd: string
    updatedAt: number
  }>
  actionsDone: string[]
  keyLearnings: string[]
  technicalDecisions: string[]
  adrs: ADRItem[]
  toolsAndCommands: string[]
  todos: string[]
  rawMarkdown: string
  adrMarkdown: string
}

export function distillSessionsContent(sessions: Array<{ session: UnifiedSession, messages: SessionMessage[] }>): DistillReport {
  const actionsDone: string[] = []
  const keyLearnings: string[] = []
  const technicalDecisions: string[] = []
  const adrs: ADRItem[] = []
  const toolsAndCommands: string[] = []
  const todos: string[] = []

  let minTime = Infinity
  let maxTime = -Infinity
  let adrCounter = 1

  for (const item of sessions) {
    const s = item.session
    if (s.createdAt && s.createdAt < minTime) minTime = s.createdAt
    if (s.updatedAt && s.updatedAt > maxTime) maxTime = s.updatedAt

    // 1. Session Title as high-level action/intent
    actionsDone.push(`[${s.cli.toUpperCase()}] ${s.title} (工作目录: ${s.cwd})`)

    // 2. Scan messages
    for (const msg of item.messages) {
      if (msg.timestamp) {
        if (msg.timestamp < minTime) minTime = msg.timestamp
        if (msg.timestamp > maxTime) maxTime = msg.timestamp
      }

      // Check tool calls
      if (msg.toolCalls && msg.toolCalls.length) {
        for (const tool of msg.toolCalls) {
          const name = tool.name || tool.type || 'tool'
          const args = JSON.stringify(tool.arguments || tool.args || tool.input || {})
          toolsAndCommands.push(`${name} -> ${args.slice(0, 120)}`)
        }
      }

      // Extract learnings / thoughts / decisions
      if (msg.thought) {
        const thoughtLines = msg.thought.split('\n').map(l => l.trim()).filter(l => l.length > 10)
        for (const tl of thoughtLines) {
          if (/方案|选择|决定|原因|需要|建议|由于|采用|改为|重构|架构/i.test(tl)) {
            technicalDecisions.push(tl)
            
            // Heuristic for ADR generation
            if (tl.length > 25 && /选择|采用|决定|改为|使用/i.test(tl)) {
              adrs.push({
                id: `ADR-${String(adrCounter++).padStart(3, '0')}`,
                title: tl.slice(0, 50) + (tl.length > 50 ? '...' : ''),
                context: `在 ${s.cli.toUpperCase()} 会话 [${s.title}] 中遇到架构或实现方案选型。`,
                decision: tl,
                consequences: `保障了功能落地，兼顾 ${s.cli.toUpperCase()} 工作流规范与代码维护性。`,
                status: 'Accepted',
                platform: s.cli,
                sourceSessionId: s.id
              })
            }
          } else if (/注意|避免|报错|bug|fix|解决|修复|gotcha|注意点|异常/i.test(tl)) {
            keyLearnings.push(tl)
          }
        }
      }

      // Extract TODOs or actions from text
      if (msg.content) {
        const contentLines = msg.content.split('\n').map(l => l.trim())
        for (const cl of contentLines) {
          if (/^[-*]\s*\[\s*\]/i.test(cl) || /待办|下一步|TODO/i.test(cl)) {
            todos.push(cl.replace(/^[-*]\s*(\[\s*\])?/i, '').trim())
          }
        }
      }
    }
  }

  // Deduplicate
  const uniqueActions = Array.from(new Set(actionsDone))
  const uniqueLearnings = Array.from(new Set(keyLearnings)).slice(0, 20)
  const uniqueDecisions = Array.from(new Set(technicalDecisions)).slice(0, 20)
  const uniqueTools = Array.from(new Set(toolsAndCommands)).slice(0, 20)
  const uniqueTodos = Array.from(new Set(todos)).slice(0, 15)
  const uniqueAdrs = adrs.slice(0, 10)

  // Markdown builder
  const markdown = `# AI Session Hub 知识沉淀与复盘报告

## 📊 涉及会话概要 (${sessions.length} 个会话)
${sessions.map(s => `- **[${s.session.cli.toUpperCase()}]** ${s.session.title} (\`${s.session.cwd}\`)`).join('\n')}

---

## 🛠️ 1. 完成工作与操作轨迹 (What Was Done)
${uniqueActions.map(a => `- ${a}`).join('\n') || '- 暂无明确操作记录'}

## 💡 2. 关键技术决策与思考依据 (Thinking & Technical Decisions)
${uniqueDecisions.map(d => `- ${d}`).join('\n') || '- 遵循默认或未记录明确决策'}

## 🧠 3. 沉淀经验与避坑要点 (Key Learnings & Gotchas)
${uniqueLearnings.map(l => `- ${l}`).join('\n') || '- 暂无明显踩坑记录'}

## 🔧 4. 关键工具调用与执行特征 (Tool Usages)
${uniqueTools.map(t => `- \`${t}\``).join('\n') || '- 无外部工具调用'}

## 📋 5. 待办事项与后续演进建议 (Next Steps)
${uniqueTodos.map(t => `- [ ] ${t}`).join('\n') || '- [ ] 无未竟待办'}
`

  // ADR Markdown builder
  const adrMarkdown = `# 架构与方案决策记录 (ADR Collection)
> 本文档基于 ${sessions.length} 个历史开发会话中 AI 的思考路径与决策推导自动提取。

${uniqueAdrs.map(adr => `### ${adr.id}: ${adr.title}
- **状态 (Status)**: \`${adr.status}\`
- **来源会话 (Source)**: \`${adr.platform.toUpperCase()}\` (Session: ${adr.sourceSessionId})
- **背景与痛点 (Context)**: ${adr.context}
- **做出的决定 (Decision)**:
  > ${adr.decision}
- **影响与后续结果 (Consequences)**: ${adr.consequences}
`).join('\n---\n\n') || '> 未检测到足够篇幅的技术决策记录'}
`

  return {
    title: `知识沉淀报告 (${sessions.length} 会话)`,
    timeRange: {
      from: minTime === Infinity ? Date.now() : minTime,
      to: maxTime === -Infinity ? Date.now() : maxTime
    },
    sessionCount: sessions.length,
    sessions: sessions.map(s => ({
      id: s.session.id,
      title: s.session.title,
      platform: s.session.cli,
      cwd: s.session.cwd,
      updatedAt: s.session.updatedAt
    })),
    actionsDone: uniqueActions,
    keyLearnings: uniqueLearnings,
    technicalDecisions: uniqueDecisions,
    adrs: uniqueAdrs,
    toolsAndCommands: uniqueTools,
    todos: uniqueTodos,
    rawMarkdown: markdown,
    adrMarkdown: adrMarkdown
  }
}
