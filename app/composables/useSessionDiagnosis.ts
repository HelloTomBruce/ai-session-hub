import type { SessionMessage } from '../../server/utils/types'
import { toValue, type ComputedRef, type MaybeRefOrGetter } from 'vue'

// Shape of the AI diagnosis report served by /api/sessions/:id/diagnose (and its stream endpoint)
interface AIDiagnosisResult {
  score: number
  grade: 'S' | 'A' | 'B' | 'C'
  gradeLabel: string
  taskSummary: string
  taskCompletionStatus: string
  subScores?: {
    directness?: number
    decisionSoundness?: number
    turnVelocity?: number
    actionDensity?: number
    friction?: number
    turn?: number
    action?: number
  }
  deductions?: Array<{
    category: string
    turn: number
    title: string
    deductionPoints: number
    reason?: string
    evidenceSnippet?: string
  }>
  prescriptions?: string[]
  recommendations?: string[]
}

/**
 * 会话效能诊断：本地磁盘缓存报告加载、SSE 流式诊断、
 * 诊断结果优先 / 否则确定性规则引擎兜底的效能分析。
 */
export async function useSessionDiagnosis(
  sessionId: ComputedRef<string>,
  platform: ComputedRef<string>,
  messagesRef: MaybeRefOrGetter<SessionMessage[]>
) {
  const toast = useToast()

  const isEfficiencyModalOpen = ref(false)
  const isDiagnosing = ref(false)
  const aiDiagnosisResult = ref<AIDiagnosisResult | null>(null)

  // Auto-load saved diagnosis report from local disk cache
  const { data: cachedDiagnosisRes } = await useFetch<{ success: boolean, hasSavedReport: boolean, data: AIDiagnosisResult }>(
    () => `/api/sessions/${sessionId.value}/diagnose?cli=${platform.value}`
  )

  if (cachedDiagnosisRes.value?.data) {
    aiDiagnosisResult.value = cachedDiagnosisRes.value.data
  }

  const diagnoseStatus = ref('')
  const diagnoseStreamText = ref('')

  const runAIDiagnosis = async () => {
    isDiagnosing.value = true
    diagnoseStatus.value = '正在启动 AI 效能诊断引擎...'
    diagnoseStreamText.value = ''

    try {
      const response = await fetch(`/api/sessions/${sessionId.value}/diagnose/stream?cli=${platform.value}`, {
        method: 'POST'
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({ message: '诊断请求失败' }))
        throw new Error(err.message || '诊断请求失败')
      }

      if (!response.body) {
        throw new Error('未获取到流式响应')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder('utf-8')
      let buffer = ''

      const handleEventBlock = (block: string) => {
        if (!block.trim()) return
        let eventType = 'message'
        let dataStr = ''

        for (const line of block.split('\n')) {
          const trimmed = line.trim()
          if (trimmed.startsWith('event:')) {
            eventType = trimmed.slice(6).trim()
          } else if (trimmed.startsWith('data:')) {
            dataStr = trimmed.slice(5).trim()
          }
        }

        if (!dataStr) return

        try {
          const parsed = JSON.parse(dataStr)
          if (eventType === 'status') {
            diagnoseStatus.value = parsed.message || ''
          } else if (eventType === 'chunk') {
            diagnoseStreamText.value += parsed.text || ''
          } else if (eventType === 'done') {
            if (parsed.data) {
              aiDiagnosisResult.value = parsed.data
            }
          } else if (eventType === 'error') {
            throw new Error(parsed.message || '诊断发生错误')
          }
        } catch (jsonErr) {
          if (eventType === 'error') throw jsonErr
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          if (buffer.trim()) {
            handleEventBlock(buffer)
          }
          break
        }

        buffer += decoder.decode(value, { stream: true })
        const blocks = buffer.split('\n\n')
        buffer = blocks.pop() || ''

        for (const block of blocks) {
          handleEventBlock(block)
        }
      }
    } catch (err) {
      toast.add({ title: (err as { message?: string } | null | undefined)?.message || 'AI 诊断失败', color: 'error', icon: 'i-lucide-alert-triangle' })
    } finally {
      isDiagnosing.value = false
    }
  }

  // Active efficiency analysis: Prioritizes AI Diagnosis result if available, falls back to deterministic rule analysis
  const efficiencyAnalysis = computed(() => {
  // If AI Diagnosis result is available, use AI result directly
    if (aiDiagnosisResult.value) {
      const ai = aiDiagnosisResult.value
      return {
        isAIEvaluated: true,
        score: ai.score,
        grade: ai.grade,
        gradeColor: ai.grade === 'S' ? 'emerald' : ai.grade === 'A' ? 'blue' : ai.grade === 'B' ? 'amber' : 'red',
        gradeLabel: ai.gradeLabel,
        taskSummary: ai.taskSummary,
        taskCompletionStatus: ai.taskCompletionStatus,
        userTurns: toValue(messagesRef).filter((m: SessionMessage) => m.role === 'user').length,
        assistantTurns: toValue(messagesRef).filter((m: SessionMessage) => m.role === 'assistant').length,
        editCount: toValue(messagesRef).reduce((acc: number, m: SessionMessage) => acc + (m.toolCalls?.filter(t => /edit|write|replace|modify|patch|create/i.test(t.name || t.type || '')).length || 0), 0),
        searchCount: toValue(messagesRef).reduce((acc: number, m: SessionMessage) => acc + (m.toolCalls?.filter(t => /grep|find|search|glob|list_dir|view_file|read/i.test(t.name || t.type || '')).length || 0), 0),
        commandCount: toValue(messagesRef).reduce((acc: number, m: SessionMessage) => acc + (m.toolCalls?.filter(t => /command|run_command|bash|exec/i.test(t.name || t.type || '')).length || 0), 0),
        backtrackCount: ai.deductions?.filter(d => d.category === 'backtrack').length || 0,
        searchToEditRatio: (toValue(messagesRef).reduce((acc: number, m: SessionMessage) => acc + (m.toolCalls?.filter(t => /grep|find|search|glob|list_dir|view_file|read/i.test(t.name || t.type || '')).length || 0), 0) / Math.max(1, toValue(messagesRef).reduce((acc: number, m: SessionMessage) => acc + (m.toolCalls?.filter(t => /edit|write|replace|modify|patch|create/i.test(t.name || t.type || '')).length || 0), 0))).toFixed(1),
        directness: ai.subScores?.directness || 90,
        subScores: {
          directness: ai.subScores?.directness || 90,
          friction: ai.subScores?.decisionSoundness ?? (ai.subScores?.friction || 90),
          turn: ai.subScores?.turnVelocity ?? (ai.subScores?.turn || 85),
          action: ai.subScores?.actionDensity ?? (ai.subScores?.action || 85)
        },
        frictionEvents: (ai.deductions || []).map(d => ({
          turn: d.turn,
          title: d.title,
          type: d.category === 'search_heavy' ? 'search_heavy' : d.category === 'turn_excess' ? 'turn_excess' : 'backtrack',
          detail: d.reason || d.evidenceSnippet,
          impact: `扣 ${d.deductionPoints} 分`,
          toolSnippet: d.evidenceSnippet
        })),
        recommendations: ai.prescriptions || ai.recommendations || []
      }
    }

    // Otherwise, default deterministic rule engine
    let editCount = 0
    let searchCount = 0
    let commandCount = 0
    let backtrackCount = 0
    let userTurns = 0
    let assistantTurns = 0
    const frictionEvents: Array<{
      turn: number
      title: string
      type: 'backtrack' | 'search_heavy' | 'command_error' | 'turn_excess'
      detail: string
      impact: string
      contextText?: string
      toolSnippet?: string
    }> = []

    let currentTurn = 1
    for (const msg of toValue(messagesRef)) {
      if (msg.role === 'user') {
        userTurns++
        currentTurn++
      } else if (msg.role === 'assistant') {
        assistantTurns++
        if (msg.thought) {
        // Detect backtracking or self-correction in thoughts
          if (/报错|不对|重新|更换方案|尝试另一种|理解有误|failed|error|wait|fix|改写|回滚|放弃/i.test(msg.thought)) {
            backtrackCount++
            frictionEvents.push({
              turn: currentTurn,
              title: '思维链推导遇阻 / 方案修正推翻',
              type: 'backtrack',
              detail: msg.thought,
              impact: '扣 6 分 (增加重试与返工成本)',
              contextText: msg.thought
            })
          }
        }
        if (msg.toolCalls && msg.toolCalls.length) {
          let msgSearchCount = 0
          for (const tool of msg.toolCalls) {
            const rawName = tool.name || tool.type || ''
            const name = rawName.toLowerCase()

            if (/edit|write|replace|modify|patch|create/i.test(name)) {
              editCount++
            } else if (/grep|find|search|glob|list_dir|view_file|read/i.test(name)) {
              searchCount++
              msgSearchCount++
            } else if (/command|run_command|bash|exec/i.test(name)) {
              commandCount++
            }
          }

          // Single-turn massive exploration warning
          if (msgSearchCount >= 8) {
            frictionEvents.push({
              turn: currentTurn,
              title: `单轮深度搜索密集 (${msgSearchCount} 次检索)`,
              type: 'search_heavy',
              detail: `在第 ${currentTurn} 轮交互中连续触发了 ${msgSearchCount} 次文件检索/代码阅读工具，反映出缺乏预置项目图谱时的盲搜成本。`,
              impact: '影响路径精准度得分',
              toolSnippet: msg.toolCalls.map(t => (t.name || t.type || 'tool').replace(/^default_api:/, '')).join(', ')
            })
          }
        }
      }
    }

    // Check overall excessive turns
    if (userTurns > 6) {
      frictionEvents.push({
        turn: userTurns,
        title: `交互轮次过多 (${userTurns} 问 / ${assistantTurns} 答)`,
        type: 'turn_excess',
        detail: `当前会话经历 ${userTurns} 轮次用户提示与纠偏才达成目标，超过了常规单任务 1~3 轮的敏捷闭环标准。`,
        impact: `扣 ${Math.min(30, (userTurns - 6) * 10)} 分 (周转效率)`
      })
    }

    const totalActions = editCount + searchCount + commandCount
    // Exploration to Edit ratio
    const searchToEditRatio = editCount > 0 ? (searchCount / editCount).toFixed(1) : searchCount.toFixed(1)

    // 1. Directness Sub-score (35%)
    let directnessScore = 100
    if (totalActions > 0) {
      if (editCount === 0 && searchCount > 10) directnessScore = 50
      else if (editCount > 0) {
        const ratioNum = searchCount / editCount
        if (ratioNum <= 3) directnessScore = 100
        else if (ratioNum <= 6) directnessScore = 85
        else if (ratioNum <= 12) directnessScore = 70
        else directnessScore = 50
      }
    }

    // 2. Friction Sub-score (30%)
    const frictionScore = Math.max(0, 100 - backtrackCount * 15)

    // 3. Turn Efficiency Sub-score (20%)
    let turnScore = 100
    if (userTurns > 6) turnScore = Math.max(30, 100 - (userTurns - 6) * 10)

    // 4. Action Density Sub-score (15%)
    let actionScore = 100
    if (totalActions > 25 && editCount <= 1) actionScore = 50

    // Composite Score
    const compositeScore = Math.round(
      directnessScore * 0.35
      + frictionScore * 0.30
      + turnScore * 0.20
      + actionScore * 0.15
    )

    const score = Math.max(20, Math.min(100, compositeScore))

    // Grade
    let grade: 'S' | 'A' | 'B' | 'C'
    let gradeColor: string
    let gradeLabel: string

    if (score >= 90) {
      grade = 'S'
      gradeColor = 'emerald'
      gradeLabel = '极速闭环 (One-Shot)'
    } else if (score >= 75) {
      grade = 'A'
      gradeColor = 'blue'
      gradeLabel = '稳健高效 (Systematic)'
    } else if (score >= 60) {
      grade = 'B'
      gradeColor = 'amber'
      gradeLabel = '偶有波折 (Friction-heavy)'
    } else {
      grade = 'C'
      gradeColor = 'red'
      gradeLabel = '低效循环 (Lost in Context)'
    }

    // Actionable Insights / Recommendations
    const recommendations: string[] = []
    if (Number(searchToEditRatio) > 6) {
      recommendations.push('检索与探索占比偏高：建议为该项目配置代码知识图谱 (如 codebase-memory-mcp) 或技能库，减少文件盲搜。')
    }
    if (backtrackCount >= 2) {
      recommendations.push('思维链出现多次修正：建议在初始需求 Prompt 中提供更具体的错误堆栈、复现步骤或预期产出。')
    }
    if (userTurns > 8) {
      recommendations.push('多轮纠偏拉扯：建议采用“先制定分步 Plan 再执行”的模式，提高单轮解决率。')
    }
    if (!recommendations.length) {
      recommendations.push('该会话执行精准且收敛迅速，符合高效编码的最佳实践。')
    }

    return {
      isAIEvaluated: false,
      score,
      grade,
      gradeColor,
      gradeLabel,
      userTurns,
      assistantTurns,
      editCount,
      searchCount,
      commandCount,
      backtrackCount,
      searchToEditRatio,
      directness: directnessScore,
      subScores: {
        directness: directnessScore,
        friction: frictionScore,
        turn: turnScore,
        action: actionScore
      },
      frictionEvents,
      recommendations
    }
  })

  return {
    isEfficiencyModalOpen,
    isDiagnosing,
    aiDiagnosisResult,
    diagnoseStatus,
    diagnoseStreamText,
    runAIDiagnosis,
    efficiencyAnalysis
  }
}
