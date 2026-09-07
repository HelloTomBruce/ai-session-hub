import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { adapterRegistry } from '../../../utils/adapter-registry'
import { EVALUATOR_SYSTEM_PROMPT, buildEvaluationPrompt, type AIEvaluationResult } from '../../../utils/evaluator-rubric'
import { getLLMProviderSettings } from '../../../utils/llm-provider-config'
import type { PlatformType } from '../../../utils/types'

const DIAGNOSIS_DIR = path.join(os.homedir(), '.session-hub', 'diagnoses')

export default defineEventHandler(async (event) => {
  const sessionId = getRouterParam(event, 'id')
  const query = getQuery(event)
  const platform = (query.cli as PlatformType) || 'agy'

  if (!sessionId) {
    throw createError({ statusCode: 400, message: 'Session ID is required' })
  }

  const { session, messages } = adapterRegistry.getMessages(platform, sessionId)
  if (!session) {
    throw createError({ statusCode: 404, message: `Session ${sessionId} not found on ${platform}` })
  }

  // 1. 构建标准 Prompt
  const userPrompt = buildEvaluationPrompt(session, messages)

  // 2. 读取用户配置的大模型 Provider 设置
  const provider = getLLMProviderSettings()

  if (provider.enabled && provider.apiKey) {
    try {
      const baseUrl = (provider.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')
      const modelName = provider.model || 'gpt-4o-mini'
      const temperature = provider.temperature ?? 0.1

      const reqBody: any = {
        model: modelName,
        messages: [
          { role: 'system', content: EVALUATOR_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt }
        ],
        temperature
      }

      // Some custom providers reject response_format: { type: 'json_object' }
      // We only include it for standard openai endpoints or fallback safely
      let rawContent = ''
      try {
        const resWithJson = await $fetch<any>(`${baseUrl}/chat/completions`, {
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
        rawContent = resWithJson.choices[0].message.content
      } catch (err1: any) {
        // Retry without response_format if 400 occurs
        console.warn(`[Evaluator] Failed with response_format, retrying plain prompt:`, err1?.data?.error || err1?.message)
        const resPlain = await $fetch<any>(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${provider.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: reqBody
        })
        rawContent = resPlain.choices[0].message.content
      }

      // Strip potential markdown code fences: ```json ... ```
      let cleanedJson = rawContent.trim()
      if (cleanedJson.startsWith('```')) {
        cleanedJson = cleanedJson.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
      }

      const parsed: AIEvaluationResult = JSON.parse(cleanedJson)
      parsed.evaluatedAt = Date.now()

      // Persist to local disk so it is remembered
      try {
        if (!fs.existsSync(DIAGNOSIS_DIR)) fs.mkdirSync(DIAGNOSIS_DIR, { recursive: true })
        fs.writeFileSync(path.join(DIAGNOSIS_DIR, `${sessionId}.json`), JSON.stringify(parsed, null, 2), 'utf-8')
      } catch (saveErr) {
        console.warn('[Evaluator] Failed to cache diagnosis report:', saveErr)
      }

      return {
        success: true,
        source: 'user_configured_llm',
        provider: {
          model: modelName,
          baseUrl
        },
        data: parsed
      }
    } catch (err: any) {
      const errDetails = err?.data ? JSON.stringify(err.data) : (err?.message || String(err))
      console.warn(`[Evaluator] Invoking configured LLM (${provider.model} at ${provider.baseUrl}) failed: ${errDetails}`)
    }
  }

  // 3. 本地确定性 Rubric 评估引擎（保底或离线运行）
  const fallbackResult = runDeterministicRubricEvaluation(session, messages)

  try {
    if (!fs.existsSync(DIAGNOSIS_DIR)) fs.mkdirSync(DIAGNOSIS_DIR, { recursive: true })
    fs.writeFileSync(path.join(DIAGNOSIS_DIR, `${sessionId}.json`), JSON.stringify(fallbackResult, null, 2), 'utf-8')
  } catch {}

  return {
    success: true,
    source: 'rubric_engine',
    data: fallbackResult
  }
})

/**
 * 确定性 Rubric 评估引擎
 */
function runDeterministicRubricEvaluation(session: any, messages: any[]): AIEvaluationResult {
  let editCount = 0
  let searchCount = 0
  let commandCount = 0
  let backtrackCount = 0
  let userTurns = 0
  let assistantTurns = 0
  const deductions: AIEvaluationResult['deductions'] = []

  let currentTurn = 1
  for (const msg of messages) {
    if (msg.role === 'user') {
      userTurns++
      currentTurn++
    } else if (msg.role === 'assistant') {
      assistantTurns++

      // 严格识别真正的自我否定句式
      if (msg.thought) {
        const thought = msg.thought
        const isTrueBacktrack = 
          /等等|不对|刚才的改动|改错了|不能这样|放弃这个方案|撤销之前的修改|无法正常工作|wait,\s*(this|my|that)\s*(won't|broke|failed|is wrong)/i.test(thought) &&
          !/用户报错|用户提到|正常排查|排查该问题/i.test(thought)

        if (isTrueBacktrack) {
          backtrackCount++
          deductions.push({
            category: 'backtrack',
            turn: currentTurn,
            title: `第 ${currentTurn} 轮: 方案出现推翻与思路自我修正`,
            deductionPoints: 6,
            reason: '思考链中显式推翻了前序假设或推导方案，产生了重试开销。',
            evidenceSnippet: thought.slice(0, 200) + (thought.length > 200 ? '...' : '')
          })
        }
      }

      if (msg.toolCalls && msg.toolCalls.length) {
        let turnSearches = 0
        for (const tool of msg.toolCalls) {
          const rawName = tool.name || tool.type || ''
          const name = rawName.toLowerCase()
          if (/edit|write|replace|modify|patch|create/i.test(name)) {
            editCount++
          } else if (/grep|find|search|glob|list_dir|view_file|read/i.test(name)) {
            searchCount++
            turnSearches++
          } else if (/command|run_command|bash|exec/i.test(name)) {
            commandCount++
          }
        }

        if (turnSearches >= 8) {
          deductions.push({
            category: 'search_heavy',
            turn: currentTurn,
            title: `第 ${currentTurn} 轮: 单轮触发大量密集搜索 (${turnSearches} 次)`,
            deductionPoints: 8,
            reason: '单轮发生高密度盲目搜索，反映出对代码结构缺少先验认知。',
            evidenceSnippet: msg.toolCalls.map((t: any) => (t.name || t.type || 'tool').replace(/^default_api:/, '')).join(', ')
          })
        }
      }
    }
  }

  // 1. Directness (35%)
  let directness = 100
  const totalExplores = searchCount
  if (editCount > 0) {
    const ratio = totalExplores / editCount
    if (ratio <= 3) directness = 100
    else if (ratio <= 6) directness = 88
    else if (ratio <= 12) directness = 72
    else directness = 55
  } else if (totalExplores > 8) {
    directness = 60
  }

  // 2. Decision Soundness (30%)
  const decisionSoundness = Math.max(20, 100 - backtrackCount * 18)

  // 3. Turn Velocity (20%)
  let turnVelocity = 100
  if (userTurns > 4) {
    turnVelocity = Math.max(30, 100 - (userTurns - 4) * 12)
  }

  // 4. Action Density (15%)
  let actionDensity = 90
  if (editCount >= 1) actionDensity = 100
  else if (commandCount > 10 && editCount === 0) actionDensity = 60

  const totalScore = Math.round(
    directness * 0.35 +
    decisionSoundness * 0.30 +
    turnVelocity * 0.20 +
    actionDensity * 0.15
  )

  const finalScore = Math.max(20, Math.min(100, totalScore))

  let grade: 'S' | 'A' | 'B' | 'C' = 'A'
  let gradeLabel = '稳健高效'
  if (finalScore >= 90) { grade = 'S'; gradeLabel = '极速闭环 (One-Shot)' }
  else if (finalScore >= 75) { grade = 'A'; gradeLabel = '稳健高效 (Systematic)' }
  else if (finalScore >= 60) { grade = 'B'; gradeLabel = '偶有波折 (Friction-heavy)' }
  else { grade = 'C'; gradeLabel = '低效循环 (Lost in Context)' }

  const strengths: string[] = []
  const bottlenecks: string[] = []
  const prescriptions: string[] = []

  if (directness >= 85) strengths.push('代码定位非常精准，以极少的文件探索快速命中目标修改点。')
  if (decisionSoundness >= 90) strengths.push('推导逻辑严密，方案一次性通过，无多余的反复推翻。')
  if (userTurns <= 3) strengths.push('自主解决能力强，在极少轮次内达成了任务闭环。')

  if (directness < 75) {
    bottlenecks.push('文件探索比例偏高，存在较多跨目录盲搜。')
    prescriptions.push('建议为项目引入代码图谱 MCP (如 codebase-memory-mcp) 增强导航能力。')
  }
  if (backtrackCount > 0) {
    bottlenecks.push(`会话中出现了 ${backtrackCount} 次方案推翻或修正重试。`)
    prescriptions.push('在初始 Prompt 中明确约束修改范围和上下文边界，避免中途推翻。')
  }
  if (userTurns > 6) {
    bottlenecks.push(`交互轮次较多 (${userTurns} 轮问答)，存在多轮纠偏。`)
    prescriptions.push('建议开启 /plan 模式先制定分步实施计划，减少交互拉扯。')
  }

  if (!strengths.length) strengths.push('完成了指定的基本工作流与交互任务。')
  if (!prescriptions.length) prescriptions.push('本次会话执行高效，符合工程规范，无需特殊改进。')

  return {
    score: finalScore,
    grade,
    gradeLabel,
    taskSummary: session.title || '完成代码开发与调试任务',
    taskCompletionStatus: 'Full',
    subScores: {
      directness,
      decisionSoundness,
      turnVelocity,
      actionDensity
    },
    deductions,
    strengths,
    bottlenecks,
    prescriptions,
    evaluatedAt: Date.now()
  }
}
