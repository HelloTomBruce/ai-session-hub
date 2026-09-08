import type { PlatformType, SessionMessage, UnifiedSession } from './types'
import { compactSessionForAI } from './session-compactor'
import { getCachedSessionSummary, saveCachedSessionSummary, type SingleSessionSummary } from './distill-cache'
import type { LLMProviderSettings } from './llm-provider-config'

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
  isAiGenerated: boolean
  providerModel?: string
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

const MAP_SYSTEM_PROMPT = `You are an expert software engineer and technical knowledge distillation assistant.
Your task is to analyze a single AI coding agent conversation transcript and extract structured facts with high precision:
1. actions: Core work accomplished, modifications done (bullet points).
2. decisions: Technical/architectural decisions made, why they were chosen (include title, context, decision, consequence).
3. learnings: Gotchas, bugs fixed, warnings, lessons learned.
4. todos: Unfinished tasks, next steps mentioned.
5. tools: Key tools or commands run.

Output MUST be a valid JSON object matching this schema:
{
  "actions": ["string"],
  "decisions": [
    {
      "title": "Short title of decision",
      "context": "Why the decision was needed",
      "decision": "What was chosen/implemented",
      "consequence": "Outcome/impact"
    }
  ],
  "learnings": ["string"],
  "todos": ["string"],
  "tools": ["string"]
}`

const REDUCE_SYSTEM_PROMPT = `You are a Principal Software Architect and Knowledge Synthesizer.
You are given distilled summaries from multiple related AI coding sessions.
Your task is to synthesize them into a cohesive, high-value Engineering Review and Architectural Decision Record (ADR) report in Chinese.

Guidelines:
1. Group and deduplicate work done across sessions into clear milestone themes.
2. Extract formal Architectural Decision Records (ADRs) with IDs like "ADR-001", "ADR-002" from significant technical choices.
3. Consolidate key learnings and gotchas into actionable engineering takeaways.
4. Merge and organize TODO items.
5. Provide a polished, well-formatted Markdown summary and ADR collection.

Output MUST be a valid JSON object matching this schema:
{
  "summaryTitle": "string",
  "actionsDone": ["string"],
  "keyLearnings": ["string"],
  "technicalDecisions": ["string"],
  "adrs": [
    {
      "id": "ADR-001",
      "title": "string",
      "context": "string",
      "decision": "string",
      "consequences": "string",
      "status": "Accepted",
      "platform": "string",
      "sourceSessionId": "string"
    }
  ],
  "toolsAndCommands": ["string"],
  "todos": ["string"]
}`

/**
 * Call OpenAI-compatible LLM endpoint
 */
async function callLLM(provider: LLMProviderSettings, systemPrompt: string, userPrompt: string, temperature = 0.1): Promise<any> {
  const baseUrl = (provider.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')
  const model = provider.model || 'gpt-4o-mini'

  const reqBody: any = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature
  }

  let rawContent = ''
  try {
    const res = await $fetch<any>(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: {
        ...reqBody,
        response_format: { type: 'json_object' }
      }
    })
    rawContent = res.choices?.[0]?.message?.content || ''
  } catch (err: any) {
    // If response_format json_object was rejected, retry without it
    const res = await $fetch<any>(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: reqBody
    })
    rawContent = res.choices?.[0]?.message?.content || ''
  }

  if (!rawContent) throw new Error('Empty LLM response')

  // Extract JSON
  const jsonMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || [null, rawContent]
  return JSON.parse(jsonMatch[1] || rawContent)
}

/**
 * Map Phase: Extract micro-summary for a single session using LLM (or cache)
 */
async function distillSingleSessionMap(
  item: { session: UnifiedSession, messages: SessionMessage[] },
  provider: LLMProviderSettings
): Promise<SingleSessionSummary> {
  const { session, messages } = item

  // 1. Check disk cache
  const cached = getCachedSessionSummary(session.cli, session.id, session.updatedAt)
  if (cached) {
    return cached
  }

  // 2. Compact transcript
  const compacted = compactSessionForAI(session, messages)

  // 3. Call LLM
  const userPrompt = `Please distill the following coding conversation:\n\n${compacted.transcriptText}`
  const parsed = await callLLM(provider, MAP_SYSTEM_PROMPT, userPrompt, 0.1)

  const summary: SingleSessionSummary = {
    sessionId: session.id,
    platform: session.cli,
    title: session.title,
    cwd: session.cwd,
    updatedAt: session.updatedAt,
    actions: Array.isArray(parsed.actions) ? parsed.actions : [],
    decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
    learnings: Array.isArray(parsed.learnings) ? parsed.learnings : [],
    todos: Array.isArray(parsed.todos) ? parsed.todos : [],
    tools: Array.isArray(parsed.tools) ? parsed.tools : []
  }

  // 4. Save to cache
  saveCachedSessionSummary(summary)
  return summary
}

/**
 * Reduce Phase: Global synthesis across all session summaries using LLM
 */
