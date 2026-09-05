<script setup lang="ts">
interface DistillReport {
  title: string
  sessionCount: number
  actionsDone: string[]
  keyLearnings: string[]
  technicalDecisions: string[]
  toolsAndCommands: string[]
  todos: string[]
  rawMarkdown: string
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
</script>

<template>
  <div class="space-y-6">
    <!-- Header banner -->
    <div class="bg-gradient-to-r from-indigo-500/10 via-purple-500/10 to-pink-500/10 border border-indigo-200/50 dark:border-indigo-900/50 rounded-2xl p-6">
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 class="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <UIcon name="i-lucide-brain" class="w-6 h-6 text-indigo-500" />
            AI 知识沉淀与会话提炼引擎
          </h1>
          <p class="text-sm text-slate-600 dark:text-neutral-400 mt-1">
            选择多个历史会话，一键自动提炼事件脉络、技术决策（ADR）、排错避坑经验与未竟待办。
          </p>
        </div>

        <div class="flex items-center gap-2">
          <NuxtLink to="/">
            <UButton variant="outline" color="neutral" icon="i-lucide-arrow-left">返回会话列表</UButton>
          </NuxtLink>
        </div>
      </div>
    </div>

    <!-- Main Grid -->
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <!-- Left: Session Selection (5 cols) -->
      <div class="lg:col-span-5 space-y-4">
        <div class="bg-white dark:bg-neutral-900 rounded-xl border border-slate-200 dark:border-neutral-800 p-4 space-y-3">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
              <UIcon name="i-lucide-check-square" class="w-4 h-4 text-primary" />
              选择要提炼的会话 (已选 {{ selectedSessionKeys.length }})
            </h2>
            <div class="flex items-center gap-1.5 text-xs">
              <button @click="selectAllRecent(5)" class="text-primary hover:underline">选近5条</button>
              <span class="text-slate-300">|</span>
              <button @click="clearSelection" class="text-slate-400 hover:underline">清空</button>
            </div>
          </div>

