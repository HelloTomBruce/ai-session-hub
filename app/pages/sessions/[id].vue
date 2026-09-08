<script setup lang="ts">
const route = useRoute()
const router = useRouter()

const sessionId = computed(() => route.params.id as string)
const platform = computed(() => (route.query.cli as string) || '')

const detailMode = ref<'chat' | 'thinking'>('chat')
const isRefreshing = ref(false)

const sourceMeta: Record<string, { name: string; type: string; icon: string }> = {
  pi: { name: 'Pi CLI', type: 'CLI', icon: 'i-lucide-terminal' },
  opencode: { name: 'OpenCode', type: 'CLI', icon: 'i-lucide-code-2' },
  agy: { name: 'AGY CLI', type: 'CLI', icon: 'i-lucide-sparkles' },
  claude: { name: 'Claude Code', type: 'CLI', icon: 'i-lucide-bot' },
  codex: { name: 'Codex App', type: 'APP', icon: 'i-lucide-cpu' },
  workbuddy: { name: 'WorkBuddy', type: 'APP', icon: 'i-lucide-briefcase' },
  reasonix: { name: 'Reasonix', type: 'APP', icon: 'i-lucide-brain-circuit' }
}

const { data: sessionRes, pending, refresh } = await useFetch<{ success: boolean, data: any }>(
  () => `/api/sessions/${sessionId.value}?cli=${platform.value}`
)

const session = computed(() => sessionRes.value?.data?.session)
const messages = computed(() => sessionRes.value?.data?.messages || [])

const handleRefresh = async () => {
  isRefreshing.value = true
  await refresh()
  isRefreshing.value = false
}

// Edit Title Modal
const isEditOpen = ref(false)
const editingTitle = ref('')
const isSavingEdit = ref(false)

const openEditModal = () => {
  if (session.value) {
    editingTitle.value = session.value.title || ''
    isEditOpen.value = true
  }
}

const saveEditTitle = async () => {
  if (!session.value || !sessionId.value || !platform.value) return
  isSavingEdit.value = true
  try {
    const res = await $fetch<{ success: boolean, message?: string }>(`/api/sessions/${sessionId.value}?cli=${platform.value}`, {
      method: 'PUT',
      body: { title: editingTitle.value }
    })
    if (res.success) {
      if (session.value) {
        session.value.title = editingTitle.value
      }
      isEditOpen.value = false
      await refresh()
    } else {
      alert(res.message || '修改失败')
    }
  } catch (err: any) {
    alert(err?.data?.message || err?.message || '修改失败')
  } finally {
    isSavingEdit.value = false
  }
}

