<script setup lang="ts">
interface ADRItem {
  id: string
  title: string
  context: string
  decision: string
  consequences: string
  status: 'Accepted' | 'Proposed' | 'Deprecated'
  platform: string
  sourceSessionId: string
}

interface DistillReport {
  title: string
  isAiGenerated?: boolean
  providerModel?: string
  sessionCount: number
  actionsDone: string[]
  keyLearnings: string[]
  technicalDecisions: string[]
  adrs?: ADRItem[]
  toolsAndCommands: string[]
  todos: string[]
  rawMarkdown: string
  adrMarkdown?: string
}

interface UnifiedSession {
  id: string
  cli: string
  title: string
  cwd: string
  updatedAt: number
}

const { data: sessionData } = await useFetch<{ success: boolean, data: UnifiedSession[] }>('/api/sessions?cli=all')
const allSessions = computed(() => sessionData.value?.data || [])

interface MapSessionProgress {
  id: string
  title: string
  state: 'pending' | 'active' | 'cached' | 'done' | 'error'
  chars: number
}

const selectedSessionKeys = ref<string[]>([])
const isDistilling = ref(false)
const distillStatus = ref('')
const streamChunkText = ref('')
const report = ref<DistillReport | null>(null)
const mapSessions = ref<MapSessionProgress[]>([])
const activeMapTitle = ref('')
const activeMapText = ref('')
const elapsedSeconds = ref(0)
let elapsedTimer: ReturnType<typeof setInterval> | undefined
let activeMapSessionId = ''

const mapFinishedCount = computed(() =>
  mapSessions.value.filter(m => m.state === 'done' || m.state === 'cached').length
)

const mapStateIcon = (state: MapSessionProgress['state']) => {
  switch (state) {
    case 'active': return 'i-lucide-loader-2'
    case 'done': return 'i-lucide-check-circle-2'
    case 'cached': return 'i-lucide-database'
    case 'error': return 'i-lucide-x-circle'
    default: return 'i-lucide-clock'
  }
}

const mapStateClass = (state: MapSessionProgress['state']) => {
  switch (state) {
    case 'active': return 'text-purple-500 animate-spin'
    case 'done': return 'text-emerald-500'
    case 'cached': return 'text-sky-500'
    case 'error': return 'text-red-500'
    default: return 'text-zinc-300 dark:text-zinc-600'
  }
}

const mapStateLabel = (state: MapSessionProgress['state']) => {
  switch (state) {
    case 'active': return '提炼中'
    case 'done': return '已完成'
    case 'cached': return '缓存命中'
    case 'error': return '失败'
    default: return '等待中'
  }
}
const copySuccess = ref(false)
const copyAdrSuccess = ref(false)
const activeReportTab = ref<'summary' | 'adr'>('summary')
const selectedAdrIds = ref<string[]>([])
const toast = useToast()
const { confirm } = useConfirm()

const toggleAdrSelect = (adrId: string) => {
  const idx = selectedAdrIds.value.indexOf(adrId)
  if (idx >= 0) {
    selectedAdrIds.value.splice(idx, 1)
  } else {
    selectedAdrIds.value.push(adrId)
  }
}

const toggleSelect = (session: UnifiedSession) => {
  const key = `${session.cli}::${session.id}`
  const idx = selectedSessionKeys.value.indexOf(key)
  if (idx >= 0) {
    selectedSessionKeys.value.splice(idx, 1)
  } else {
    selectedSessionKeys.value.push(key)
  }
}

const selectAllRecent = (count = 5) => {
  selectedSessionKeys.value = allSessions.value.slice(0, count).map(s => `${s.cli}::${s.id}`)
}

const clearSelection = () => {
  selectedSessionKeys.value = []
}