          <div class="max-h-[550px] overflow-y-auto space-y-2 pr-1">
            <div
              v-for="s in allSessions"
              :key="`${s.cli}::${s.id}`"
              @click="toggleSelect(s)"
              :class="[
                'p-3 rounded-lg border text-xs cursor-pointer select-none transition-all flex items-start gap-2.5',
                selectedSessionKeys.includes(`${s.cli}::${s.id}`)
                  ? 'border-primary bg-primary-50/50 dark:bg-primary-950/20 text-slate-900 dark:text-white ring-1 ring-primary/30'
                  : 'border-slate-200/80 dark:border-neutral-800 hover:border-slate-300 text-slate-600 dark:text-neutral-400'
              ]"
            >
              <div class="pt-0.5">
                <UIcon
                  :name="selectedSessionKeys.includes(`${s.cli}::${s.id}`) ? 'i-lucide-check-circle-2' : 'i-lucide-circle'"
                  :class="['w-4 h-4', selectedSessionKeys.includes(`${s.cli}::${s.id}`) ? 'text-primary' : 'text-slate-300']"
                />
              </div>

              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-1.5 mb-1">
                  <span class="px-1.5 py-0.2 rounded text-[10px] uppercase font-mono font-bold bg-slate-100 dark:bg-neutral-800">
                    {{ s.cli }}
                  </span>
                  <span class="text-[10px] text-slate-400 truncate">{{ s.cwd }}</span>
                </div>
                <p class="font-medium text-slate-800 dark:text-neutral-200 line-clamp-2">
                  {{ s.title }}
                </p>
              </div>
            </div>
          </div>

          <div class="pt-2 border-t border-slate-100 dark:border-neutral-800">
            <UButton
              block
              color="primary"
              size="lg"
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
        <div v-if="report" class="bg-white dark:bg-neutral-900 rounded-xl border border-slate-200 dark:border-neutral-800 p-6 space-y-6 shadow-sm">
          <div class="flex items-center justify-between border-b border-slate-100 dark:border-neutral-800 pb-4">
            <div>
              <h2 class="text-lg font-bold text-slate-900 dark:text-white">{{ report.title }}</h2>
              <p class="text-xs text-slate-400 mt-0.5">已聚合解析 {{ report.sessionCount }} 个历史会话</p>
            </div>

            <div class="flex items-center gap-2">
              <UButton
                size="sm"
                variant="outline"
                color="neutral"
                :icon="copySuccess ? 'i-lucide-check' : 'i-lucide-copy'"
                @click="copyMarkdown"
              >
                {{ copySuccess ? '已复制 Markdown' : '复制文档' }}
              </UButton>
            </div>
          </div>

          <!-- Section: Actions Done -->
          <div class="space-y-2">
            <h3 class="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400">
              <UIcon name="i-lucide-activity" class="w-4 h-4" /> 1. 完成工作与操作轨迹
            </h3>
            <ul class="space-y-1.5 text-xs text-slate-700 dark:text-neutral-300">
              <li v-for="(act, i) in report.actionsDone" :key="i" class="flex items-start gap-1.5">
                <span class="text-slate-400">•</span>
                <span>{{ act }}</span>
              </li>
            </ul>
          </div>

          <!-- Section: Key Decisions -->
          <div v-if="report.technicalDecisions?.length" class="space-y-2">
            <h3 class="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
              <UIcon name="i-lucide-git-commit" class="w-4 h-4" /> 2. 关键技术决策与选型 (ADR)
            </h3>
            <ul class="space-y-1.5 text-xs text-slate-700 dark:text-neutral-300">
              <li v-for="(dec, i) in report.technicalDecisions" :key="i" class="flex items-start gap-1.5">
                <span class="text-amber-500">◆</span>
                <span>{{ dec }}</span>
              </li>
            </ul>
          </div>

          <!-- Section: Learnings -->
          <div v-if="report.keyLearnings?.length" class="space-y-2">
            <h3 class="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
              <UIcon name="i-lucide-lightbulb" class="w-4 h-4" /> 3. 沉淀经验与避坑要点
            </h3>
            <ul class="space-y-1.5 text-xs text-slate-700 dark:text-neutral-300">
              <li v-for="(lrn, i) in report.keyLearnings" :key="i" class="flex items-start gap-1.5">
                <span class="text-emerald-500">✔</span>
                <span>{{ lrn }}</span>
              </li>
            </ul>
          </div>

          <!-- Section: Tools -->
          <div v-if="report.toolsAndCommands?.length" class="space-y-2">
            <h3 class="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5 text-slate-500 dark:text-neutral-400">
              <UIcon name="i-lucide-terminal" class="w-4 h-4" /> 4. 关键工具调用
            </h3>
            <div class="flex flex-wrap gap-1.5">
              <span
                v-for="(cmd, i) in report.toolsAndCommands"
                :key="i"
                class="px-2 py-1 rounded bg-slate-100 dark:bg-neutral-800 text-[11px] font-mono text-slate-600 dark:text-neutral-400"
              >
                {{ cmd }}
              </span>
            </div>
          </div>
        </div>

        <div v-else class="h-full min-h-[400px] flex flex-col items-center justify-center bg-white dark:bg-neutral-900 rounded-xl border border-dashed border-slate-200 dark:border-neutral-800 p-8 text-center text-slate-400">
          <UIcon name="i-lucide-file-text" class="w-12 h-12 mb-3 opacity-40" />
          <h3 class="font-semibold text-sm text-slate-700 dark:text-neutral-300">暂无知识提炼报告</h3>
          <p class="text-xs text-slate-400 mt-1 max-w-sm">在左侧勾选你想要复盘的 CLI 或 App 会话，点击“开始提炼总结”即可生成报告</p>
        </div>
      </div>
    </div>
  </div>
</template>