async function synthesizeGlobalDistillReportWithAI(
  sessionSummaries: SingleSessionSummary[],
  sessions: Array<{ session: UnifiedSession, messages: SessionMessage[] }>,
  provider: LLMProviderSettings
): Promise<DistillReport> {
  let minTime = Infinity
  let maxTime = -Infinity

  for (const s of sessions) {
    if (s.session.createdAt && s.session.createdAt < minTime) minTime = s.session.createdAt
    if (s.session.updatedAt && s.session.updatedAt > maxTime) maxTime = s.session.updatedAt
  }

  // Build high-density prompt from summaries
  const payloadForReduce = sessionSummaries.map((s, idx) => ({
    sessionIndex: idx + 1,
    id: s.sessionId,
    platform: s.platform,
    title: s.title,
    cwd: s.cwd,
    actions: s.actions,
    decisions: s.decisions,
    learnings: s.learnings,
    todos: s.todos,
    tools: s.tools
  }))

  const userPrompt = `Here are the distilled summaries from ${sessionSummaries.length} AI development sessions:\n\n${JSON.stringify(payloadForReduce, null, 2)}\n\nPlease synthesize them into the final engineering review and ADR report.`

  const parsed = await callLLM(provider, REDUCE_SYSTEM_PROMPT, userPrompt, 0.2)

  const adrs: ADRItem[] = (parsed.adrs || []).map((adr: any, index: number) => {
    // Find matching session if not set
    const fallbackSess = sessionSummaries[index % sessionSummaries.length]
    return {
      id: adr.id || `ADR-${String(index + 1).padStart(3, '0')}`,
      title: adr.title || '架构技术决策',
      context: adr.context || '未提供上下文背景',
      decision: adr.decision || '未提供决策内容',
      consequences: adr.consequences || '功能落地与维护性保障',
      status: adr.status || 'Accepted',
      platform: (adr.platform || fallbackSess?.platform || 'cli') as PlatformType,
      sourceSessionId: adr.sourceSessionId || fallbackSess?.sessionId || ''
    }
  })

  const actionsDone = Array.isArray(parsed.actionsDone) && parsed.actionsDone.length > 0
    ? parsed.actionsDone
    : sessionSummaries.flatMap(s => s.actions)

  const keyLearnings = Array.isArray(parsed.keyLearnings) && parsed.keyLearnings.length > 0
    ? parsed.keyLearnings
    : sessionSummaries.flatMap(s => s.learnings)

  const technicalDecisions = Array.isArray(parsed.technicalDecisions) && parsed.technicalDecisions.length > 0
    ? parsed.technicalDecisions
    : sessionSummaries.flatMap(s => s.decisions.map(d => `${d.title}: ${d.decision}`))

  const toolsAndCommands = Array.isArray(parsed.toolsAndCommands) && parsed.toolsAndCommands.length > 0
    ? parsed.toolsAndCommands
    : Array.from(new Set(sessionSummaries.flatMap(s => s.tools)))

  const todos = Array.isArray(parsed.todos) && parsed.todos.length > 0
    ? parsed.todos
    : Array.from(new Set(sessionSummaries.flatMap(s => s.todos)))

  // Build Markdown
  const markdown = `# AI Session Hub 知识沉淀与复盘报告
> 🤖 本报告由 AI 模型 (\`${provider.model || 'LLM'}\`) 基于 ${sessions.length} 个多端开发会话深度智能提炼生成。

## 📊 涉及会话概要 (${sessions.length} 个会话)
${sessions.map(s => `- **[${s.session.cli.toUpperCase()}]** ${s.session.title} (\`${s.session.cwd}\`)`).join('\n')}

---

## 🛠️ 1. 完成工作与任务主线 (What Was Done)
${actionsDone.map((a: string) => `- ${a}`).join('\n') || '- 暂无明确操作记录'}

## 💡 2. 关键架构决策与选型 (Architecture & Technical Decisions)
${technicalDecisions.map((d: string) => `- ${d}`).join('\n') || '- 遵循默认实现，未见重大决策分歧'}

## 🧠 3. 踩坑记录与沉淀经验 (Key Learnings & Gotchas)
${keyLearnings.map((l: string) => `- ${l}`).join('\n') || '- 暂无明显踩坑记录'}

## 🔧 4. 关键工具链与执行特征 (Tool Usages)
${toolsAndCommands.map((t: string) => `- \`${t}\``).join('\n') || '- 无外部工具调用'}

## 📋 5. 待办事项与后续演进建议 (Next Steps)
${todos.map((t: string) => `- [ ] ${t}`).join('\n') || '- [ ] 无未竟待办'}
`

  const adrMarkdown = `# 架构与方案决策记录 (ADR Collection)
> 🤖 本文档由 AI 大模型基于 ${sessions.length} 个会话的思维链 (Thinking Rationale) 与架构选型自动生成。

