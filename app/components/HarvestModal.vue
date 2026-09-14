<script setup lang="ts">
import type { KnowledgeItem } from '../../server/utils/knowledge-service'
import type { QuantitativeEvaluationReport } from '../../server/utils/evaluator-engine'

const props = defineProps<{
  open: boolean
  sessionId: string
  platform: string
  sessionTitle?: string
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'harvested', item: KnowledgeItem): void
}>()

const isRunning = ref(false)
const currentStep = ref(1)
const totalSteps = ref(4)
const stepTitle = ref('正在初始化量化评估引擎...')
const stepMessage = ref('')
const report = ref<QuantitativeEvaluationReport | null>(null)
const harvestedItem = ref<KnowledgeItem | null>(null)
const errorMessage = ref<string | null>(null)
const copySuccess = ref(false)

const steps = [
  { num: 1, label: '提取轨迹' },
  { num: 2, label: 'AST 契约分析' },
  { num: 3, label: '信息熵推导' },
  { num: 4, label: '多维裁决' }
]

const startHarvestStream = async () => {
  if (!props.sessionId || !props.platform) return
  isRunning.value = true
  currentStep.value = 1
  stepTitle.value = '正在提取会话轨迹与代码事实...'
  stepMessage.value = ''
  report.value = null
  harvestedItem.value = null
  errorMessage.value = null

  try {
    const response = await fetch(`/api/sessions/${props.sessionId}/evaluate/stream?cli=${props.platform}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoHarvest: true })
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({ message: '流式评估请求失败' }))
      throw new Error(err.message || '流式评估请求失败')
    }

    if (!response.body) {
      throw new Error('未获取到流式响应体')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    const handleEventBlock = (block: string) => {
      const lines = block.split('\n')
      let eventType = 'message'
      let dataStr = ''

      for (const line of lines) {
        if (line.startsWith('event:')) {
          eventType = line.replace('event:', '').trim()
        } else if (line.startsWith('data:')) {
          dataStr = line.replace('data:', '').trim()
        }
      }

      if (!dataStr) return

      try {
        const parsed = JSON.parse(dataStr)
        if (eventType === 'status') {
          if (parsed.step) currentStep.value = parsed.step
          if (parsed.totalSteps) totalSteps.value = parsed.totalSteps
          if (parsed.title) stepTitle.value = parsed.title
          if (parsed.message) stepMessage.value = parsed.message
        } else if (eventType === 'done') {
          report.value = parsed.report
          harvestedItem.value = parsed.harvestedKnowledge
          if (parsed.harvestedKnowledge) {
            emit('harvested', parsed.harvestedKnowledge)
          }
        } else if (eventType === 'error') {
          errorMessage.value = parsed.message || '评估过程发生错误'
        }
      } catch (jsonErr: any) {
        if (eventType === 'error') errorMessage.value = String(jsonErr)
      }
    }

    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        if (buffer.trim()) handleEventBlock(buffer)
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
    errorMessage.value = err?.message || '沉淀评估请求异常'
  } finally {
    isRunning.value = false
  }
}

watch(() => props.open, (newVal) => {
  if (newVal && !report.value && !isRunning.value) {
    startHarvestStream()
  }
})

const closeModal = () => {
  emit('update:open', false)
}

const copyMarkdown = () => {
  if (!harvestedItem.value) return
  const text = harvestedItem.value.rawMarkdown || harvestedItem.value.decision
  navigator.clipboard.writeText(text)
  copySuccess.value = true
  setTimeout(() => copySuccess.value = false, 2000)
}
</script>

<template>
  <UModal :open="open" @update:open="emit('update:open', $event)">
    <template #content>
      <div class="p-6 space-y-6 max-h-[85vh] overflow-y-auto">
        <!-- Header -->
        <div class="flex items-start justify-between gap-4">
          <div class="flex items-center gap-2.5">
            <div class="w-9 h-9 rounded-xl bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <UIcon name="i-lucide-sparkles" class="w-5 h-5" />
            </div>
            <div>
              <h2 class="text-base font-bold text-zinc-900 dark:text-zinc-100">
                会话量化评估与资产沉淀
              </h2>
              <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 line-clamp-1 max-w-[360px]">
                {{ sessionTitle || sessionId }}
              </p>
            </div>
          </div>

          <UButton
            size="xs"
            variant="ghost"
            color="neutral"
            icon="i-lucide-x"
            @click="closeModal"
          />
        </div>

        <!-- Stepper Progress -->
        <div class="grid grid-cols-4 gap-2 pt-1">
          <div
            v-for="st in steps"
            :key="st.num"
            class="flex flex-col items-center text-center p-2 rounded-lg border transition-all"
            :class="[
              currentStep === st.num && isRunning
                ? 'border-emerald-500/80 bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 font-medium'
                : currentStep > st.num || (!isRunning && report)
                  ? 'border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-850 text-zinc-700 dark:text-zinc-300'
                  : 'border-zinc-100 dark:border-zinc-850 opacity-40 text-zinc-400'
            ]"
          >
            <div class="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold mb-1"
              :class="[
                (currentStep > st.num || (!isRunning && report))
                  ? 'bg-emerald-500 text-white'
                  : currentStep === st.num && isRunning
                    ? 'bg-emerald-500/20 text-emerald-600 animate-pulse'
                    : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300'
              ]"
            >
              <UIcon v-if="currentStep > st.num || (!isRunning && report)" name="i-lucide-check" class="w-3 h-3" />
              <span v-else>{{ st.num }}</span>
            </div>
            <span class="text-[11px] leading-tight">{{ st.label }}</span>
          </div>
        </div>

        <!-- Live Progress Status Box -->
        <div v-if="isRunning" class="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-850 border border-zinc-200/80 dark:border-zinc-750 space-y-2 animate-fade-in">
          <div class="flex items-center gap-2 text-xs font-semibold text-zinc-800 dark:text-zinc-200">
            <UIcon name="i-lucide-loader-2" class="w-4 h-4 animate-spin text-emerald-500" />
            <span>{{ stepTitle }}</span>
          </div>
          <p class="text-xs text-zinc-500 dark:text-zinc-400 font-mono pl-6 leading-relaxed">
            {{ stepMessage || '正在提取多维代码证据与思维链数据...' }}
          </p>
        </div>

        <!-- Error State -->
        <div v-else-if="errorMessage" class="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 text-xs space-y-1">
          <div class="font-bold flex items-center gap-1.5">
            <UIcon name="i-lucide-alert-circle" class="w-4 h-4" /> 评估过程出现异常
          </div>
          <p>{{ errorMessage }}</p>
          <div class="pt-2">
            <UButton size="xs" color="neutral" variant="outline" @click="startHarvestStream">重试</UButton>
          </div>
        </div>

        <!-- Result Presentation (Done) -->
        <div v-else-if="report" class="space-y-4 animate-fade-in">
          <!-- Summary Banner Card -->
          <div
            class="p-5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            :class="[
              report.isWorthSaving
                ? 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200/80 dark:border-emerald-800/60'
                : 'bg-zinc-50 dark:bg-zinc-850 border-zinc-200/80 dark:border-zinc-750'
            ]"
          >
            <div class="space-y-1.5">
              <div class="flex items-center gap-2">
                <span
                  class="px-2 py-0.5 rounded text-xs font-bold font-mono text-white"
                  :class="[
                    report.grade === 'S' ? 'bg-emerald-500' :
                    report.grade === 'A' ? 'bg-blue-500' :
                    report.grade === 'B' ? 'bg-amber-500' : 'bg-red-500'
                  ]"
                >
                  {{ report.grade }} 级 · {{ report.overallScore }} 分
                </span>

                <span
                  class="px-2 py-0.5 rounded text-xs font-medium"
                  :class="[
                    report.category === 'ADR' ? 'bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300' :
                    report.category === 'Gotcha' ? 'bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300' :
                    report.category === 'Pattern' ? 'bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300' :
                    'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300'
                  ]"
                >
                  {{ report.category === 'ADR' ? '💎 架构技术决策 (ADR)' : report.category === 'Gotcha' ? '⚠️ 避坑锦囊 (Gotcha)' : report.category === 'Pattern' ? '📦 工程模板 (Pattern)' : '🔍 日常琐碎操作' }}
                </span>
              </div>

              <p class="text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed font-medium">
                {{ report.summaryReason }}
              </p>
            </div>

            <!-- Harvest Badge -->
            <div class="sm:text-right shrink-0">
              <span
                v-if="harvestedItem"
                class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white shadow-xs"
              >
                <UIcon name="i-lucide-check-circle" class="w-4 h-4" />
                已入库沉淀
              </span>
              <span
                v-else
                class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300"
              >
                仅保留搜索索引
              </span>
            </div>
          </div>

          <!-- Subscores Metric Cards -->
          <div class="grid grid-cols-3 gap-3">
            <div class="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-850 border border-zinc-200/60 dark:border-zinc-800">
              <div class="text-[11px] text-zinc-500 dark:text-zinc-400">AST 代码契约深度</div>
              <div class="text-lg font-bold font-mono mt-0.5 text-zinc-800 dark:text-zinc-200">
                {{ report.subScores.astImpact }}<span class="text-xs text-zinc-400">/100</span>
              </div>
            </div>

            <div class="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-850 border border-zinc-200/60 dark:border-zinc-800">
              <div class="text-[11px] text-zinc-500 dark:text-zinc-400">信息熵与排障深度</div>
              <div class="text-lg font-bold font-mono mt-0.5 text-zinc-800 dark:text-zinc-200">
                {{ report.subScores.informationDensity }}<span class="text-xs text-zinc-400">/100</span>
              </div>
            </div>

            <div class="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-850 border border-zinc-200/60 dark:border-zinc-800">
              <div class="text-[11px] text-zinc-500 dark:text-zinc-400">拓扑实体影响面</div>
              <div class="text-lg font-bold font-mono mt-0.5 text-zinc-800 dark:text-zinc-200">
                {{ report.subScores.topologyCentrality }}<span class="text-xs text-zinc-400">/100</span>
              </div>
            </div>
          </div>

          <!-- Detected Signals List -->
          <div class="space-y-1.5">
            <h4 class="text-xs font-bold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
              <UIcon name="i-lucide-binary" class="w-3.5 h-3.5 text-emerald-500" />
              量化证据链归因 (Detected Signals)
            </h4>
            <ul class="space-y-1 text-xs text-zinc-600 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-850 p-3 rounded-lg border border-zinc-200/60 dark:border-zinc-800">
              <li v-for="(sig, i) in report.signals" :key="i" class="flex items-start gap-2">
                <UIcon name="i-lucide-check-circle" class="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />
                <span>{{ sig }}</span>
              </li>
            </ul>
          </div>
        </div>

        <!-- Footer Buttons -->
        <div class="flex items-center justify-between pt-4 border-t border-zinc-200 dark:border-zinc-800 text-xs">
          <span v-if="copySuccess" class="text-emerald-600 flex items-center gap-1">
            <UIcon name="i-lucide-check" class="w-3.5 h-3.5" /> 已复制 Markdown
          </span>
          <span v-else></span>

          <div class="flex items-center gap-2">
            <UButton
              v-if="harvestedItem"
              size="sm"
              variant="outline"
              color="neutral"
              icon="i-lucide-copy"
              @click="copyMarkdown"
            >
              复制沉淀 Markdown
            </UButton>

            <NuxtLink v-if="harvestedItem" to="/knowledge">
              <UButton
                size="sm"
                variant="outline"
                color="neutral"
                icon="i-lucide-external-link"
                @click="closeModal"
              >
                前往知识库
              </UButton>
            </NuxtLink>

            <UButton
              size="sm"
              variant="solid"
              color="neutral"
              @click="closeModal"
            >
              {{ report ? '完成' : '取消' }}
            </UButton>
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>
