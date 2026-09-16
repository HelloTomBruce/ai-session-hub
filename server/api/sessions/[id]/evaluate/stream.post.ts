import { evaluateSessionValue, type EvaluationContext } from '../../../../utils/evaluator-engine'
import { knowledgeService } from '../../../../utils/knowledge-service'
import { cacheService } from '../../../../utils/cache-service'
import { getSessionMessages } from '../../../../utils/session-service'
import { getLLMProviderSettings } from '../../../../utils/llm-provider-config'
import type { PlatformType, UnifiedSession, SessionMessage } from '../../../../utils/types'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const query = getQuery(event)
  const platform = ((query.cli || query.platform) ? String(query.cli || query.platform) : 'pi') as PlatformType
  const body = await readBody(event).catch(() => ({}))

  if (!id) {
    throw createError({ statusCode: 400, message: 'Session ID is required' })
  }

  // Set SSE Headers
  setHeader(event, 'Content-Type', 'text/event-stream')
  setHeader(event, 'Cache-Control', 'no-cache')
  setHeader(event, 'Connection', 'keep-alive')

  const res = event.node.res
  const sendEvent = (eventType: string, data: unknown) => {
    res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  try {
    // 1. Get cached session or adapter session
    sendEvent('status', {
      step: 1,
      totalSteps: 4,
      title: '正在提取会话轨迹与代码事实',
      message: `正在读取平台 [${platform.toUpperCase()}] 会话记录及工具调用上下文...`
    })

    const detail = cacheService.getCachedSessionDetail(platform, id)
    let session: UnifiedSession | null = detail.session
    let messages: SessionMessage[] = detail.messages

    if (!session || messages.length === 0) {
      const raw = getSessionMessages(platform, id)
      if (!session && raw.session) session = raw.session
      if (messages.length === 0 && raw.messages) messages = raw.messages
    }

    if (!session) {
      session = {
        id,
        cli: platform,
        category: 'cli',
        title: body.title || '会话',
        cwd: body.cwd || process.cwd(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: messages.length,
        rawLocation: ''
      }
    }

    const activeSession: UnifiedSession = session

    await new Promise(r => setTimeout(r, 150))

    // 2. Step 2: AST & Code Structure Analysis
    sendEvent('status', {
      step: 2,
      totalSteps: 4,
      title: 'AST 结构与契约变动分析',
      message: `已提取 ${messages.length} 条对话与工具调用记录，正在计算代码契约影响权重...`
    })

    await new Promise(r => setTimeout(r, 250))

    // 4. Step 3: Semantic Entropy & Thought Rationale
    sendEvent('status', {
      step: 3,
      totalSteps: 4,
      title: '信息密度与排障思考链推导',
      message: '正在分析思维链深度、根因剖析逻辑与避坑信号特征...'
    })

    await new Promise(r => setTimeout(r, 250))

    // 4. Build Evaluation Context and execute ValueScoringEngine
    const evalCtx: EvaluationContext = {
      sessionId: activeSession.id,
      platform: activeSession.cli,
      title: activeSession.title,
      cwd: activeSession.cwd,
      createdAt: activeSession.createdAt,
      updatedAt: activeSession.updatedAt,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
        thought: m.thought,
        toolCalls: m.toolCalls
      }))
    }

    sendEvent('status', {
      step: 4,
      totalSteps: 4,
      title: '多维综合加权与价值分类裁决',
      message: '正在融合 AST 影响、信息熵密度与拓扑中心度，生成标准化量化报告...'
    })

    const llmProvider = getLLMProviderSettings()
    const report = await evaluateSessionValue(evalCtx, {
      llmProvider: llmProvider.enabled ? llmProvider : undefined
    })

    // 6. Save Evaluation Cache
    knowledgeService.saveEvaluation(report, activeSession.cli)

    // 7. Auto Harvest Knowledge
    let harvestedKnowledge = null
    if (body.autoHarvest !== false && report.isWorthSaving) {
      harvestedKnowledge = knowledgeService.autoHarvestFromEvaluation(activeSession, report, messages)
    }

    sendEvent('done', {
      report,
      harvestedKnowledge,
      sessionTitle: activeSession.title
    })

    res.end()
  } catch (err) {
    sendEvent('error', { message: (err as { message?: string })?.message || '评估流处理发生异常' })
    res.end()
  }
})
