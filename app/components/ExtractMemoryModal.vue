<script setup lang="ts">
import type { MemoryGraphItem, PresetMemoryType } from '../../server/utils/memory-types'
import type { SessionMessage, UnifiedSession } from '../../server/utils/types'

const props = defineProps<{
  open: boolean
  session?: UnifiedSession | null
  messages: SessionMessage[]
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'saved', item: MemoryGraphItem): void
}>()

const toast = useToast()

const userPrompt = ref('')
const isExtracting = ref(false)
const streamText = ref('')
const statusMessage = ref('')
const errorMessage = ref<string | null>(null)
const isSaving = ref(false)

// 提取出的可编辑结果表单
const extractedData = ref<Partial<MemoryGraphItem> | null>(null)

// 预设类型列表
const presetTypes: Array<{ label: string; value: PresetMemoryType; icon: string; color: string }> = [
  { label: '架构决策 (ADR)', value: 'ADR', icon: 'i-lucide-shield-check', color: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800' },
  { label: '避坑指南 (Gotcha)', value: 'Gotcha', icon: 'i-lucide-alert-triangle', color: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800' },
  { label: '最佳实践 (BestPractice)', value: 'BestPractice', icon: 'i-lucide-award', color: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800' },
  { label: '设计范式 (Pattern)', value: 'Pattern', icon: 'i-lucide-box', color: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-200 dark:border-purple-800' },
  { label: '工作流 (Workflow)', value: 'Workflow', icon: 'i-lucide-git-merge', color: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800' },
  { label: '配置环境 (Config)', value: 'Config', icon: 'i-lucide-settings', color: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-200 dark:border-cyan-800' },
  { label: '性能调优 (Performance)', value: 'Performance', icon: 'i-lucide-zap', color: 'bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-200 dark:border-pink-800' },
  { label: '安全规约 (Security)', value: 'Security', icon: 'i-lucide-lock', color: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-800' }
]

// 临时输入框
const newTechInput = ref('')
const newTagInput = ref('')
const isCustomTypeMode = ref(false)
const customTypeInput = ref('')

function resetState() {
  userPrompt.value = ''
  isExtracting.value = false
  streamText.value = ''
  statusMessage.value = ''
  errorMessage.value = null
  extractedData.value = null
  isSaving.value = false
}

watch(() => props.open, (val) => {
  if (!val) {
    resetState()
  }
})

// 执行 LLM 提炼
async function startExtract() {
  if (!props.session) return
  isExtracting.value = true
  streamText.value = ''
  statusMessage.value = '正在梳理会话上下文与工程模式...'
  errorMessage.value = null
  extractedData.value = null

  // 拼接对话内容
  const messagesContent = props.messages.map((m) => {
    const roleStr = m.role === 'user' ? '用户 (User)' : '助手 (Assistant)'
    const body = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    const thought = m.thought ? `\n[Thinking]: ${m.thought}` : ''
    return `### ${roleStr}\n${body}${thought}`
  }).join('\n\n')

  try {
    const response = await fetch('/api/memory/extract?stream=true', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionTitle: props.session.title,
        cwd: props.session.cwd,
        platform: props.session.cli,
        messagesContent,
        userInstructions: userPrompt.value.trim() || undefined
      })
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({ message: '提炼请求失败' }))
      throw new Error(err.message || '提炼请求失败')
    }

    if (!response.body) {
      throw new Error('未获取到流式响应')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const eventBlocks = buffer.split('\n\n')
      buffer = eventBlocks.pop() || ''

      for (const block of eventBlocks) {
        if (!block.trim()) continue
        const lines = block.split('\n')
        let eventType = 'message'
        let dataStr = ''

        for (const line of lines) {
          if (line.startsWith('event:')) eventType = line.replace('event:', '').trim()
          else if (line.startsWith('data:')) dataStr = line.replace('data:', '').trim()
        }

        if (!dataStr) continue

        try {
          const parsed = JSON.parse(dataStr)
          if (eventType === 'status') {
            statusMessage.value = parsed.message || ''
          } else if (eventType === 'chunk') {
            streamText.value += parsed.text || ''
          } else if (eventType === 'done') {
            extractedData.value = parsed.extracted
            isExtracting.value = false
            statusMessage.value = '提炼完成！请检查并调整结构化数据。'
          } else if (eventType === 'error') {
            errorMessage.value = parsed.message || '提炼发生异常'
            isExtracting.value = false
          }
        } catch {
          // ignore
        }
      }
    }
  } catch (err: any) {
    errorMessage.value = err?.message || '提炼异常'
    isExtracting.value = false
  }
}

// 添加技术栈标签
function addTechConcept() {
  const val = newTechInput.value.trim()
  if (!val || !extractedData.value) return
  if (!extractedData.value.techConcepts) extractedData.value.techConcepts = []
  if (!extractedData.value.techConcepts.some(t => t.name.toLowerCase() === val.toLowerCase())) {
    extractedData.value.techConcepts.push({ name: val, category: 'library' })
  }
  newTechInput.value = ''
}

function removeTechConcept(index: number) {
  if (!extractedData.value?.techConcepts) return
  extractedData.value.techConcepts.splice(index, 1)
}

// 添加通用 Tag
function addTag() {
  const val = newTagInput.value.trim()
  if (!val || !extractedData.value) return
  if (!extractedData.value.tags) extractedData.value.tags = []
  if (!extractedData.value.tags.includes(val)) {
    extractedData.value.tags.push(val)
  }
  newTagInput.value = ''
}

function removeTag(index: number) {
  if (!extractedData.value?.tags) return
  extractedData.value.tags.splice(index, 1)
}

// 写入 Grafeo 图数据库
async function saveToGraph() {
  if (!extractedData.value || !extractedData.value.title || !extractedData.value.content) {
    toast.add({ title: '记忆标题与内容不能为空', color: 'error' })
    return
  }

  isSaving.value = true
  try {
    const res = await $fetch<{ success: boolean; item: MemoryGraphItem }>('/api/memory', {
      method: 'POST',
      body: extractedData.value
    })

    if (res.success && res.item) {
      toast.add({
        title: '已成功沉淀至 Grafeo 记忆图谱！',
        description: `包含 ${res.item.techConcepts?.length || 0} 个技术实体与 ${res.item.projects?.length || 0} 个项目上下文`,
        color: 'success',
        icon: 'i-lucide-check-circle-2'
      })
      emit('saved', res.item)
      emit('update:open', false)
    }
  } catch (err: any) {
    toast.add({
      title: '保存至 Grafeo 图库失败',
      description: err?.message || '请检查服务端日志',
      color: 'error',
      icon: 'i-lucide-alert-triangle'
    })
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    class="max-w-4xl"
    :ui="{ content: 'max-w-4xl sm:max-w-4xl' }"
    @update:open="emit('update:open', $event)"
  >
    <template #content>
      <div class="p-6 space-y-6">
        <!-- Header -->
        <div class="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-4">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-violet-500/10 dark:bg-violet-500/20 text-violet-600 dark:text-violet-400 flex items-center justify-center font-bold">
              <UIcon
                name="i-lucide-brain"
                class="w-5 h-5"
              />
            </div>
            <div>
              <h3 class="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <span>从会话提炼可复用记忆</span>
                <span class="text-xs px-2 py-0.5 rounded-full font-mono font-medium bg-violet-100 dark:bg-violet-950 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800">
                  Grafeo 图数据库
                </span>
              </h3>
              <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                自动泛化会话中的架构决策、避坑经验与代码范式，解耦会话独立沉淀为永久知识图谱
              </p>
            </div>
          </div>
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-x"
            size="sm"
            @click="emit('update:open', false)"
          />
        </div>

        <!-- Initial Configuration / Prompt Form -->
        <div
          v-if="!extractedData && !isExtracting"
          class="space-y-4"
        >
          <div class="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800/80 space-y-3 text-xs text-zinc-600 dark:text-zinc-300">
            <div class="flex items-center gap-2 text-zinc-900 dark:text-zinc-100 font-semibold">
              <UIcon
                name="i-lucide-file-text"
                class="w-4 h-4 text-violet-500"
              />
              <span>来源会话：{{ session?.title || '未命名会话' }}</span>
            </div>
            <div class="flex flex-wrap gap-4 text-zinc-500 dark:text-zinc-400">
              <span>平台: <strong class="text-zinc-700 dark:text-zinc-300 uppercase">{{ session?.cli }}</strong></span>
              <span>消息数: <strong class="text-zinc-700 dark:text-zinc-300">{{ messages.length }}</strong> 条</span>
              <span>工作目录: <code class="font-mono text-zinc-700 dark:text-zinc-300">{{ session?.cwd || 'N/A' }}</code></span>
            </div>
          </div>

          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              提炼补充指引（可选，告诉 LLM 重点关注什么）
            </label>
            <UTextarea
              v-model="userPrompt"
              placeholder="例如：重点提炼本会话中关于 Grafeo 嵌入式配置和 Nuxt 踩坑点，以及最终生效的代码片段..."
              :rows="3"
              class="w-full text-xs font-sans"
            />
          </div>

          <div
            v-if="errorMessage"
            class="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 text-xs flex items-center gap-2"
          >
            <UIcon
              name="i-lucide-alert-circle"
              class="w-4 h-4 shrink-0"
            />
            <span>{{ errorMessage }}</span>
          </div>

          <div class="flex justify-end gap-2 pt-2">
            <UButton
              color="neutral"
              variant="outline"
              size="sm"
              @click="emit('update:open', false)"
            >
              取消
            </UButton>
            <UButton
              color="primary"
              size="sm"
              icon="i-lucide-sparkles"
              @click="startExtract"
            >
              开始智能提炼
            </UButton>
          </div>
        </div>

        <!-- Extracting Progress Stream -->
        <div
          v-else-if="isExtracting"
          class="space-y-4"
        >
          <div class="p-4 rounded-xl bg-violet-50/50 dark:bg-violet-950/20 border border-violet-200/60 dark:border-violet-800/60 space-y-2">
            <div class="flex items-center gap-2 text-violet-700 dark:text-violet-300 font-semibold text-xs">
              <UIcon
                name="i-lucide-loader-2"
                class="w-4 h-4 animate-spin text-violet-600"
              />
              <span>{{ statusMessage || '正在提炼中...' }}</span>
            </div>
            <p class="text-[11px] text-violet-600/80 dark:text-violet-400/80">
              大模型正在对会话历史进行结构化蒸馏，提取 ADR/踩坑点/技术实体三元组...
            </p>
          </div>

          <div class="p-3 rounded-xl bg-zinc-900 text-zinc-100 font-mono text-xs max-h-64 overflow-y-auto whitespace-pre-wrap leading-relaxed">
            {{ streamText || '等待模型响应流...' }}
          </div>
        </div>

        <!-- Extracted Structured Result (Review & Edit Form) -->
        <div
          v-else-if="extractedData"
          class="space-y-4 max-h-[70vh] overflow-y-auto pr-1"
        >
          <div class="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200/80 dark:border-emerald-800/80 flex items-center justify-between text-xs text-emerald-700 dark:text-emerald-300">
            <div class="flex items-center gap-2">
              <UIcon
                name="i-lucide-check-circle"
                class="w-4 h-4 text-emerald-500"
              />
              <span>提炼成功！请在存入 Grafeo 图谱前确认或修改信息：</span>
            </div>
            <button
              class="text-xs text-emerald-600 dark:text-emerald-400 underline hover:text-emerald-700 cursor-pointer"
              @click="extractedData = null"
            >
              重新提炼
            </button>
          </div>

          <!-- Title & Type -->
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div class="md:col-span-2 space-y-1">
              <label class="text-xs font-semibold text-zinc-700 dark:text-zinc-300">记忆标题</label>
              <UInput
                v-model="extractedData.title"
                placeholder="记忆标题"
                class="w-full text-xs font-medium"
              />
            </div>

            <div class="space-y-1">
              <div class="flex items-center justify-between">
                <label class="text-xs font-semibold text-zinc-700 dark:text-zinc-300">记忆分类 (Type)</label>
                <button
                  class="text-[11px] text-violet-600 dark:text-violet-400 hover:underline cursor-pointer"
                  @click="isCustomTypeMode = !isCustomTypeMode"
                >
                  {{ isCustomTypeMode ? '选择预设' : '自定义分类' }}
                </button>
              </div>

              <div
                v-if="!isCustomTypeMode"
                class="flex flex-wrap gap-1"
              >
                <select
                  v-model="extractedData.type"
                  class="w-full text-xs px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 font-medium"
                >
                  <option
                    v-for="pt in presetTypes"
                    :key="pt.value"
                    :value="pt.value"
                  >
                    {{ pt.label }}
                  </option>
                </select>
              </div>
              <div v-else>
                <UInput
                  v-model="extractedData.type"
                  placeholder="例如: ApiDesign / Tooling / Rule"
                  class="w-full text-xs"
                />
              </div>
            </div>
          </div>

          <!-- Summary -->
          <div class="space-y-1">
            <label class="text-xs font-semibold text-zinc-700 dark:text-zinc-300">一句话核心摘要 (Summary)</label>
            <UInput
              v-model="extractedData.summary"
              placeholder="核心要点摘要"
              class="w-full text-xs"
            />
          </div>

          <!-- Tech Concepts & Entities -->
          <div class="space-y-1.5 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-200/80 dark:border-zinc-800/80">
            <label class="text-xs font-semibold text-zinc-700 dark:text-zinc-300 flex items-center justify-between">
              <span>涉及技术实体 (Tech Concepts)</span>
              <span class="text-[10px] text-zinc-400 font-normal">图节点: :TechConcept</span>
            </label>
            <div class="flex flex-wrap items-center gap-1.5">
              <span
                v-for="(t, idx) in extractedData.techConcepts"
                :key="idx"
                class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-mono bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300"
              >
                <span>{{ t.name }}</span>
                <span class="text-[10px] text-emerald-500/70">({{ t.category || 'tech' }})</span>
                <button
                  class="hover:text-red-500 cursor-pointer ml-0.5"
                  @click="removeTechConcept(idx)"
                >×</button>
              </span>

              <div class="flex items-center gap-1">
                <input
                  v-model="newTechInput"
                  placeholder="+ 实体 (回车添加)"
                  class="text-xs px-2 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 w-28"
                  @keydown.enter.prevent="addTechConcept"
                >
                <UButton
                  size="xs"
                  variant="ghost"
                  icon="i-lucide-plus"
                  @click="addTechConcept"
                />
              </div>
            </div>
          </div>

          <!-- Problems Solved -->
          <div
            v-if="extractedData.problems && extractedData.problems.length > 0"
            class="space-y-1.5 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-200/80 dark:border-zinc-800/80"
          >
            <label class="text-xs font-semibold text-zinc-700 dark:text-zinc-300 flex items-center justify-between">
              <span>解决的痛点/异常 (Problems Solved)</span>
              <span class="text-[10px] text-zinc-400 font-normal">图节点: :Problem</span>
            </label>
            <div class="space-y-1">
              <div
                v-for="(pb, idx) in extractedData.problems"
                :key="idx"
                class="p-2 rounded-lg bg-rose-50/60 dark:bg-rose-950/20 border border-rose-200/60 dark:border-rose-800/60 text-xs text-rose-700 dark:text-rose-300"
              >
                <div class="font-medium flex items-center justify-between">
                  <span>{{ pb.title }}</span>
                  <span
                    v-if="pb.errorCode"
                    class="font-mono text-[10px] text-rose-500"
                  >{{ pb.errorCode }}</span>
                </div>
                <div
                  v-if="pb.symptom"
                  class="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5"
                >
                  {{ pb.symptom }}
                </div>
              </div>
            </div>
          </div>

          <!-- Detailed Content (Markdown) -->
          <div class="space-y-1">
            <label class="text-xs font-semibold text-zinc-700 dark:text-zinc-300">详细经验/方案内容 (Markdown)</label>
            <UTextarea
              v-model="extractedData.content"
              :rows="7"
              class="w-full text-xs font-mono"
            />
          </div>

          <!-- Tags -->
          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-zinc-700 dark:text-zinc-300">关联标签 (Tags)</label>
            <div class="flex flex-wrap items-center gap-1.5">
              <span
                v-for="(tag, idx) in extractedData.tags"
                :key="idx"
                class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-mono bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
              >
                <span>#{{ tag }}</span>
                <button
                  class="hover:text-red-500 cursor-pointer"
                  @click="removeTag(idx)"
                >×</button>
              </span>
              <input
                v-model="newTagInput"
                placeholder="+ 标签 (回车添加)"
                class="text-xs px-2 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 w-24"
                @keydown.enter.prevent="addTag"
              >
            </div>
          </div>

          <!-- Action Buttons -->
          <div class="flex items-center justify-between pt-3 border-t border-zinc-200 dark:border-zinc-800">
            <div class="text-[11px] text-zinc-400 font-mono">
              将作为独立节点持久化至 Grafeo (memory.grafeo)
            </div>
            <div class="flex items-center gap-2">
              <UButton
                color="neutral"
                variant="outline"
                size="sm"
                @click="emit('update:open', false)"
              >
                取消
              </UButton>
              <UButton
                color="primary"
                size="sm"
                icon="i-lucide-save"
                :loading="isSaving"
                @click="saveToGraph"
              >
                写入 Grafeo 图谱
              </UButton>
            </div>
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>