const handleDistill = async () => {
  if (selectedSessionKeys.value.length === 0) {
    toast.add({ title: '请至少选择一个会话进行总结提炼', color: 'warning', icon: 'i-lucide-alert-triangle' })
    return
  }

  const items = selectedSessionKeys.value.map(key => {
    const [platform, id] = key.split('::')
    return { platform, id }
  })

  isDistilling.value = true
  distillStatus.value = '正在准备启动知识提炼引擎...'
  streamChunkText.value = ''
  report.value = null
  mapSessions.value = items.map(item => ({
    id: item.id as string,
    title: allSessions.value.find(sess => sess.id === item.id)?.title || (item.id as string),
    state: 'pending',
    chars: 0
  }))
  activeMapTitle.value = ''
  activeMapText.value = ''
  activeMapSessionId = ''
  elapsedSeconds.value = 0
  clearInterval(elapsedTimer)
  elapsedTimer = setInterval(() => elapsedSeconds.value++, 1000)

  try {
    const response = await fetch('/api/distill/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ sessions: items })
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({ message: '提炼请求失败' }))
      throw new Error(err.message || '提炼请求失败')
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
          distillStatus.value = parsed.message || ''
        } else if (eventType === 'chunk') {
          streamChunkText.value += parsed.text || ''
        } else if (eventType === 'map-progress') {
          if (Array.isArray(parsed.sessions)) {
            mapSessions.value = parsed.sessions
          }
        } else if (eventType === 'map-chunk') {
          if (parsed.sessionId !== activeMapSessionId) {
            activeMapSessionId = parsed.sessionId || ''
            activeMapText.value = ''
            activeMapTitle.value = mapSessions.value.find(m => m.id === parsed.sessionId)?.title || ''
          }
          activeMapText.value = (activeMapText.value + (parsed.text || '')).slice(-1200)
          const sess = mapSessions.value.find(m => m.id === parsed.sessionId)
          if (sess) sess.chars += (parsed.text || '').length
        } else if (eventType === 'done') {
          if (parsed.report) {
            report.value = parsed.report
            // 默认全选 ADR，用户可手动取消勾选后再批量归档
            selectedAdrIds.value = (parsed.report.adrs || []).map((a: ADRItem) => a.id)
          }
        } else if (eventType === 'error') {
          throw new Error(parsed.message || '提炼发生错误')
        }
      } catch (jsonErr: any) {
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
  } catch (err: any) {
    toast.add({ title: err?.message || '知识提炼失败', color: 'error', icon: 'i-lucide-alert-triangle' })
  } finally {
    clearInterval(elapsedTimer)
    isDistilling.value = false
  }
}

const copyMarkdown = () => {
  if (!report.value) return
  navigator.clipboard.writeText(report.value.rawMarkdown)
  copySuccess.value = true
  setTimeout(() => copySuccess.value = false, 2000)
}

const copyAdrMarkdown = () => {
  if (!report.value?.adrMarkdown) return
  navigator.clipboard.writeText(report.value.adrMarkdown)
  copyAdrSuccess.value = true
  setTimeout(() => copyAdrSuccess.value = false, 2000)
}

const isArchiving = ref(false)
const archiveAllAdrs = async () => {
  const targetAdrs = (report.value?.adrs || []).filter(adr => selectedAdrIds.value.includes(adr.id))
  if (targetAdrs.length === 0) {
    toast.add({ title: '请先勾选要归档的 ADR 条目', color: 'warning', icon: 'i-lucide-alert-triangle' })
    return
  }
  isArchiving.value = true
  try {
    let count = 0
    for (const adr of targetAdrs) {
      await $fetch('/api/knowledge', {
        method: 'POST',
        body: {
          sessionId: adr.sourceSessionId,
          platform: adr.platform,
          type: 'ADR',
          title: adr.title,
          context: adr.context,
          decision: adr.decision,
          consequence: adr.consequences,
          tags: ['adr', adr.platform],
          score: 90,
          grade: 'S'
        }
      })
      count++
    }
    toast.add({
      title: `成功将 ${count} 条 ADR 架构决策归档至「知识资产库」`,
      description: '可在导航栏「知识资产库」中随时检索与导出',
      color: 'success',
      icon: 'i-lucide-check-circle-2'
    })
  } catch (err: any) {
    toast.add({ title: `归档失败: ${err.message}`, color: 'error', icon: 'i-lucide-alert-triangle' })
  } finally {
    isArchiving.value = false
  }
}
</script>

