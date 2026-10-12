<script setup lang="ts">
import type { QuantitativeEvaluationReport } from '@session-hub/analyzer'

interface HarvestedMemory {
  id: string
  title: string
  type: string
  summary: string
}

const props = defineProps<{
  open: boolean
  sessionId: string
  platform: string
  sessionTitle?: string
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
}>()

const isRunning = ref(false)
const currentStep = ref(1)
const totalSteps = 5
const stepTitle = ref('正在初始化量化评估引擎...')
const stepMessage = ref('')
const stepState = ref<Record<number, 'running' | 'done' | 'skipped' | 'unavailable'>>({})
const report = ref<QuantitativeEvaluationReport | null>(null)
const harvestedMemory = ref<HarvestedMemory | null>(null)
const harvestStatus = ref<'extracted' | 'candidate' | 'skipped'>('skipped')
const dedupMode = ref<string>('')
const extractError = ref<string | null>(null)
const extractPreview = ref('')
const errorMessage = ref<string | null>(null)

const steps = [
  { num: 1, label: '提取轨迹' },
  { num: 2, label: '策略评分' },
  { num: 3, label: 'AI 裁判' },
  { num: 4, label: '综合裁决' },
  { num: 5, label: '知识抽取' }
]

const startHarvestStream = async () => {
  if (!props.sessionId || !props.platform) return
  isRunning.value = true
  currentStep.value = 1
  stepState.value = {}
  stepTitle.value = '正在提取会话轨迹与代码事实...'
  stepMessage.value = ''
  report.value = null
  harvestedMemory.value = null
  harvestStatus.value = 'skipped'
  dedupMode.value = ''
  extractError.value = null
  extractPreview.value = ''
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
    if (!response.body) throw new Error('未获取到流式响应体')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    const handleEventBlock = (block: string) => {
      const lines = block.split('\n')
      let eventType = 'message'
      let dataStr = ''
      for (const line of lines) {
        if (line.startsWith('event:')) eventType = line.replace('event:', '').trim()
        else if (line.startsWith('data:')) dataStr = line.replace('data:', '').trim()
      }
      if (!dataStr) return

      try {
        const parsed = JSON.parse(dataStr)
        if (eventType === 'status') {
          if (parsed.step) {
            // 上一步完成
            if (parsed.step > 1 && !stepState.value[parsed.step - 1]) {
              stepState.value[parsed.step - 1] = 'done'
            }
            currentStep.value = parsed.step
            if (parsed.judge === 'skipped' && parsed.step === 3) stepState.value[3] = 'skipped'
            else if (parsed.judge === 'unavailable' && parsed.step === 3) stepState.value[3] = 'unavailable'
            else if (parsed.judge === 'candidate' && parsed.step === 5) stepState.value[5] = 'skipped'
            else stepState.value[parsed.step] = 'running'
          }
          if (parsed.title) stepTitle.value = parsed.title
          if (parsed.message) stepMessage.value = parsed.message
        } else if (eventType === 'extract') {
          extractPreview.value += parsed.chunk || ''
        } else if (eventType === 'extract-error') {
          extractError.value = parsed.message || '知识抽取失败'
        } else if (eventType === 'done') {
          report.value = parsed.report
          harvestedMemory.value = parsed.harvestedMemory || null
          harvestStatus.value = parsed.harvestStatus || 'skipped'
          dedupMode.value = parsed.dedup || ''
          for (let i = 1; i <= totalSteps; i++) {
            if (!stepState.value[i] || stepState.value[i] === 'running') stepState.value[i] = 'done'
          }
          if (harvestStatus.value === 'candidate' && !extractError.value) stepState.value[5] = 'skipped'
          if (harvestStatus.value === 'skipped') stepState.value[5] = 'skipped'
        } else if (eventType === 'error') {
          errorMessage.value = parsed.message || '评估过程发生错误'
        }
      } catch (jsonErr) {
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
      for (const block of blocks) handleEventBlock(block)
    }
  } catch (err) {
    errorMessage.value = (err as { message?: string } | null | undefined)?.message || '沉淀评估请求异常'
  } finally {
    isRunning.value = false
  }
}

