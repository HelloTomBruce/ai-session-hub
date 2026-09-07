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

const selectedSessionKeys = ref<string[]>([])
const isDistilling = ref(false)
const report = ref<DistillReport | null>(null)
const copySuccess = ref(false)
const copyAdrSuccess = ref(false)
const activeReportTab = ref<'summary' | 'adr'>('summary')

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
    alert('请至少选择一个会话进行总结提炼')
    return
  }

  const items = selectedSessionKeys.value.map(key => {
    const [platform, id] = key.split('::')
    return { platform, id }
  })

  isDistilling.value = true
  try {
    const res = await $fetch<{ success: boolean, data: DistillReport }>('/api/distill', {
      method: 'POST',
      body: { sessions: items }
    })
    report.value = res.data
  } catch (err: any) {
    alert(err?.data?.message || '知识提炼失败')
  } finally {
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
              <button @click="clearSelection" class="text-zinc-400 hover:underline">清空</button>
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
              开始提炼总结
            </UButton>
          </div>
        </div>
      </div>

      <!-- Right: Report Presentation (7 cols) -->
      <div class="lg:col-span-7">
        <div v-if="report" class="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-5 space-y-4 shadow-sm">
          <div class="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3">
            <div>
              <h2 class="text-sm font-bold text-zinc-900 dark:text-zinc-100">{{ report.title }}</h2>
              <p class="text-xs text-zinc-400 mt-0.5">已聚合解析 {{ report.sessionCount }} 个历史会话</p>
            </div>

            <!-- Tab & Actions -->
            <div class="flex items-center gap-2">
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
              <UButton
                v-else
                size="xs"
                variant="outline"
                color="neutral"
                :icon="copyAdrSuccess ? 'i-lucide-check' : 'i-lucide-copy'"
                @click="copyAdrMarkdown"
              >
                {{ copyAdrSuccess ? '已复制' : '复制 ADR' }}
              </UButton>
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
              class="p-3.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 space-y-2 text-xs"
            >
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
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