${adrs.map(adr => `### ${adr.id}: ${adr.title}
- **状态 (Status)**: \`${adr.status}\`
- **来源会话 (Source)**: \`${adr.platform.toUpperCase()}\` (Session: ${adr.sourceSessionId})
- **背景与痛点 (Context)**: ${adr.context}
- **做出的决定 (Decision)**:
  > ${adr.decision}
- **影响与后果 (Consequences)**: ${adr.consequences}
`).join('\n---\n\n') || '> 未检测到足够篇幅的技术决策记录'}
`

  return {
    title: parsed.summaryTitle || `知识沉淀报告 (${sessions.length} 会话)`,
    isAiGenerated: true,
    providerModel: provider.model,
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
    actionsDone,
    keyLearnings,
    technicalDecisions,
    adrs,
    toolsAndCommands,
    todos,
    rawMarkdown: markdown,
    adrMarkdown
  }
}

/**
 * Local Heuristic Fallback Distillation (when LLM is disabled or offline)
 */
export function distillSessionsHeuristic(sessions: Array<{ session: UnifiedSession, messages: SessionMessage[] }>): DistillReport {
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

    actionsDone.push(`[${s.cli.toUpperCase()}] ${s.title} (工作目录: ${s.cwd})`)

    for (const msg of item.messages) {
      if (msg.timestamp) {
        if (msg.timestamp < minTime) minTime = msg.timestamp
        if (msg.timestamp > maxTime) maxTime = msg.timestamp
      }

      if (msg.toolCalls && msg.toolCalls.length) {
        for (const tool of msg.toolCalls) {
          const name = tool.name || tool.type || 'tool'
          const args = JSON.stringify(tool.arguments || tool.args || tool.input || {})
          toolsAndCommands.push(`${name} -> ${args.slice(0, 120)}`)
        }
      }

      if (msg.thought) {
        const thoughtLines = msg.thought.split('\n').map(l => l.trim()).filter(l => l.length > 10)
        for (const tl of thoughtLines) {
          if (/方案|选择|决定|原因|需要|建议|由于|采用|改为|重构|架构/i.test(tl)) {
            technicalDecisions.push(tl)
            if (tl.length > 25 && /选择|采用|决定|改为|使用/i.test(tl)) {
              adrs.push({
                id: `ADR-${String(adrCounter++).padStart(3, '0')}`,
                title: tl.slice(0, 50) + (tl.length > 50 ? '...' : ''),
                context: `在 ${s.cli.toUpperCase()} 会话 [${s.title}] 中遇到方案选型。`,
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

  const uniqueActions = Array.from(new Set(actionsDone))
  const uniqueLearnings = Array.from(new Set(keyLearnings)).slice(0, 20)
  const uniqueDecisions = Array.from(new Set(technicalDecisions)).slice(0, 20)
  const uniqueTools = Array.from(new Set(toolsAndCommands)).slice(0, 20)
  const uniqueTodos = Array.from(new Set(todos)).slice(0, 15)
  const uniqueAdrs = adrs.slice(0, 10)

  const markdown = `# AI Session Hub 知识沉淀与复盘报告
> 💡 *提示：当前使用本地启发式算法生成。如需更精准的 AI 提炼与深度 ADR 归纳，请在右上角「设置」中配置 LLM API Key。*

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

  const adrMarkdown = `# 架构与方案决策记录 (ADR Collection)
> 💡 *提示：当前使用本地启发式规则生成。*

${uniqueAdrs.map(adr => `### ${adr.id}: ${adr.title}
- **状态 (Status)**: \`${adr.status}\`
- **来源会话 (Source)**: \`${adr.platform.toUpperCase()}\` (Session: ${adr.sourceSessionId})
- **背景与痛点 (Context)**: ${adr.context}
- **做出的决定 (Decision)**:
  > ${adr.decision}
- **影响与后果 (Consequences)**: ${adr.consequences}
`).join('\n---\n\n') || '> 未检测到足够篇幅的技术决策记录'}
`

  return {
    title: `知识沉淀报告 (${sessions.length} 会话)`,
    isAiGenerated: false,
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
    adrMarkdown
  }
}

/**
 * Main Entry Point for Distillation:
 * Automatically chooses Map-Reduce AI pipeline if LLM is configured,
 * or gracefully falls back to local heuristic extraction.
 */
export async function distillSessionsContent(
  sessions: Array<{ session: UnifiedSession, messages: SessionMessage[] }>,
  provider?: LLMProviderSettings
): Promise<DistillReport> {
  // If provider is configured with apiKey
  if (provider && provider.enabled && provider.apiKey) {
    try {
      // 1. Map Phase: Extract micro-summary for each session in parallel
      const mapSummaries = await Promise.all(
        sessions.map(item => distillSingleSessionMap(item, provider))
      )

      // 2. Reduce Phase: Global synthesis with ADR generation
      return await synthesizeGlobalDistillReportWithAI(mapSummaries, sessions, provider)
    } catch (e) {
      console.error('[Distillator] AI Distillation failed, falling back to local heuristic:', e)
    }
  }

  // Fallback to local heuristic
  return distillSessionsHeuristic(sessions)
}
