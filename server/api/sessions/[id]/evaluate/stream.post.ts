import { ValueScoringEngine } from '@session-hub/analyzer'
import { knowledgeService } from '../../../../utils/knowledge-service'
import { knowledgeHarvest } from '../../../../utils/knowledge-harvest'
import { cacheService } from '../../../../utils/cache-service'
import { getSessionMessages } from '../../../../utils/session-service'
import { getLLMProviderSettings } from '../../../../utils/llm-provider-config'
import type { PlatformType, UnifiedSession, SessionMessage } from '../../../../utils/types'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const query = getQuery(event)
  const platform = ((query.cli || query.platform) ? String(query.cli || query.platform) : 'pi') as PlatformType
  const body = await readBody(event).catch(() => ({})) as { autoHarvest?: boolean, title?: string, cwd?: string }

  if (!id) {
    throw createError({ statusCode: 400, message: 'Session ID is required' })
  }

  setHeader(event, 'Content-Type', 'text/event-stream')
  setHeader(event, 'Cache-Control', 'no-cache')
  setHeader(event, 'Connection', 'keep-alive')

  const res = event.node.res
  const sendEvent = (eventType: string, data: unknown) => {
    res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`)
  }
  const status = (step: number, title: string, message: string, extra: Record<string, unknown> = {}) => {
    sendEvent('status', { step, totalSteps: 5, title, message, ...extra })
  }

  try {
    // ── Step 1: evidence（真实读取会话 + 证据归一化）──
    status(1, '提取会话轨迹与代码事实', `正在读取平台 [${platform.toUpperCase()}] 会话记录并归一化工具证据...`)

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

    const evalCtx = {
      sessionId: activeSession.id,
      platform: activeSession.cli,
      title: activeSession.title,
      cwd: activeSession.cwd,
      createdAt: activeSession.createdAt,
      updatedAt: activeSession.updatedAt,
      messages: messages.map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content || ''),
        thought: m.thought,
        toolCalls: m.toolCalls
      }))
    }

    // ── Step 2/3/4: 引擎分阶段真实执行 ──
    const llmProvider = getLLMProviderSettings()
    const engine = new ValueScoringEngine({
      llmProvider: llmProvider.enabled ? llmProvider : undefined
    })

    const { report, evidenceHash } = await engine.evaluateStaged(evalCtx, {
      onEvidence: (ev) => {
        status(1, '提取会话轨迹与代码事实',
          `${ev.metrics.turnCount} 轮交互、${ev.metrics.toolCallCount} 次工具调用、${ev.metrics.realFileCount} 个改动文件`)
      },
      onScoring: () => {
        status(2, '启发式策略评分', '改动影响 / 推理密度 / 执行质量三策略并行计算...')
      },
      onJudge: (state, message) => {
        if (state === 'running') {
          status(3, 'AI 裁判复核', 'LLM 正在基于完整证据包复核...')
        } else if (state === 'unavailable') {
          status(3, 'AI 裁判不可用（已缺席）', `裁判调用失败（${message || '未知错误'}），静态策略权重重归一化，不注入中性分`, { judge: 'unavailable' })
        } else {
          status(3, 'AI 裁判跳过', '未配置 LLM Provider，仅使用确定性启发式评分', { judge: 'skipped' })
        }
      },
      onVerdict: () => {
        status(4, '综合裁决', 'confidence 加权、分类门与 veto flags 裁决中...')
      }
    })

    knowledgeService.saveEvaluation(report, activeSession.cli, evidenceHash || '')

    // ── Step 5: 知识抽取（仅 worth-saving；真实 LLM 流式抽取，无 LLM 则候选）──
    let harvestStatus: 'extracted' | 'candidate' | 'skipped' = 'skipped'
    let harvestedMemory = null
    let dedup: string | undefined

    if (report.isWorthSaving && body.autoHarvest !== false) {
      if (llmProvider.enabled && llmProvider.apiKey) {
        status(5, '知识资产抽取', `评估通过（${report.grade} 级 · ${report.category}），LLM 正在提炼可复用知识...`)
        try {
          const result = await knowledgeHarvest.harvest(
            { session: activeSession, messages, report },
            chunk => sendEvent('extract', { chunk })
          )
          harvestStatus = result.status
          dedup = result.dedup
          if (result.item) {
            harvestedMemory = {
              id: result.item.id,
              title: result.item.title,
              type: result.item.type,
              summary: result.item.summary
            }
            knowledgeService.updateHarvestResult(activeSession.id, activeSession.cli, 'extracted', result.item.id)
          } else {
            knowledgeService.updateHarvestResult(activeSession.id, activeSession.cli, 'candidate')
          }
        } catch (err) {
          harvestStatus = 'candidate'
          const message = err instanceof Error ? err.message : String(err)
          knowledgeService.updateHarvestResult(activeSession.id, activeSession.cli, 'candidate')
          sendEvent('extract-error', { message })
        }
      } else {
        harvestStatus = 'candidate'
        status(5, '待抽取候选', `评估通过（${report.grade} 级 · ${report.category}），但未配置 LLM，仅保存候选，不生成知识条目`, {
          judge: 'candidate'
        })
        knowledgeService.updateHarvestResult(activeSession.id, activeSession.cli, 'candidate')
      }
    } else {
      status(5, '无需沉淀', '未达沉淀线或被 veto，仅保存评估报告供洞察分析', { judge: 'skipped' })
    }

    sendEvent('done', {
      report,
      harvestedMemory,
      harvestStatus,
      dedup,
      sessionTitle: activeSession.title
    })
    res.end()
  } catch (err) {
    sendEvent('error', { message: (err as { message?: string })?.message || '评估流处理发生异常' })
    res.end()
  }
})