<template>
  <div class="space-y-5">
    <!-- Header banner -->
    <div class="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-5">
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 class="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <UIcon name="i-lucide-book-open" class="w-5 h-5 text-zinc-700 dark:text-zinc-300" />
            会话复盘与知识提炼
          </h1>
          <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            选择历史会话，自动从 AI 思考路径提炼开发操作轨迹、技术决策（ADR 架构记录）、排错避坑经验与未竟待办。
          </p>
        </div>

        <div class="flex items-center gap-2">
          <NuxtLink to="/">
            <UButton variant="outline" color="neutral" size="sm" icon="i-lucide-arrow-left">返回会话列表</UButton>
          </NuxtLink>
        </div>
      </div>
    </div>

    <!-- Main Grid -->
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-5">
      <!-- Left: Session Selection (5 cols) -->
      <div class="lg:col-span-5 space-y-3">
        <div class="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 space-y-3">
          <div class="flex items-center justify-between">
            <h2 class="text-xs font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
              <UIcon name="i-lucide-check-square" class="w-3.5 h-3.5 text-zinc-600 dark:text-zinc-400" />
              选择目标会话 (已选 {{ selectedSessionKeys.length }})
            </h2>
            <div class="flex items-center gap-1.5 text-xs">
              <button @click="selectAllRecent(5)" class="text-zinc-600 dark:text-zinc-300 hover:underline">选近5条</button>
              <span class="text-zinc-300 dark:text-zinc-700">|</span>
              <button
                @click="clearSelection"
                :disabled="selectedSessionKeys.length === 0"
                :class="[
                  'transition-colors',
                  selectedSessionKeys.length === 0
                    ? 'text-zinc-300 dark:text-zinc-600 cursor-not-allowed'
                    : 'text-zinc-600 dark:text-zinc-300 hover:underline'
                ]"
              >清空</button>
            </div>
          </div>

          <div class="max-h-[520px] overflow-y-auto space-y-1.5 pr-1">
            <div
              v-for="s in allSessions"
              :key="`${s.cli}::${s.id}`"
              @click="toggleSelect(s)"
              :class="[
                'p-2.5 rounded border text-xs cursor-pointer select-none transition-all flex items-start gap-2',
                selectedSessionKeys.includes(`${s.cli}::${s.id}`)
                  ? 'border-zinc-900 bg-zinc-100/90 text-zinc-900 dark:border-zinc-100 dark:bg-zinc-800 dark:text-zinc-100'
                  : 'border-zinc-200/80 dark:border-zinc-800 hover:border-zinc-300 text-zinc-600 dark:text-zinc-400'
              ]"
            >
              <div class="pt-0.5">
                <UIcon
                  :name="selectedSessionKeys.includes(`${s.cli}::${s.id}`) ? 'i-lucide-check-square' : 'i-lucide-square'"
                  class="w-3.5 h-3.5 text-zinc-600 dark:text-zinc-300"
                />
              </div>

              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-1.5 mb-0.5">
                  <span class="px-1.5 py-0.2 rounded text-[10px] uppercase font-mono font-medium bg-zinc-200/60 dark:bg-zinc-700/60 text-zinc-700 dark:text-zinc-300">
                    {{ s.cli }}
                  </span>
                  <span class="text-[10px] text-zinc-400 truncate">{{ s.cwd }}</span>
                </div>
                <p class="font-medium text-zinc-800 dark:text-zinc-200 line-clamp-2 text-xs">
                  {{ s.title }}
                </p>
              </div>
            </div>
          </div>

          <div class="pt-2 border-t border-zinc-100 dark:border-zinc-800">
            <UButton
              block
              color="neutral"
              size="md"
              class="bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              icon="i-lucide-sparkles"
              :loading="isDistilling"
              :disabled="selectedSessionKeys.length === 0"
              @click="handleDistill"
            >
              {{ isDistilling ? '知识提炼流式生成中...' : '开始提炼总结' }}
            </UButton>
          </div>
        </div>
      </div>

      <!-- Right: Report Presentation / Streaming View (7 cols) -->
      <div class="lg:col-span-7">
        <!-- Live Streaming State -->
        <div v-if="isDistilling" class="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-5 space-y-4 shadow-sm animate-fade-in">
          <div class="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-loader-2" class="w-4 h-4 animate-spin text-purple-600 dark:text-purple-400" />
              <h2 class="text-xs font-bold text-zinc-900 dark:text-zinc-100">AI 正在深度提炼知识与复盘...</h2>
            </div>
            <span class="px-2 py-0.5 rounded text-[10px] font-mono bg-purple-50 text-purple-600 dark:bg-purple-950/40 dark:text-purple-400 border border-purple-200 dark:border-purple-800 flex items-center gap-1">
              <UIcon name="i-lucide-sparkles" class="w-3 h-3" />
              流式生成中
            </span>
          </div>

          <!-- Status indicator -->
          <div class="p-3 bg-zinc-50 dark:bg-zinc-800/60 rounded border border-zinc-200/70 dark:border-zinc-700/60 text-xs text-zinc-700 dark:text-zinc-300 flex items-center gap-2">
            <span class="relative flex h-2 w-2 shrink-0">
              <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
              <span class="relative inline-flex rounded-full h-2 w-2 bg-purple-500"></span>
            </span>
            <span class="font-medium font-mono flex-1 min-w-0 truncate" :title="distillStatus">{{ distillStatus || '正在执行 Map-Reduce 提炼任务...' }}</span>
            <span class="shrink-0 font-mono text-[10px] text-zinc-400 flex items-center gap-1">
              <UIcon name="i-lucide-timer" class="w-3 h-3" />
              {{ elapsedSeconds }}s
            </span>
          </div>

          <!-- Map Phase Progress Panel -->
          <div v-if="mapSessions.length" class="rounded border border-zinc-200/70 dark:border-zinc-700/60 overflow-hidden">
            <div class="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/60 border-b border-zinc-200/70 dark:border-zinc-700/60 flex items-center justify-between text-[11px]">
              <span class="font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
                <UIcon name="i-lucide-layers" class="w-3.5 h-3.5 text-purple-500" />
                Map 阶段 · 单会话提炼进度
              </span>
              <span class="font-mono text-zinc-500 dark:text-zinc-400">{{ mapFinishedCount }}/{{ mapSessions.length }} 完成</span>
            </div>
            <!-- Progress bar -->
            <div class="h-1 bg-zinc-100 dark:bg-zinc-800">
              <div
                class="h-full bg-purple-500 dark:bg-purple-400 transition-all duration-500"
                :style="{ width: (mapSessions.length ? (mapFinishedCount / mapSessions.length * 100) : 0) + '%' }"
              ></div>
            </div>
            <!-- Session checklist -->
            <div class="divide-y divide-zinc-100 dark:divide-zinc-800/80 max-h-[220px] overflow-y-auto">
              <div
                v-for="m in mapSessions" :key="m.id"
                class="px-3 py-1.5 flex items-center gap-2 text-[11px]"
                :class="m.state === 'active' ? 'bg-purple-50/60 dark:bg-purple-950/20' : ''"
              >
                <UIcon :name="mapStateIcon(m.state)" class="w-3.5 h-3.5 shrink-0" :class="mapStateClass(m.state)" />
                <span class="flex-1 min-w-0 truncate" :class="m.state === 'pending' ? 'text-zinc-400 dark:text-zinc-500' : 'text-zinc-700 dark:text-zinc-300'" :title="m.title">
                  {{ m.title }}
                </span>
                <span v-if="m.state === 'active'" class="shrink-0 font-mono text-[10px] text-purple-500 dark:text-purple-400">
                  已生成 {{ m.chars }} 字符
                </span>
                <span class="shrink-0 text-[10px]" :class="m.state === 'pending' ? 'text-zinc-300 dark:text-zinc-600' : 'text-zinc-400 dark:text-zinc-500'">
                  {{ mapStateLabel(m.state) }}
                </span>
              </div>
            </div>
            <!-- Active session live output -->
            <div v-if="activeMapText" class="border-t border-zinc-200/70 dark:border-zinc-700/60">
              <div class="px-3 pt-1.5 text-[10px] text-zinc-400 dark:text-zinc-500 flex items-center gap-1">
                <UIcon name="i-lucide-sparkles" class="w-3 h-3 text-purple-400" />
                正在输出: <span class="truncate font-medium">{{ activeMapTitle }}</span>
              </div>
              <div class="p-3 text-zinc-500 dark:text-zinc-400 font-mono text-[10px] max-h-[120px] overflow-y-auto whitespace-pre-wrap leading-relaxed break-all">
                {{ activeMapText }}<span class="inline-block w-1 h-3 bg-purple-500 dark:bg-purple-400 ml-0.5 animate-pulse align-middle"></span>
              </div>
            </div>
          </div>

          <!-- Realtime text stream typewriter box -->
          <div v-if="streamChunkText" class="space-y-1.5">
            <div class="flex items-center justify-between text-[11px] text-zinc-500 dark:text-zinc-400">
              <span class="flex items-center gap-1 font-medium">
                <UIcon name="i-lucide-sparkles" class="w-3.5 h-3.5 text-purple-500" />
                Reduce 阶段流式输出预览:
              </span>
              <span class="font-mono text-[10px]">字符数: {{ streamChunkText.length }}</span>
            </div>
            <div class="p-4 bg-zinc-50/90 dark:bg-zinc-800/50 text-zinc-700 dark:text-zinc-200 font-mono text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 max-h-[360px] overflow-y-auto whitespace-pre-wrap leading-relaxed shadow-xs">
              {{ streamChunkText }}<span class="inline-block w-1.5 h-3.5 bg-purple-600 dark:bg-purple-400 ml-0.5 animate-pulse align-middle"></span>
            </div>
          </div>
          <div v-else-if="!mapSessions.length" class="py-12 flex flex-col items-center justify-center text-zinc-400 space-y-2">
            <UIcon name="i-lucide-cpu" class="w-8 h-8 opacity-40 animate-pulse" />
            <p class="text-xs">正在分析会话思维链与工具操作上下文...</p>
          </div>
        </div>

        <!-- Render Finished Report -->
        <div v-else-if="report" class="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-5 space-y-4 shadow-sm">
          <div class="flex flex-col gap-3 border-b border-zinc-100 dark:border-zinc-800 pb-3">
            <div>
              <div class="flex items-center gap-2 flex-wrap">
                <h2 class="text-sm font-bold text-zinc-900 dark:text-zinc-100">{{ report.title }}</h2>
                <span
                  v-if="report.isAiGenerated"
                  class="px-1.5 py-0.5 rounded text-[10px] font-mono bg-purple-50 text-purple-600 dark:bg-purple-950/40 dark:text-purple-400 border border-purple-200 dark:border-purple-800 flex items-center gap-1"
                >
                  <UIcon name="i-lucide-sparkles" class="w-3 h-3" />
                  AI 提炼 ({{ report.providerModel || 'LLM' }})
                </span>
                <span
                  v-else
                  class="px-1.5 py-0.5 rounded text-[10px] font-mono bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700"
                >
                  本地规则提炼
                </span>
              </div>
              <p class="text-xs text-zinc-400 mt-0.5">已聚合解析 {{ report.sessionCount }} 个历史会话</p>
            </div>

            <!-- Tab & Actions -->
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <div class="flex items-center bg-zinc-100 dark:bg-zinc-800 p-0.5 rounded text-xs">
                <button
                  @click="activeReportTab = 'summary'"
                  :class="[
                    'px-2 py-1 rounded font-medium transition-all text-xs',
                    activeReportTab === 'summary'
                      ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                      : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'
                  ]"
                >
                  综合复盘
                </button>
                <button
                  @click="activeReportTab = 'adr'"
                  :class="[
                    'px-2 py-1 rounded font-medium transition-all text-xs flex items-center gap-1',
                    activeReportTab === 'adr'
                      ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                      : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'
                  ]"
                >
                  ADR 决策 ({{ report.adrs?.length || 0 }})
                </button>
              </div>

              <UButton
                v-if="activeReportTab === 'summary'"
                size="xs"
                variant="outline"
                color="neutral"
                :icon="copySuccess ? 'i-lucide-check' : 'i-lucide-copy'"
                @click="copyMarkdown"
              >
                {{ copySuccess ? '已复制' : '复制复盘' }}
              </UButton>
              <div v-else class="flex items-center gap-1.5">
                <UButton
                  size="xs"
                  variant="outline"
                  color="neutral"
                  :icon="copyAdrSuccess ? 'i-lucide-check' : 'i-lucide-copy'"
                  @click="copyAdrMarkdown"
                >
                  {{ copyAdrSuccess ? '已复制' : '复制 ADR' }}
                </UButton>
                <UButton
                  size="xs"
                  color="neutral"
                  variant="solid"
                  icon="i-lucide-sparkles"
                  class="bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                  :loading="isArchiving"
                  :disabled="selectedAdrIds.length === 0"
                  @click="archiveAllAdrs"
                >
                  批量归档至知识库 ({{ selectedAdrIds.length }})
                </UButton>
              </div>
            </div>
          </div>

          <!-- Tab 1: Summary -->
          <div v-if="activeReportTab === 'summary'" class="space-y-4">
            <!-- Section: Actions Done -->
            <div class="space-y-1.5">
              <h3 class="text-xs font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                <UIcon name="i-lucide-activity" class="w-3.5 h-3.5 text-zinc-500" /> 1. 完成工作与操作轨迹
              </h3>
              <ul class="space-y-1 text-xs text-zinc-700 dark:text-zinc-300">
                <li v-for="(act, i) in report.actionsDone" :key="i" class="flex items-start gap-1.5">
                  <span class="text-zinc-400">•</span>
                  <span>{{ act }}</span>
                </li>
              </ul>
            </div>

            <!-- Section: Key Decisions -->
            <div v-if="report.technicalDecisions?.length" class="space-y-1.5">
              <h3 class="text-xs font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                <UIcon name="i-lucide-git-commit" class="w-3.5 h-3.5 text-zinc-500" /> 2. 思考路径与技术决策 (Thinking & Decisions)
              </h3>
              <ul class="space-y-1 text-xs text-zinc-700 dark:text-zinc-300">
                <li v-for="(dec, i) in report.technicalDecisions" :key="i" class="flex items-start gap-1.5">
                  <span class="text-zinc-400">◆</span>
                  <span>{{ dec }}</span>
                </li>
              </ul>
            </div>

            <!-- Section: Learnings -->
            <div v-if="report.keyLearnings?.length" class="space-y-1.5">
              <h3 class="text-xs font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                <UIcon name="i-lucide-lightbulb" class="w-3.5 h-3.5 text-zinc-500" /> 3. 沉淀经验与避坑要点
              </h3>
              <ul class="space-y-1 text-xs text-zinc-700 dark:text-zinc-300">
                <li v-for="(lrn, i) in report.keyLearnings" :key="i" class="flex items-start gap-1.5">
                  <span class="text-emerald-500">✔</span>
                  <span>{{ lrn }}</span>
                </li>
              </ul>
            </div>

            <!-- Section: Tools -->
            <div v-if="report.toolsAndCommands?.length" class="space-y-1.5">
              <h3 class="text-xs font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                <UIcon name="i-lucide-terminal" class="w-3.5 h-3.5 text-zinc-500" /> 4. 关键工具调用
              </h3>
              <div class="flex flex-wrap gap-1">
                <span
                  v-for="(cmd, i) in report.toolsAndCommands"
                  :key="i"
                  class="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-[11px] font-mono text-zinc-600 dark:text-zinc-400"
                >
                  {{ cmd }}
                </span>
              </div>
            </div>

            <!-- Section: Todos -->
            <div v-if="report.todos?.length" class="space-y-1.5">
              <h3 class="text-xs font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                <UIcon name="i-lucide-check-circle" class="w-3.5 h-3.5 text-zinc-500" /> 5. 未竟待办事项
              </h3>
              <ul class="space-y-1 text-xs text-zinc-700 dark:text-zinc-300 font-mono">
                <li v-for="(todo, i) in report.todos" :key="i" class="flex items-start gap-1.5">
                  <span class="text-zinc-400">[ ]</span>
                  <span>{{ todo }}</span>
                </li>
              </ul>
            </div>
          </div>

          <!-- Tab 2: ADR List -->
          <div v-else class="space-y-3">
            <div v-if="!report.adrs?.length" class="py-8 text-center text-zinc-400 text-xs">
              选中的会话中未提取到明确的架构或方案决策记录
            </div>
            <div
              v-for="adr in report.adrs || []"
              :key="adr.id"
              @click="toggleAdrSelect(adr.id)"
              :class="[
                'p-3.5 rounded-lg border space-y-2 text-xs cursor-pointer select-none transition-all',
                selectedAdrIds.includes(adr.id)
                  ? 'border-zinc-900 dark:border-zinc-100 bg-zinc-100/90 dark:bg-zinc-800/60'
                  : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 opacity-80 hover:opacity-100'
              ]"
            >
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <UIcon
                    :name="selectedAdrIds.includes(adr.id) ? 'i-lucide-check-square' : 'i-lucide-square'"
                    class="w-4 h-4 shrink-0 text-zinc-600 dark:text-zinc-300"
                  />
                  <span class="px-1.5 py-0.5 rounded font-mono text-[10px] font-bold bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900">
                    {{ adr.id }}
                  </span>
                  <span class="font-semibold text-zinc-900 dark:text-zinc-100">{{ adr.title }}</span>
                </div>
                <span class="px-1.5 py-0.2 rounded text-[10px] font-mono bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                  {{ adr.status }}
                </span>
              </div>

              <div class="space-y-1 text-zinc-600 dark:text-zinc-300">
                <div class="flex items-start gap-1.5">
                  <span class="font-mono text-zinc-400 shrink-0 text-[11px]">背景:</span>
                  <span class="text-[11px]">{{ adr.context }}</span>
                </div>
                <div class="flex items-start gap-1.5">
                  <span class="font-mono text-zinc-400 shrink-0 text-[11px]">决策:</span>
                  <span class="text-[11px] font-medium text-zinc-800 dark:text-zinc-200">{{ adr.decision }}</span>
                </div>
              </div>

              <div class="text-[10px] font-mono text-zinc-400 pt-1 border-t border-zinc-200/50 dark:border-zinc-800/50 flex items-center justify-between">
                <span>来源: {{ adr.platform.toUpperCase() }} ({{ adr.sourceSessionId }})</span>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="h-full min-h-[380px] flex flex-col items-center justify-center bg-white dark:bg-zinc-900 rounded-lg border border-dashed border-zinc-200 dark:border-zinc-800 p-8 text-center text-zinc-400">
          <UIcon name="i-lucide-file-text" class="w-10 h-10 mb-2 opacity-30" />
          <h3 class="font-medium text-xs text-zinc-700 dark:text-zinc-300">暂无知识提炼报告</h3>
          <p class="text-[11px] text-zinc-400 mt-0.5 max-w-xs">在左侧勾选你想要复盘的会话，点击“开始提炼总结”即可生成报告与 ADR 决策集</p>
        </div>
      </div>
    </div>
  </div>
</template>