const formatTime = (ts?: number) => {
  if (!ts) return '-'
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const copyResumeCommand = () => {
  if (!session.value) return
  let cmd = ''
  const cli = session.value.cli
  const cwd = session.value.cwd
  const id = session.value.id

  if (cli === 'pi') {
    cmd = `cd "${cwd}" && pi --resume`
  } else if (cli === 'opencode') {
    cmd = `cd "${cwd}" && opencode session ${id}`
  } else if (cli === 'agy') {
    cmd = `agy resume --id ${id}`
  } else if (cli === 'claude') {
    cmd = `cd "${cwd}" && claude --resume`
  } else if (cli === 'codex') {
    cmd = `open -a "Codex" || cd "${cwd}" && codex thread ${id}`
  } else if (cli === 'workbuddy') {
    cmd = `open -a "WorkBuddy"`
  } else if (cli === 'reasonix') {
    cmd = `open -a "Reasonix"`
  }

  navigator.clipboard.writeText(cmd)
  alert(`已复制启动命令到剪贴板：\n${cmd}`)
}

// Tool & Skill analytics computation
const isToolModalOpen = ref(false)
const selectedToolName = ref('')
const selectedToolCalls = ref<Array<{
  index: number
  timestamp?: number
  name: string
  arguments: any
  summary: string
  associatedThought?: string
}>>([])

const openToolDetails = (toolName: string) => {
  selectedToolName.value = toolName
  const calls: Array<{
    index: number
    timestamp?: number
    name: string
    arguments: any
    summary: string
    associatedThought?: string
  }> = []

  let callIndex = 1
  for (const msg of messages.value) {
    if (msg.toolCalls && msg.toolCalls.length) {
      for (const tool of msg.toolCalls) {
        let name = tool.name || tool.type || 'unknown_tool'
        name = name.replace(/^default_api:/, '').replace(/^mcp__.*?__/, '')
        
        if (name === toolName) {
          const rawArgs = tool.arguments || tool.args || tool.input || {}
          let parsedArgs = rawArgs
          if (typeof rawArgs === 'string') {
            try {
              parsedArgs = JSON.parse(rawArgs)
            } catch {
              parsedArgs = rawArgs
            }
          }

          // Extract quick summary
          let summary = ''
          if (parsedArgs.CommandLine) {
            summary = parsedArgs.CommandLine
          } else if (parsedArgs.AbsolutePath || parsedArgs.TargetFile || parsedArgs.SearchDirectory || parsedArgs.SearchPath) {
            summary = parsedArgs.AbsolutePath || parsedArgs.TargetFile || parsedArgs.SearchDirectory || parsedArgs.SearchPath
          } else if (parsedArgs.Query || parsedArgs.Pattern || parsedArgs.query) {
            summary = `Query: "${parsedArgs.Query || parsedArgs.Pattern || parsedArgs.query}"`
          } else if (parsedArgs.Prompt || parsedArgs.prompt) {
            summary = parsedArgs.Prompt || parsedArgs.prompt
          } else if (parsedArgs.Url || parsedArgs.url) {
            summary = parsedArgs.Url || parsedArgs.url
          } else {
            summary = typeof parsedArgs === 'object' ? Object.keys(parsedArgs).join(', ') : String(parsedArgs)
          }

          calls.push({
            index: callIndex++,
            timestamp: msg.timestamp,
            name,
            arguments: parsedArgs,
            summary,
            associatedThought: msg.thought
          })
        }
      }
    }
  }

  selectedToolCalls.value = calls
  isToolModalOpen.value = true
}

const toolStats = computed(() => {
  const counts: Record<string, number> = {}
  const skillSet = new Set<string>()

  for (const msg of messages.value) {
    if (msg.toolCalls && msg.toolCalls.length) {
      for (const tool of msg.toolCalls) {
        let name = tool.name || tool.type || 'unknown_tool'
        // normalize tool name
        name = name.replace(/^default_api:/, '').replace(/^mcp__.*?__/, '')
        counts[name] = (counts[name] || 0) + 1

        // Detect Skill invocation
        const argsStr = typeof tool.arguments === 'string' ? tool.arguments : JSON.stringify(tool.arguments || tool.args || tool.input || {})
        if (name === 'view_file' || name === 'read_file') {
          const match = argsStr.match(/skills\/([^/]+)\/SKILL\.md/i) || argsStr.match(/skills\/([^/"'\\]+)/i)
          if (match && match[1]) {
            skillSet.add(match[1])
          }
        } else if (name.toLowerCase().includes('skill')) {
          skillSet.add(name)
        }
      }
    }

    // Also check text or thought mentions of skills
    if (msg.thought) {
      const skillMatches = msg.thought.matchAll(/skill:\s*([a-zA-Z0-9_-]+)/gi)
      for (const m of skillMatches) {
        if (m[1]) skillSet.add(m[1])
      }
    }
  }

  const sortedTools = Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)

  const totalToolCalls = sortedTools.reduce((sum, item) => sum + item.count, 0)

  return {
    totalToolCalls,
    uniqueToolCount: sortedTools.length,
    tools: sortedTools,
    skills: Array.from(skillSet)
  }
})

// Session Efficiency & Health Evaluation model
const isEfficiencyModalOpen = ref(false)
const isDiagnosing = ref(false)
const aiDiagnosisResult = ref<any>(null)

// Auto-load saved diagnosis report from local disk cache
const { data: cachedDiagnosisRes } = await useFetch<{ success: boolean, hasSavedReport: boolean, data: any }>(
  () => `/api/sessions/${sessionId.value}/diagnose?cli=${platform.value}`
)

if (cachedDiagnosisRes.value?.data) {
  aiDiagnosisResult.value = cachedDiagnosisRes.value.data
}

const runAIDiagnosis = async () => {
  isDiagnosing.value = true
  try {
    const res = await $fetch<{ success: boolean, source: string, data: any }>(
      `/api/sessions/${sessionId.value}/diagnose?cli=${platform.value}`,
      { method: 'POST' }
    )
    if (res?.data) {
      aiDiagnosisResult.value = res.data
    }
  } catch (err: any) {
    alert(err?.data?.message || 'AI 诊断失败')
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
      userTurns: messages.value.filter((m: SessionMessage) => m.role === 'user').length,
      assistantTurns: messages.value.filter((m: SessionMessage) => m.role === 'assistant').length,
      editCount: messages.value.reduce((acc: number, m: SessionMessage) => acc + (m.toolCalls?.filter((t: any) => /edit|write|replace|modify|patch|create/i.test(t.name || t.type || '')).length || 0), 0),
      searchCount: messages.value.reduce((acc: number, m: SessionMessage) => acc + (m.toolCalls?.filter((t: any) => /grep|find|search|glob|list_dir|view_file|read/i.test(t.name || t.type || '')).length || 0), 0),
      commandCount: messages.value.reduce((acc: number, m: SessionMessage) => acc + (m.toolCalls?.filter((t: any) => /command|run_command|bash|exec/i.test(t.name || t.type || '')).length || 0), 0),
      backtrackCount: ai.deductions?.filter((d: any) => d.category === 'backtrack').length || 0,
      searchToEditRatio: (messages.value.reduce((acc: number, m: SessionMessage) => acc + (m.toolCalls?.filter((t: any) => /grep|find|search|glob|list_dir|view_file|read/i.test(t.name || t.type || '')).length || 0), 0) / Math.max(1, messages.value.reduce((acc: number, m: SessionMessage) => acc + (m.toolCalls?.filter((t: any) => /edit|write|replace|modify|patch|create/i.test(t.name || t.type || '')).length || 0), 0))).toFixed(1),
      directness: ai.subScores?.directness || 90,
      subScores: {
        directness: ai.subScores?.directness || 90,
        friction: ai.subScores?.decisionSoundness ?? (ai.subScores?.friction || 90),
        turn: ai.subScores?.turnVelocity ?? (ai.subScores?.turn || 85),
        action: ai.subScores?.actionDensity ?? (ai.subScores?.action || 85)
      },
      frictionEvents: (ai.deductions || []).map((d: any) => ({
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
  for (const msg of messages.value) {
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
          const args = typeof tool.arguments === 'string' ? tool.arguments : JSON.stringify(tool.arguments || tool.args || tool.input || {})

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
            toolSnippet: msg.toolCalls.map((t: any) => (t.name || t.type || 'tool').replace(/^default_api:/, '')).join(', ')
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
  let frictionScore = Math.max(0, 100 - backtrackCount * 15)

  // 3. Turn Efficiency Sub-score (20%)
  let turnScore = 100
  if (userTurns > 6) turnScore = Math.max(30, 100 - (userTurns - 6) * 10)

  // 4. Action Density Sub-score (15%)
  let actionScore = 100
  if (totalActions > 25 && editCount <= 1) actionScore = 50

  // Composite Score
  const compositeScore = Math.round(
    directnessScore * 0.35 +
    frictionScore * 0.30 +
    turnScore * 0.20 +
    actionScore * 0.15
  )

  const score = Math.max(20, Math.min(100, compositeScore))

  // Grade
  let grade: 'S' | 'A' | 'B' | 'C' = 'A'
  let gradeColor = 'emerald'
  let gradeLabel = '高效推进'

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

  // Actionable Insights / Prescriptions
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

// Thinking Timeline computation
const thinkingTimeline = computed(() => {
  const list: Array<{
    type: 'intent' | 'thought' | 'tool' | 'conclusion'
    title: string
    detail?: string
    timestamp?: number
    badge?: string
    role: string
  }> = []

  for (const msg of messages.value) {
    if (msg.role === 'user') {
      list.push({
        type: 'intent',
        title: '用户提出意图 / 任务需求',
        detail: msg.content,
        timestamp: msg.timestamp,
        role: 'user'
      })
    } else if (msg.role === 'assistant') {
      if (msg.thought) {
        list.push({
          type: 'thought',
          title: '思维链推导与架构选型 (Thinking Rationale)',
          detail: msg.thought,
          timestamp: msg.timestamp,
          role: 'assistant'
        })
      }
      if (msg.toolCalls && msg.toolCalls.length) {
        for (const tool of msg.toolCalls) {
          const rawName = tool.name || tool.type || 'Tool'
          const name = rawName.replace(/^default_api:/, '')
          const args = typeof tool.arguments === 'string' ? tool.arguments : JSON.stringify(tool.arguments || tool.args || tool.input || {})
          list.push({
            type: 'tool',
            title: `工具调用: ${name}`,
            detail: args,
            badge: name,
            timestamp: msg.timestamp,
            role: 'tool'
          })
        }
      }
      if (msg.content && msg.content.trim()) {
        list.push({
          type: 'conclusion',
          title: '方案产出 / 答复反馈',
          detail: msg.content,
          timestamp: msg.timestamp,
          role: 'assistant'
        })
      }
    }
  }
  return list
})
</script>

<template>
  <div class="space-y-5 pb-12">
    <!-- Top Nav / Back Banner -->
    <div class="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 shadow-sm">
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div class="flex items-start md:items-center gap-3">
          <NuxtLink to="/">
            <UButton variant="outline" color="neutral" size="sm" icon="i-lucide-arrow-left">
              返回清单
            </UButton>
          </NuxtLink>

          <div class="space-y-0.5">
            <div class="flex items-center gap-2">
              <span class="px-2 py-0.5 rounded text-[11px] font-medium font-mono bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
                <UIcon :name="sourceMeta[platform]?.icon || 'i-lucide-terminal'" class="w-3.5 h-3.5" />
                {{ sourceMeta[platform]?.name || platform.toUpperCase() }}
              </span>
              <span class="text-xs text-zinc-400 font-mono">ID: {{ sessionId }}</span>
            </div>
            <div class="flex items-center gap-2">
              <h1 class="text-base font-bold text-zinc-900 dark:text-zinc-100">
                {{ session?.title || '会话详情' }}
              </h1>
              <UButton
                size="xs"
                variant="ghost"
                color="neutral"
                icon="i-lucide-edit-3"
                title="修改会话标题"
                @click="openEditModal"
              />
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2 self-end md:self-auto">
          <UButton
            size="sm"
            variant="outline"
            color="neutral"
            icon="i-lucide-rotate-cw"
            :loading="isRefreshing"
            @click="handleRefresh"
          >
            刷新
          </UButton>
          <UButton
            size="sm"
            color="neutral"
            class="bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
            icon="i-lucide-play"
            @click="copyResumeCommand"
          >
            复制启动命令
          </UButton>
        </div>
      </div>

      <!-- Info badges bar -->
      <div class="flex flex-wrap items-center justify-between gap-4 text-xs text-zinc-500 dark:text-zinc-400 pt-3 mt-3 border-t border-zinc-100 dark:border-zinc-800">
        <div class="flex flex-wrap items-center gap-4">
          <div class="flex items-center gap-1 font-mono">
            <UIcon name="i-lucide-folder" class="w-3.5 h-3.5 text-zinc-400" />
            <span>{{ session?.cwd || '默认工作目录' }}</span>
          </div>
          <div v-if="session?.updatedAt" class="flex items-center gap-1 font-mono">
            <UIcon name="i-lucide-clock" class="w-3.5 h-3.5 text-zinc-400" />
            <span>更新时间: {{ formatTime(session.updatedAt) }}</span>
          </div>
          <div v-if="session?.model" class="flex items-center gap-1 font-mono">
            <UIcon name="i-lucide-cpu" class="w-3.5 h-3.5 text-zinc-400" />
            <span>模型: {{ session.model }}</span>
          </div>
          <div v-if="session?.cost" class="flex items-center gap-1 font-mono">
            <UIcon name="i-lucide-dollar-sign" class="w-3.5 h-3.5 text-zinc-400" />
            <span>花费: ${{ session.cost.toFixed(4) }}</span>
          </div>
        </div>

        <!-- Efficiency Rating Badge (Clickable for Diagnosis Report) -->
        <button
          @click="isEfficiencyModalOpen = true"
          class="flex items-center gap-2 bg-zinc-50 dark:bg-zinc-800/80 hover:bg-zinc-100 dark:hover:bg-zinc-750 px-2.5 py-1 rounded-md border border-zinc-200/80 dark:border-zinc-700/60 font-mono transition-all cursor-pointer group shadow-2xs"
          title="点击查看会话效能诊断报告与扣分归因"
        >
          <span class="text-[11px] text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
            <UIcon name="i-lucide-activity" class="w-3.5 h-3.5 text-zinc-500 group-hover:text-zinc-900 dark:group-hover:text-zinc-100" />
            会话效能:
          </span>
          <span
            :class="[
              'px-1.5 py-0.2 rounded font-bold text-xs shadow-2xs',
              efficiencyAnalysis.grade === 'S' ? 'bg-emerald-500 text-white' :
              efficiencyAnalysis.grade === 'A' ? 'bg-blue-500 text-white' :
              efficiencyAnalysis.grade === 'B' ? 'bg-amber-500 text-white' :
              'bg-red-500 text-white'
            ]"
          >
            {{ efficiencyAnalysis.grade }} 级
          </span>
          <span class="text-[11px] font-bold text-zinc-800 dark:text-zinc-200">{{ efficiencyAnalysis.score }}分</span>
          <span class="text-[10px] text-zinc-400 font-sans">({{ efficiencyAnalysis.gradeLabel }})</span>
          <UIcon name="i-lucide-chevron-right" class="w-3.5 h-3.5 text-zinc-400 group-hover:translate-x-0.5 transition-transform" />
        </button>
      </div>

      <!-- Efficiency Insights Breakdown -->
      <div class="pt-3 mt-3 border-t border-zinc-100 dark:border-zinc-800 flex flex-wrap items-center gap-4 text-xs font-mono">
        <div class="flex items-center gap-1 text-zinc-600 dark:text-zinc-300">
          <UIcon name="i-lucide-target" class="w-3.5 h-3.5 text-blue-500" />
          <span>路径精准度: <strong class="text-zinc-900 dark:text-zinc-100">{{ efficiencyAnalysis.directness }}%</strong></span>
        </div>
        <div class="flex items-center gap-1 text-zinc-600 dark:text-zinc-300">
          <UIcon name="i-lucide-repeat" class="w-3.5 h-3.5 text-purple-500" />
          <span>搜索/修改比: <strong class="text-zinc-900 dark:text-zinc-100">{{ efficiencyAnalysis.searchToEditRatio }}:1</strong></span>
        </div>
        <div class="flex items-center gap-1 text-zinc-600 dark:text-zinc-300">
          <UIcon name="i-lucide-shield-alert" class="w-3.5 h-3.5 text-amber-500" />
          <span>思路修正/返工: <strong :class="efficiencyAnalysis.backtrackCount > 2 ? 'text-amber-600' : 'text-zinc-900 dark:text-zinc-100'">{{ efficiencyAnalysis.backtrackCount }} 次</strong></span>
        </div>
        <div class="flex items-center gap-1 text-zinc-600 dark:text-zinc-300">
          <UIcon name="i-lucide-messages-square" class="w-3.5 h-3.5 text-emerald-500" />
          <span>交互轮次: <strong class="text-zinc-900 dark:text-zinc-100">{{ efficiencyAnalysis.userTurns }} 问 / {{ efficiencyAnalysis.assistantTurns }} 答</strong></span>
        </div>
      </div>

      <!-- Tools & Skills Metrics Bar -->
      <div v-if="toolStats.totalToolCalls > 0 || toolStats.skills.length > 0" class="pt-3 mt-3 border-t border-zinc-100 dark:border-zinc-800 space-y-2">
        <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
          <!-- Tool usage summary -->
          <div class="flex items-center gap-2">
            <span class="font-medium text-zinc-700 dark:text-zinc-300 flex items-center gap-1 text-xs">
              <UIcon name="i-lucide-wrench" class="w-3.5 h-3.5 text-purple-500" />
              工具调用: <span class="font-mono font-bold text-zinc-900 dark:text-zinc-100">{{ toolStats.totalToolCalls }}</span> 次 ({{ toolStats.uniqueToolCount }} 种工具)
            </span>
          </div>

          <!-- Skills summary -->
          <div v-if="toolStats.skills.length" class="flex items-center gap-1.5">
            <span class="font-medium text-zinc-700 dark:text-zinc-300 flex items-center gap-1 text-xs">
              <UIcon name="i-lucide-puzzle" class="w-3.5 h-3.5 text-amber-500" />
              触发技能 ({{ toolStats.skills.length }}):
            </span>
            <span
              v-for="sk in toolStats.skills"
              :key="sk"
              class="px-2 py-0.5 rounded-full text-[10px] font-mono bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30"
            >
              {{ sk }}
            </span>
          </div>
        </div>

        <!-- Tool Pills with Frequency Counts -->
        <div class="flex flex-wrap gap-1.5 pt-0.5">
          <button
            v-for="t in toolStats.tools"
            :key="t.name"
            @click="openToolDetails(t.name)"
            class="px-2.5 py-1 rounded-md bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-750 border border-zinc-200 dark:border-zinc-700/60 text-[11px] font-mono flex items-center gap-1.5 text-zinc-800 dark:text-zinc-200 cursor-pointer select-none transition-all shadow-2xs group"
            :title="`点击查看 ${t.name} 的全部 ${t.count} 次调用明细`"
          >
            <UIcon name="i-lucide-wrench" class="w-3 h-3 text-purple-500 group-hover:rotate-12 transition-transform" />
            <span class="font-medium">{{ t.name }}</span>
            <span class="px-1.5 py-0.2 rounded text-[10px] bg-zinc-200 dark:bg-zinc-700 group-hover:bg-purple-100 group-hover:text-purple-700 dark:group-hover:bg-purple-900/60 dark:group-hover:text-purple-300 text-zinc-700 dark:text-zinc-300 font-bold transition-colors">
              ×{{ t.count }}
            </span>
          </button>
        </div>
      </div>
    </div>

    <!-- Main Content Container -->
    <div class="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden flex flex-col min-h-[600px]">
      <!-- View Mode Header Switcher -->
      <div class="px-5 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-zinc-50/50 dark:bg-zinc-900/50">
        <div class="flex items-center gap-1.5 bg-zinc-200/70 dark:bg-zinc-800 p-1 rounded-lg">
          <button
            @click="detailMode = 'chat'"
            :class="[
              'px-3 py-1.5 rounded-md font-medium transition-all text-xs flex items-center gap-1.5',
              detailMode === 'chat'
                ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'
            ]"
          >
            <UIcon name="i-lucide-messages-square" class="w-4 h-4" />
            完整对话交互 ({{ messages.length }})
          </button>
          <button
            @click="detailMode = 'thinking'"
            :class="[
              'px-3 py-1.5 rounded-md font-medium transition-all text-xs flex items-center gap-1.5',
              detailMode === 'thinking'
                ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'
            ]"
          >
            <UIcon name="i-lucide-brain" class="w-4 h-4 text-amber-500" />
            思维决策路径时间轴 ({{ thinkingTimeline.filter(t => t.type === 'thought').length }} 决策点)
          </button>
        </div>

        <span class="text-xs text-zinc-400 font-mono">
          模式: {{ detailMode === 'chat' ? 'Full Transcript' : 'Thinking Timeline' }}
        </span>
      </div>

      <!-- Loading State -->
      <div v-if="pending" class="py-24 text-center text-zinc-400">
        <UIcon name="i-lucide-loader-2" class="w-8 h-8 animate-spin mx-auto mb-2.5 text-zinc-500" />
        <p class="text-sm">正在加载会话详情与思考路径...</p>
      </div>

      <!-- Empty State -->
      <div v-else-if="!messages.length" class="py-24 text-center text-zinc-400">
        <UIcon name="i-lucide-message-square-off" class="w-8 h-8 mx-auto mb-2 opacity-40" />
        <p class="text-sm">该会话暂无文本交互记录</p>
      </div>

      <!-- View 1: Full Chat Stream -->
      <div v-else-if="detailMode === 'chat'" class="p-6 space-y-4 bg-zinc-50/30 dark:bg-zinc-950/30">
        <div
          v-for="(msg, idx) in messages"
          :key="idx"
          :class="[
            'p-4 rounded-xl text-xs space-y-2 border transition-all',
            msg.role === 'user'
              ? 'bg-zinc-100/90 dark:bg-zinc-800/80 border-zinc-200 dark:border-zinc-700/70 ml-8 lg:ml-20'
              : 'bg-white dark:bg-zinc-900 border-zinc-200/90 dark:border-zinc-800 mr-8 lg:mr-20 shadow-xs'
          ]"
        >
          <!-- Message Header -->
          <div class="flex items-center justify-between text-xs text-zinc-400 pb-1 border-b border-zinc-100 dark:border-zinc-800/60">
            <span class="font-semibold flex items-center gap-1.5 text-zinc-800 dark:text-zinc-200">
              <UIcon :name="msg.role === 'user' ? 'i-lucide-user' : 'i-lucide-bot'" class="w-4 h-4 text-zinc-500" />
              {{ msg.role === 'user' ? 'User' : 'Assistant' }}
              <span v-if="msg.model" class="font-normal font-mono text-zinc-400">({{ msg.model }})</span>
            </span>
            <span v-if="msg.timestamp" class="font-mono text-[11px]">{{ formatTime(msg.timestamp) }}</span>
          </div>

          <!-- Thought Block -->
          <div v-if="msg.thought" class="p-3.5 bg-amber-500/5 dark:bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap font-sans">
            <div class="font-semibold text-amber-600 dark:text-amber-400 mb-1.5 flex items-center gap-1.5 text-[11px] uppercase font-mono">
              <UIcon name="i-lucide-lightbulb" class="w-3.5 h-3.5" /> 思考路径与推导依据 (Thinking Process)
            </div>
            {{ msg.thought }}
          </div>

          <!-- Content text -->
          <div class="whitespace-pre-wrap leading-relaxed text-zinc-800 dark:text-zinc-200 font-sans text-xs break-words">
            {{ msg.content }}
          </div>

          <!-- Tool Calls -->
          <div v-if="msg.toolCalls?.length" class="pt-2">
            <div class="text-[10px] font-mono uppercase text-zinc-400 mb-1.5 flex items-center gap-1">
              <UIcon name="i-lucide-wrench" class="w-3.5 h-3.5" /> 工具执行记录 ({{ msg.toolCalls.length }})
            </div>
            <div class="space-y-1.5">
              <div
                v-for="(tool, tIdx) in msg.toolCalls"
                :key="tIdx"
                class="bg-zinc-100 dark:bg-zinc-800/80 px-3 py-1.5 rounded-md text-[11px] font-mono text-zinc-600 dark:text-zinc-400 break-all"
              >
                <span class="font-bold text-zinc-800 dark:text-zinc-200">{{ tool.name || tool.type || 'Tool' }}</span>:
                {{ typeof tool.arguments === 'string' ? tool.arguments : JSON.stringify(tool.arguments || tool.args || tool.input || {}) }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- View 2: Thinking Timeline -->
      <div v-else class="p-8 space-y-6 bg-zinc-50/60 dark:bg-zinc-950/60">
        <div class="relative border-l-2 border-zinc-200 dark:border-zinc-800 ml-4 space-y-8">
          <div
            v-for="(step, sIdx) in thinkingTimeline"
            :key="sIdx"
            class="relative pl-7 group"
          >
            <!-- Dot Icon -->
            <div
              :class="[
                'absolute -left-[10px] top-1 w-5 h-5 rounded-full flex items-center justify-center border-2 bg-white dark:bg-zinc-900 shadow-xs',
                step.type === 'intent' ? 'border-blue-500 text-blue-500' :
                step.type === 'thought' ? 'border-amber-500 text-amber-500' :
                step.type === 'tool' ? 'border-purple-500 text-purple-500' :
                'border-emerald-500 text-emerald-500'
              ]"
            >
              <div
                :class="[
                  'w-2 h-2 rounded-full',
                  step.type === 'intent' ? 'bg-blue-500' :
                  step.type === 'thought' ? 'bg-amber-500' :
                  step.type === 'tool' ? 'bg-purple-500' :
                  'bg-emerald-500'
                ]"
              />
            </div>

            <!-- Card Content -->
            <div
              :class="[
                'p-4 rounded-xl border text-xs shadow-xs space-y-2 transition-all',
                step.type === 'thought' ? 'bg-amber-500/5 dark:bg-amber-500/10 border-amber-500/30' :
                step.type === 'tool' ? 'bg-purple-500/5 dark:bg-purple-500/10 border-purple-500/30' :
                step.type === 'intent' ? 'bg-blue-500/5 dark:bg-blue-500/10 border-blue-500/30' :
                'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800'
              ]"
            >
              <div class="flex items-center justify-between pb-1 border-b border-zinc-200/50 dark:border-zinc-800/50">
                <span class="font-semibold text-xs text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                  <UIcon
                    :name="
                      step.type === 'intent' ? 'i-lucide-user' :
                      step.type === 'thought' ? 'i-lucide-lightbulb' :
                      step.type === 'tool' ? 'i-lucide-wrench' :
                      'i-lucide-check-circle'
                    "
                    class="w-4 h-4"
                  />
                  {{ step.title }}
                </span>
                <span v-if="step.timestamp" class="text-[11px] text-zinc-400 font-mono">
                  {{ formatTime(step.timestamp) }}
                </span>
              </div>

              <div
                v-if="step.detail"
                class="text-xs leading-relaxed whitespace-pre-wrap text-zinc-700 dark:text-zinc-300 font-sans break-words"
              >
                {{ step.detail }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Tool Invocations Detail Table Modal -->
    <UModal v-model:open="isToolModalOpen" :ui="{ content: 'max-w-5xl max-h-[88vh]' }">
      <template #content>
        <div class="flex flex-col h-[82vh]">
          <!-- Modal Header -->
          <div class="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
            <div class="flex items-center gap-2.5">
              <div class="w-8 h-8 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center border border-purple-500/20">
                <UIcon name="i-lucide-wrench" class="w-4 h-4" />
              </div>
              <div>
                <h3 class="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                  <span class="font-mono">{{ selectedToolName }}</span>
                  <span class="text-xs font-normal text-zinc-400">调用详情记录</span>
                </h3>
                <p class="text-xs text-zinc-400 font-mono mt-0.5">
                  在当前会话中累计被调用 {{ selectedToolCalls.length }} 次
                </p>
              </div>
            </div>

            <UButton
              size="sm"
              variant="ghost"
              color="neutral"
              icon="i-lucide-x"
              @click="isToolModalOpen = false"
            />
          </div>

          <!-- Table Content Container -->
          <div class="flex-1 overflow-y-auto p-4">
            <div class="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">
              <table class="w-full text-left text-xs">
                <thead class="bg-zinc-100/80 dark:bg-zinc-800/80 text-zinc-600 dark:text-zinc-400 font-medium border-b border-zinc-200 dark:border-zinc-800 font-mono">
                  <tr>
                    <th class="py-2.5 px-3 w-14 text-center">#</th>
                    <th class="py-2.5 px-3 w-36">时间</th>
                    <th class="py-2.5 px-3 min-w-[200px]">核心参数摘要</th>
                    <th class="py-2.5 px-3">完整调用参数 (Arguments JSON)</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-zinc-200/70 dark:divide-zinc-800/70 font-sans">
                  <tr
                    v-for="call in selectedToolCalls"
                    :key="call.index"
                    class="hover:bg-zinc-50/70 dark:hover:bg-zinc-850/50 transition-colors align-top"
                  >
                    <!-- Index -->
                    <td class="py-3 px-3 text-center font-mono font-bold text-zinc-400">
                      {{ call.index }}
                    </td>

                    <!-- Timestamp -->
                    <td class="py-3 px-3 font-mono text-[11px] text-zinc-400 whitespace-nowrap">
                      {{ formatTime(call.timestamp) }}
                    </td>

                    <!-- Summary & Thought Context -->
                    <td class="py-3 px-3 space-y-1.5">
                      <div class="font-medium text-zinc-800 dark:text-zinc-200 font-mono text-[11px] break-all">
                        {{ call.summary }}
                      </div>
                      <div v-if="call.associatedThought" class="p-1.5 rounded bg-amber-500/5 dark:bg-amber-500/10 border border-amber-500/15 text-[10px] text-zinc-600 dark:text-zinc-400 leading-relaxed font-sans line-clamp-2" :title="call.associatedThought">
                        <span class="font-semibold text-amber-600 dark:text-amber-400">推导动机:</span>
                        {{ call.associatedThought }}
                      </div>
                    </td>

                    <!-- Full Arguments JSON -->
                    <td class="py-3 px-3">
                      <pre class="p-2 rounded bg-zinc-50 dark:bg-zinc-950 border border-zinc-200/80 dark:border-zinc-800 font-mono text-[10px] text-zinc-700 dark:text-zinc-300 max-h-36 overflow-y-auto whitespace-pre-wrap break-all">{{ typeof call.arguments === 'object' ? JSON.stringify(call.arguments, null, 2) : call.arguments }}</pre>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- Footer -->
          <div class="p-3 bg-zinc-50 dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between text-xs text-zinc-400 font-mono">
            <span>工具: {{ selectedToolName }}</span>
            <UButton size="xs" variant="outline" color="neutral" @click="isToolModalOpen = false">关闭</UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- Session Efficiency Diagnosis & Root-Cause Modal -->
    <UModal v-model:open="isEfficiencyModalOpen" :ui="{ content: 'max-w-4xl max-h-[88vh]' }">
      <template #content>
        <div class="flex flex-col h-[82vh]">
          <!-- Modal Header -->
          <div class="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
            <div class="flex items-center gap-2.5">
              <div class="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center border border-blue-500/20">
                <UIcon name="i-lucide-gauge" class="w-4 h-4" />
              </div>
              <div>
                <h3 class="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                  <span>会话效能诊断报告与扣分归因</span>
                  <span
                    :class="[
                      'px-1.5 py-0.2 rounded font-mono font-bold text-xs',
                      efficiencyAnalysis.grade === 'S' ? 'bg-emerald-500 text-white' :
                      efficiencyAnalysis.grade === 'A' ? 'bg-blue-500 text-white' :
                      efficiencyAnalysis.grade === 'B' ? 'bg-amber-500 text-white' :
                      'bg-red-500 text-white'
                    ]"
                  >
                    {{ efficiencyAnalysis.grade }} 级 ({{ efficiencyAnalysis.score }}分)
                  </span>
                </h3>
                <p class="text-xs text-zinc-400 mt-0.5">
                  基于路径探索、决策摩擦、思考链颠簸与交互轮次多维量化评估
                </p>
              </div>
            </div>

            <div class="flex items-center gap-2">
              <UButton
                size="sm"
                color="neutral"
                class="bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                icon="i-lucide-sparkles"
                :loading="isDiagnosing"
                @click="runAIDiagnosis"
              >
                {{ aiDiagnosisResult ? '重新让 AI 诊断' : '✨ 启动 AI 深度诊断' }}
              </UButton>
              <UButton
                size="sm"
                variant="ghost"
                color="neutral"
                icon="i-lucide-x"
                @click="isEfficiencyModalOpen = false"
              />
            </div>
          </div>

          <!-- AI Judge Banner (if evaluated) -->
          <div v-if="aiDiagnosisResult" class="bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-emerald-500/10 border-b border-zinc-200 dark:border-zinc-800 px-5 py-3 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-bot" class="w-4 h-4 text-purple-600 dark:text-purple-400" />
              <span class="text-xs font-bold text-zinc-900 dark:text-zinc-100">AI 效能审计完成:</span>
              <span class="text-xs text-zinc-600 dark:text-zinc-300">{{ aiDiagnosisResult.taskSummary }}</span>
            </div>
            <span class="text-[10px] font-mono text-zinc-400">
              完成度: <strong class="text-emerald-600 dark:text-emerald-400">{{ aiDiagnosisResult.taskCompletionStatus }}</strong>
            </span>
          </div>

          <!-- Modal Body Content -->
          <div class="flex-1 overflow-y-auto p-5 space-y-5 bg-zinc-50/40 dark:bg-zinc-950/40">
            <!-- 1. Dimension Score Breakdown Grid -->
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <!-- Directness -->
              <div class="bg-white dark:bg-zinc-900 p-3.5 rounded-lg border border-zinc-200 dark:border-zinc-800 space-y-1 shadow-2xs">
                <div class="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                  <span class="flex items-center gap-1 font-medium">
                    <UIcon name="i-lucide-target" class="w-3.5 h-3.5 text-blue-500" />
                    路径精准度 (35%)
                  </span>
                  <span class="font-mono font-bold text-zinc-900 dark:text-zinc-100">{{ efficiencyAnalysis.subScores.directness }}分</span>
                </div>
                <div class="text-[11px] text-zinc-400 pt-1">
                  读改比: {{ efficiencyAnalysis.searchToEditRatio }}:1 (探索 {{ efficiencyAnalysis.searchCount }} / 修改 {{ efficiencyAnalysis.editCount }})
                </div>
              </div>

              <!-- Friction -->
              <div class="bg-white dark:bg-zinc-900 p-3.5 rounded-lg border border-zinc-200 dark:border-zinc-800 space-y-1 shadow-2xs">
                <div class="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                  <span class="flex items-center gap-1 font-medium">
                    <UIcon name="i-lucide-shield-alert" class="w-3.5 h-3.5 text-amber-500" />
                    决策顺畅度 (30%)
                  </span>
                  <span class="font-mono font-bold text-zinc-900 dark:text-zinc-100">{{ efficiencyAnalysis.subScores.friction }}分</span>
                </div>
                <div class="text-[11px] text-zinc-400 pt-1">
                  思路颠簸修正: {{ efficiencyAnalysis.backtrackCount }} 次
                </div>
              </div>

              <!-- Turns -->
              <div class="bg-white dark:bg-zinc-900 p-3.5 rounded-lg border border-zinc-200 dark:border-zinc-800 space-y-1 shadow-2xs">
                <div class="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                  <span class="flex items-center gap-1 font-medium">
                    <UIcon name="i-lucide-messages-square" class="w-3.5 h-3.5 text-emerald-500" />
                    交互周转率 (20%)
                  </span>
                  <span class="font-mono font-bold text-zinc-900 dark:text-zinc-100">{{ efficiencyAnalysis.subScores.turn }}分</span>
                </div>
                <div class="text-[11px] text-zinc-400 pt-1">
                  总轮次: {{ efficiencyAnalysis.userTurns }} 问 / {{ efficiencyAnalysis.assistantTurns }} 答
                </div>
              </div>

              <!-- Action Density -->
              <div class="bg-white dark:bg-zinc-900 p-3.5 rounded-lg border border-zinc-200 dark:border-zinc-800 space-y-1 shadow-2xs">
                <div class="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                  <span class="flex items-center gap-1 font-medium">
                    <UIcon name="i-lucide-cpu" class="w-3.5 h-3.5 text-purple-500" />
                    行动有效性 (15%)
                  </span>
                  <span class="font-mono font-bold text-zinc-900 dark:text-zinc-100">{{ efficiencyAnalysis.subScores.action }}分</span>
                </div>
                <div class="text-[11px] text-zinc-400 pt-1">
                  有效代码修改: {{ efficiencyAnalysis.editCount }} 处
                </div>
              </div>
            </div>

            <!-- 2. Root Cause & Friction Incidents -->
            <div class="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 space-y-3">
              <div class="flex items-center justify-between">
                <h4 class="text-xs font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                  <UIcon name="i-lucide-alert-triangle" class="w-4 h-4 text-amber-500" />
                  扣分与摩擦事件深度归因 (Friction Incidents)
                </h4>
                <span class="text-[11px] text-zinc-400 font-mono">
                  共记录 {{ efficiencyAnalysis.frictionEvents.length }} 处效能阻碍
                </span>
              </div>

              <div v-if="!efficiencyAnalysis.frictionEvents.length" class="py-6 text-center text-zinc-400 text-xs">
                ✨ 未检测到明显的思路返工或决策摩擦，整体执行非常流畅！
              </div>

              <div v-else class="space-y-3">
                <div
                  v-for="(evt, eIdx) in efficiencyAnalysis.frictionEvents"
                  :key="eIdx"
                  :class="[
                    'p-3.5 rounded-lg border text-xs space-y-2 font-sans transition-all',
                    evt.type === 'backtrack' ? 'border-amber-500/30 bg-amber-500/5 dark:bg-amber-500/10' :
                    evt.type === 'search_heavy' ? 'border-blue-500/30 bg-blue-500/5 dark:bg-blue-500/10' :
                    'border-purple-500/30 bg-purple-500/5 dark:bg-purple-500/10'
                  ]"
                >
                  <!-- Card Header -->
                  <div class="flex items-center justify-between gap-2 pb-1.5 border-b border-zinc-200/50 dark:border-zinc-800/50">
                    <span class="font-semibold text-xs flex items-center gap-1.5 text-zinc-900 dark:text-zinc-100">
                      <UIcon
                        :name="
                          evt.type === 'backtrack' ? 'i-lucide-refresh-cw' :
                          evt.type === 'search_heavy' ? 'i-lucide-search' :
                          'i-lucide-clock'
                        "
                        :class="[
                          'w-4 h-4',
                          evt.type === 'backtrack' ? 'text-amber-500' :
                          evt.type === 'search_heavy' ? 'text-blue-500' :
                          'text-purple-500'
                        ]"
                      />
                      第 {{ evt.turn }} 轮交互: {{ evt.title }}
                    </span>
                    <span class="px-2 py-0.5 rounded text-[10px] font-mono bg-red-100 dark:bg-red-950/80 text-red-600 dark:text-red-400 font-bold border border-red-200 dark:border-red-900">
                      {{ evt.impact }}
                    </span>
                  </div>

                  <!-- Detailed Description & Context Block -->
                  <div class="space-y-1.5 text-zinc-700 dark:text-zinc-300">
                    <p class="text-xs leading-relaxed">
                      {{ evt.detail }}
                    </p>

                    <!-- Tool Snippet Pill (if search heavy) -->
                    <div v-if="evt.toolSnippet" class="pt-1">
                      <span class="text-[10px] font-mono text-zinc-400 block mb-1">触发的工具序列:</span>
                      <div class="p-2 rounded bg-zinc-100 dark:bg-zinc-850 font-mono text-[11px] text-zinc-700 dark:text-zinc-300 break-all border border-zinc-200/60 dark:border-zinc-800">
                        {{ evt.toolSnippet }}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 3. Actionable Recommendations -->
            <div class="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 space-y-2.5">
              <h4 class="text-xs font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                <UIcon name="i-lucide-sparkles" class="w-4 h-4 text-emerald-500" />
                效能优化处方建议 (Actionable Insights)
              </h4>
              <ul class="space-y-1.5 text-xs text-zinc-700 dark:text-zinc-300">
                <li
                  v-for="(rec, rIdx) in efficiencyAnalysis.recommendations"
                  :key="rIdx"
                  class="flex items-start gap-2"
                >
                  <span class="text-emerald-500 font-bold shrink-0">💡</span>
                  <span>{{ rec }}</span>
                </li>
              </ul>
            </div>
          </div>

          <!-- Footer -->
          <div class="p-3 bg-zinc-50 dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-end text-xs text-zinc-400">
            <UButton size="xs" color="neutral" class="bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" @click="isEfficiencyModalOpen = false">
              我知道了
            </UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- Edit Title Modal -->
    <UModal v-model:open="isEditOpen" :ui="{ content: 'max-w-md' }">
      <template #content>
        <div class="p-4 space-y-3.5">
          <h3 class="text-sm font-bold text-zinc-900 dark:text-white">编辑会话标题</h3>
          <UFormField label="会话标题">
            <UInput v-model="editingTitle" size="sm" class="w-full" placeholder="输入新的会话标题" />
          </UFormField>
          <div class="flex justify-end gap-2 pt-2">
            <UButton variant="ghost" color="neutral" size="sm" @click="isEditOpen = false">取消</UButton>
            <UButton color="neutral" size="sm" class="bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" :loading="isSavingEdit" @click="saveEditTitle">保存修改</UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