watch(() => props.open, (val) => {
  if (val && !report.value && !isRunning.value) startHarvestStream()
})

const closeModal = () => emit('update:open', false)

const dedupLabel = computed(() => {
  switch (dedupMode.value) {
    case 'created': return '新记忆节点已创建'
    case 'updated-session': return '已更新本会话既有记忆节点（幂等）'
    case 'updated-title': return '同名记忆已合并更新'
    case 'superseded': return '内容演进，已链接 SUPERSEDES 旧版本'
    default: return ''
  }
})

const categoryBadge = (category: string) => {
  if (category === 'ADR') return '💎 架构技术决策 (ADR)'
  if (category === 'Gotcha') return '⚠️ 避坑锦囊 (Gotcha)'
  if (category === 'Pattern') return '📦 工程模板 (Pattern)'
  if (category === 'Milestone') return '🚩 落地里程碑 (Milestone)'
  return '🔍 日常琐碎操作 (Trivial)'
}
</script>

<template>
  <UModal
    :open="open"
    @update:open="emit('update:open', $event)"
  >
    <template #content>
      <div class="p-6 space-y-5 max-h-[85vh] overflow-y-auto">
        <!-- Header -->
        <div class="flex items-start justify-between gap-4">
          <div class="flex items-center gap-2.5">
            <div class="w-9 h-9 rounded-xl bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <UIcon
                name="i-lucide-sparkles"
                class="w-5 h-5"
              />
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

        <!-- Stepper -->
        <div class="grid grid-cols-5 gap-2 pt-1">
          <div
            v-for="st in steps"
            :key="st.num"
            class="flex flex-col items-center text-center p-2 rounded-lg border transition-all"
            :class="[
              stepState[st.num] === 'running' && isRunning
                ? 'border-emerald-500/80 bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 font-medium'
                : stepState[st.num] === 'done'
                  ? 'border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-800/50 text-zinc-700 dark:text-zinc-300'
                  : stepState[st.num] === 'skipped' || stepState[st.num] === 'unavailable'
                    ? 'border-zinc-100 dark:border-zinc-800/60 text-zinc-400'
                    : 'border-zinc-100 dark:border-zinc-850 opacity-40 text-zinc-400'
            ]"
          >
            <div
              class="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold mb-1"
              :class="[
                stepState[st.num] === 'done'
                  ? 'bg-emerald-500 text-white'
                  : stepState[st.num] === 'running' && isRunning
                    ? 'bg-emerald-500/20 text-emerald-600 animate-pulse'
                    : stepState[st.num] === 'skipped'
                      ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-500'
                      : stepState[st.num] === 'unavailable'
                        ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-600'
                        : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300'
              ]"
            >
              <UIcon
                v-if="stepState[st.num] === 'done'"
                name="i-lucide-check"
                class="w-3 h-3"
              />
              <UIcon
                v-else-if="stepState[st.num] === 'skipped'"
                name="i-lucide-minus"
                class="w-3 h-3"
              />
              <UIcon
                v-else-if="stepState[st.num] === 'unavailable'"
                name="i-lucide-alert-triangle"
                class="w-3 h-3"
              />
              <span v-else>{{ st.num }}</span>
            </div>
            <span class="text-[11px] leading-tight">{{ st.label }}</span>
          </div>
        </div>

        <!-- Live progress -->
        <div
          v-if="isRunning"
          class="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200/80 dark:border-zinc-700 space-y-2"
        >
          <div class="flex items-center gap-2 text-xs font-semibold text-zinc-800 dark:text-zinc-200">
            <UIcon
              name="i-lucide-loader-2"
              class="w-4 h-4 animate-spin text-emerald-500"
            />
            <span>{{ stepTitle }}</span>
          </div>
          <p class="text-xs text-zinc-500 dark:text-zinc-400 font-mono pl-6 leading-relaxed">
            {{ stepMessage || '正在处理...' }}
          </p>
          <!-- 抽取流式预览 -->
          <div
            v-if="extractPreview"
            class="mt-2 pl-6 max-h-32 overflow-y-auto text-[11px] font-mono text-zinc-500 dark:text-zinc-400 whitespace-pre-wrap border-l-2 border-emerald-200 dark:border-emerald-800 pl-3"
          >
            {{ extractPreview.slice(-1200) }}
          </div>
        </div>

        <!-- Fatal error -->
        <div
          v-else-if="errorMessage"
          class="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 text-xs space-y-1"
        >
          <div class="font-bold flex items-center gap-1.5">
            <UIcon
              name="i-lucide-alert-circle"
              class="w-4 h-4"
            /> 评估过程出现异常
          </div>
          <p>{{ errorMessage }}</p>
          <div class="pt-2">
            <UButton
              size="xs"
              color="neutral"
              variant="outline"
              @click="startHarvestStream"
            >
              重试
            </UButton>
          </div>
        </div>

        <!-- Result -->
        <div
          v-else-if="report"
          class="space-y-4"
        >
          <!-- Summary card -->
          <div
            class="p-5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            :class="[
              harvestStatus === 'extracted'
                ? 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200/80 dark:border-emerald-800/60'
                : 'bg-zinc-50 dark:bg-zinc-800/50 border-zinc-200/80 dark:border-zinc-700'
            ]"
          >
            <div class="space-y-1.5">
              <div class="flex items-center gap-2 flex-wrap">
                <span
                  class="px-2 py-0.5 rounded text-xs font-bold font-mono text-white"
                  :class="[
                    report.grade === 'S' ? 'bg-emerald-500'
                    : report.grade === 'A' ? 'bg-blue-500'
                      : report.grade === 'B' ? 'bg-amber-500' : 'bg-red-500'
                  ]"
                >
                  {{ report.grade }} 级 · {{ report.overallScore }} 分
                </span>
                <span
                  class="px-2 py-0.5 rounded text-xs font-medium"
                  :class="report.category === 'ADR'
                    ? 'bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300'
                    : report.category === 'Gotcha'
                      ? 'bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300'
                      : report.category === 'Pattern'
                        ? 'bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300'
                        : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300'"
                >
                  {{ categoryBadge(report.category) }}
                </span>
                <span
                  v-if="report.vetoed"
                  class="px-2 py-0.5 rounded text-xs font-medium bg-rose-100 dark:bg-rose-900/50 text-rose-600 dark:text-rose-400"
                >
                  质量门 veto
                </span>
              </div>
              <p class="text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed font-medium">
                {{ report.summaryReason }}
              </p>
            </div>

            <div class="sm:text-right shrink-0 space-y-1">
              <span
                v-if="harvestStatus === 'extracted'"
                class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white"
              >
                <UIcon
                  name="i-lucide-check-circle"
                  class="w-4 h-4"
                />
                已沉淀至记忆图谱
              </span>
              <span
                v-else-if="harvestStatus === 'candidate'"
                class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
              >
                <UIcon
                  name="i-lucide-clock"
                  class="w-4 h-4"
                />
                评估通过 · 待抽取
              </span>
              <span
                v-else
                class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300"
              >
                仅保存评估
              </span>
            </div>
          </div>

          <!-- 抽取结果 -->
          <div
            v-if="harvestedMemory"
            class="p-4 rounded-xl border border-emerald-200/70 dark:border-emerald-800/50 bg-white dark:bg-zinc-900 space-y-2"
          >
            <div class="flex items-center gap-2 text-xs font-bold text-emerald-700 dark:text-emerald-300">
              <UIcon
                name="i-lucide-brain"
                class="w-4 h-4"
              />
              Grafeo 记忆节点
            </div>
            <div class="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {{ harvestedMemory.title }}
            </div>
            <p class="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
              {{ harvestedMemory.summary }}
            </p>
            <div class="flex items-center justify-between pt-1">
              <span class="text-[11px] text-zinc-400">{{ dedupLabel }}</span>
              <NuxtLink :to="`/memory?id=${harvestedMemory.id}`">
                <UButton
                  size="xs"
                  variant="outline"
                  color="neutral"
                  icon="i-lucide-external-link"
                  @click="closeModal"
                >
                  在记忆图谱中查看
                </UButton>
              </NuxtLink>
            </div>
          </div>

          <!-- Candidate CTA -->
          <div
            v-else-if="harvestStatus === 'candidate'"
            class="p-4 rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50/60 dark:bg-amber-950/20 text-xs text-amber-800 dark:text-amber-200 space-y-2"
          >
            <div class="font-semibold flex items-center gap-1.5">
              <UIcon
                name="i-lucide-info"
                class="w-4 h-4"
              />
              {{ extractError ? '知识抽取失败，已保留评估候选' : '未生成知识条目' }}
            </div>
            <p
              v-if="extractError"
              class="text-amber-700 dark:text-amber-300/80 font-mono"
            >
              {{ extractError }}
            </p>
            <p v-else>
              未配置或未启用 LLM Provider，系统不会用评分信号拼造假资产。可在设置中配置 LLM 后重试，或使用顶部「提炼记忆」手动抽取。
            </p>
          </div>

          <!-- Subscores -->
          <div class="grid grid-cols-3 gap-3">
            <div class="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200/60 dark:border-zinc-800">
              <div class="text-[11px] text-zinc-500 dark:text-zinc-400">
                代码改动与契约影响
              </div>
              <div class="text-lg font-bold font-mono mt-0.5 text-zinc-800 dark:text-zinc-200">
                {{ report.subScores.changeImpact }}<span class="text-xs text-zinc-400">/100</span>
              </div>
            </div>
            <div class="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200/60 dark:border-zinc-800">
              <div class="text-[11px] text-zinc-500 dark:text-zinc-400">
                推理密度与根因分析
              </div>
              <div class="text-lg font-bold font-mono mt-0.5 text-zinc-800 dark:text-zinc-200">
                {{ report.subScores.reasoningDensity }}<span class="text-xs text-zinc-400">/100</span>
              </div>
            </div>
            <div class="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200/60 dark:border-zinc-800">
              <div class="text-[11px] text-zinc-500 dark:text-zinc-400">
                执行质量与闭环{{ typeof report.subScores.llmJudgeQuality === 'number' ? ' · AI 裁判' : '' }}
              </div>
              <div class="text-lg font-bold font-mono mt-0.5 text-zinc-800 dark:text-zinc-200">
                {{ report.subScores.executionQuality }}<span class="text-xs text-zinc-400">/100</span>
                <span
                  v-if="typeof report.subScores.llmJudgeQuality === 'number'"
                  class="text-[11px] ml-1 text-violet-500"
                >
                  🤖 {{ report.subScores.llmJudgeQuality }}
                </span>
              </div>
            </div>
          </div>

          <!-- Signals -->
          <div class="space-y-1.5">
            <h4 class="text-xs font-bold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
              <UIcon
                name="i-lucide-binary"
                class="w-3.5 h-3.5 text-emerald-500"
              />
              量化证据链归因
            </h4>
            <ul class="space-y-1 text-xs text-zinc-600 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-800/50 p-3 rounded-lg border border-zinc-200/60 dark:border-zinc-800 max-h-44 overflow-y-auto">
              <li
                v-for="(sig, i) in report.signals"
                :key="i"
                class="flex items-start gap-2"
              >
                <UIcon
                  name="i-lucide-check-circle"
                  class="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0"
                />
                <span>{{ sig }}</span>
              </li>
            </ul>
          </div>
        </div>

        <!-- Footer -->
        <div class="flex items-center justify-end gap-2 pt-4 border-t border-zinc-200 dark:border-zinc-800">
          <UButton
            v-if="report && !isRunning"
            size="sm"
            variant="outline"
            color="neutral"
            icon="i-lucide-rotate-cw"
            @click="startHarvestStream"
          >
            重新评估并更新
          </UButton>
          <UButton
            size="sm"
            variant="solid"
            color="neutral"
            :disabled="isRunning"
            @click="closeModal"
          >
            {{ report ? '完成' : '关闭' }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
