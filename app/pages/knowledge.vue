<script setup lang="ts">
import type { KnowledgeItem } from '../../server/utils/knowledge-service'

const selectedType = ref('all')
const searchQuery = ref('')
const selectedPlatform = ref('all')
const isDetailOpen = ref(false)
const currentItem = ref<KnowledgeItem | null>(null)
const copySuccess = ref(false)

const { data: knowledgeData, refresh, status } = await useFetch('/api/knowledge', {
  query: computed(() => ({
    type: selectedType.value !== 'all' ? selectedType.value : undefined,
    platform: selectedPlatform.value !== 'all' ? selectedPlatform.value : undefined,
    search: searchQuery.value.trim() || undefined
  }))
})

const items = computed<KnowledgeItem[]>(() => knowledgeData.value?.data || [])
const totalCount = computed(() => knowledgeData.value?.total || 0)

// Statistics
const adrCount = computed(() => items.value.filter(i => i.type === 'ADR').length)
const gotchaCount = computed(() => items.value.filter(i => i.type === 'Gotcha').length)
const patternCount = computed(() => items.value.filter(i => i.type === 'Pattern').length)

const typeFilters = [
  { label: '全部资产', value: 'all', icon: 'i-lucide-layers' },
  { label: '架构决策 (ADR)', value: 'ADR', icon: 'i-lucide-shield-check', color: 'emerald' },
  { label: '避坑锦囊 (Gotcha)', value: 'Gotcha', icon: 'i-lucide-alert-triangle', color: 'amber' },
  { label: '工程模板 (Pattern)', value: 'Pattern', icon: 'i-lucide-box', color: 'blue' },
  { label: '里程碑 (Milestone)', value: 'Milestone', icon: 'i-lucide-flag', color: 'purple' }
]

const toast = useToast()
const { confirm } = useConfirm()

function openDetail(item: KnowledgeItem) {
  currentItem.value = item
  isDetailOpen.value = true
}

async function deleteItem(id: string) {
  if (!await confirm({ title: '确定要从知识资产库中删除此条目吗？', danger: true, confirmLabel: '删除' })) return
  try {
    await $fetch<{ success: boolean }>(`/api/knowledge/${id}`, { method: 'DELETE' })
    if (currentItem.value?.id === id) {
      isDetailOpen.value = false
    }
    toast.add({ title: '已删除该知识条目', color: 'success', icon: 'i-lucide-check-circle-2' })
    refresh()
  } catch (err) {
    toast.add({ title: `删除失败: ${(err as { message?: string }).message}`, color: 'error', icon: 'i-lucide-alert-triangle' })
  }
}

async function copyMarkdown(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    copySuccess.value = true
    setTimeout(() => {
      copySuccess.value = false
    }, 2000)
  } catch {
    toast.add({ title: '复制到剪贴板失败', color: 'error', icon: 'i-lucide-alert-triangle' })
  }
}

function triggerExport() {
  const url = `/api/knowledge/export${selectedType.value !== 'all' ? `?type=${selectedType.value}` : ''}`
  window.open(url, '_blank')
}
</script>

<template>
  <div class="space-y-6">
    <!-- Header banner -->
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-zinc-900 p-6 rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 shadow-xs">
      <div>
        <div class="flex items-center gap-2.5">
          <div class="w-9 h-9 rounded-xl bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
            <UIcon
              name="i-lucide-sparkles"
              class="w-5 h-5"
            />
          </div>
          <div>
            <h1 class="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              知识资产库 (Knowledge Vault)
            </h1>
            <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              通过量化评估引擎自动沉淀的架构决策 (ADR)、踩坑避坑经验与工程复用模式
            </p>
          </div>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <UButton
          color="neutral"
          variant="outline"
          size="sm"
          icon="i-lucide-download"
          @click="triggerExport"
        >
          导出 Markdown 知识包
        </UButton>
      </div>
    </div>

    <!-- Quick Stats Cards -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
      <div class="bg-white dark:bg-zinc-900 p-4 rounded-xl border border-zinc-200/80 dark:border-zinc-800/80">
        <div class="text-xs text-zinc-500 dark:text-zinc-400">
          总沉淀资产
        </div>
        <div class="text-2xl font-bold font-mono mt-1 text-zinc-900 dark:text-zinc-100">
          {{ totalCount }}
        </div>
      </div>
      <div class="bg-white dark:bg-zinc-900 p-4 rounded-xl border border-zinc-200/80 dark:border-zinc-800/80">
        <div class="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
          <UIcon
            name="i-lucide-shield-check"
            class="w-3.5 h-3.5"
          /> 架构决策 (ADR)
        </div>
        <div class="text-2xl font-bold font-mono mt-1 text-emerald-600 dark:text-emerald-400">
          {{ adrCount }}
        </div>
      </div>
      <div class="bg-white dark:bg-zinc-900 p-4 rounded-xl border border-zinc-200/80 dark:border-zinc-800/80">
        <div class="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
          <UIcon
            name="i-lucide-alert-triangle"
            class="w-3.5 h-3.5"
          /> 避坑锦囊 (Gotchas)
        </div>
        <div class="text-2xl font-bold font-mono mt-1 text-amber-600 dark:text-amber-400">
          {{ gotchaCount }}
        </div>
      </div>
      <div class="bg-white dark:bg-zinc-900 p-4 rounded-xl border border-zinc-200/80 dark:border-zinc-800/80">
        <div class="text-xs text-blue-600 dark:text-blue-400 flex items-center gap-1">
          <UIcon
            name="i-lucide-box"
            class="w-3.5 h-3.5"
          /> 工程模板 (Patterns)
        </div>
        <div class="text-2xl font-bold font-mono mt-1 text-blue-600 dark:text-blue-400">
          {{ patternCount }}
        </div>
      </div>
    </div>

    <!-- Filter & Search Bar -->
    <div class="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white dark:bg-zinc-900 p-3 rounded-xl border border-zinc-200/80 dark:border-zinc-800/80">
      <!-- Type Filter Pills -->
      <div class="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
        <button
          v-for="tf in typeFilters"
          :key="tf.value"
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap cursor-pointer"
          :class="selectedType === tf.value
            ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 shadow-xs'
            : 'bg-zinc-100 dark:bg-zinc-800/60 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/70 dark:hover:bg-zinc-800'"
          @click="selectedType = tf.value"
        >
          <UIcon
            :name="tf.icon"
            class="w-3.5 h-3.5"
          />
          <span>{{ tf.label }}</span>
        </button>
      </div>

      <!-- Search Input -->
      <div class="w-full sm:w-72">
        <UInput
          v-model="searchQuery"
          icon="i-lucide-search"
          placeholder="检索背景、方案、决策关键词..."
          size="sm"
          class="w-full"
        />
      </div>
    </div>

    <!-- Items Grid -->
    <div
      v-if="status === 'pending'"
      class="py-12 text-center text-zinc-400 text-sm"
    >
      <UIcon
        name="i-lucide-loader-2"
        class="w-6 h-6 animate-spin mx-auto mb-2"
      />
      正在加载知识资产...
    </div>

    <div
      v-else-if="items.length === 0"
      class="py-16 text-center bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80"
    >
      <UIcon
        name="i-lucide-folder-archive"
        class="w-12 h-12 text-zinc-300 dark:text-zinc-600 mx-auto mb-3"
      />
      <h3 class="font-medium text-zinc-700 dark:text-zinc-300">
        暂无符合条件的知识资产
      </h3>
      <p class="text-xs text-zinc-400 mt-1 max-w-md mx-auto">
        在「会话清单」或「知识复盘与提炼」中，系统会自动通过量化引擎识别高价值会话并沉淀到这里。
      </p>
    </div>

    <div
      v-else
      class="grid grid-cols-1 md:grid-cols-2 gap-4"
    >
      <div
        v-for="item in items"
        :key="item.id"
        class="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200/80 dark:border-zinc-800/80 p-5 hover:border-zinc-300 dark:hover:border-zinc-700 transition-all flex flex-col justify-between group shadow-2xs hover:shadow-xs"
      >
        <div class="space-y-3">
          <!-- Top Row: Type & Grade -->
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <span
                class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium"
                :class="{
                  'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400': item.type === 'ADR',
                  'bg-amber-500/10 text-amber-600 dark:text-amber-400': item.type === 'Gotcha',
                  'bg-blue-500/10 text-blue-600 dark:text-blue-400': item.type === 'Pattern',
                  'bg-purple-500/10 text-purple-600 dark:text-purple-400': item.type === 'Milestone'
                }"
              >
                <UIcon
                  :name="item.type === 'ADR' ? 'i-lucide-shield-check' : item.type === 'Gotcha' ? 'i-lucide-alert-triangle' : 'i-lucide-box'"
                  class="w-3 h-3"
                />
                {{ item.type }}
              </span>

              <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
                {{ item.platform.toUpperCase() }}
              </span>
            </div>

            <div class="flex items-center gap-1.5 text-xs font-mono">
              <span
                class="px-1.5 py-0.5 rounded font-bold"
                :class="item.grade === 'S' || item.grade === 'A' ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300'"
              >
                {{ item.grade }} 级
              </span>
              <span class="text-zinc-400">{{ item.score }}分</span>
            </div>
          </div>

          <!-- Title -->
          <h3
            class="font-semibold text-sm text-zinc-900 dark:text-zinc-100 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors cursor-pointer line-clamp-2"
            @click="openDetail(item)"
          >
            {{ item.title }}
          </h3>

          <!-- Decision / Solution snippet -->
          <div class="text-xs text-zinc-600 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-800/40 p-2.5 rounded-lg line-clamp-3 font-mono">
            {{ item.decision || item.context }}
          </div>

          <!-- Tags & Path -->
          <div class="flex flex-wrap items-center gap-1.5 pt-1">
            <span
              v-for="tag in item.tags"
              :key="tag"
              class="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400"
            >
              #{{ tag }}
            </span>
            <span
              v-if="item.sourceCwd"
              class="text-[10px] text-zinc-400 font-mono truncate max-w-[200px]"
              :title="item.sourceCwd"
            >
              📁 {{ item.sourceCwd.split('/').slice(-2).join('/') }}
            </span>
          </div>
        </div>

        <!-- Footer Actions -->
        <div class="flex items-center justify-between pt-4 mt-3 border-t border-zinc-100 dark:border-zinc-800/60 text-xs">
          <span class="text-zinc-400 text-[11px]">
            {{ new Date(item.updatedAt).toLocaleDateString() }}
          </span>

          <div class="flex items-center gap-1">
            <UButton
              size="xs"
              variant="ghost"
              color="neutral"
              icon="i-lucide-copy"
              @click="copyMarkdown(item.rawMarkdown || item.decision)"
            >
              复制
            </UButton>
            <UButton
              size="xs"
              variant="ghost"
              color="neutral"
              icon="i-lucide-external-link"
              @click="openDetail(item)"
            >
              详情
            </UButton>
            <UButton
              size="xs"
              variant="ghost"
              color="error"
              icon="i-lucide-trash-2"
              @click="deleteItem(item.id)"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Detail Modal -->
    <UModal v-model:open="isDetailOpen">
      <template #content>
        <div
          v-if="currentItem"
          class="p-6 space-y-5 max-h-[85vh] overflow-y-auto"
        >
          <div class="flex items-start justify-between gap-4">
            <div>
              <div class="flex items-center gap-2 mb-1.5">
                <UBadge :color="currentItem.type === 'ADR' ? 'primary' : currentItem.type === 'Gotcha' ? 'warning' : 'neutral'">
                  {{ currentItem.type }}
                </UBadge>
                <span class="text-xs font-mono text-zinc-400">{{ currentItem.platform.toUpperCase() }}</span>
                <span class="text-xs font-mono font-bold text-emerald-500">{{ currentItem.grade }}级 ({{ currentItem.score }}分)</span>
              </div>
              <h2 class="text-base font-bold text-zinc-900 dark:text-zinc-100">
                {{ currentItem.title }}
              </h2>
            </div>
            <UButton
              size="xs"
              variant="ghost"
              color="neutral"
              icon="i-lucide-x"
              @click="isDetailOpen = false"
            />
          </div>

          <div class="space-y-4 text-xs">
            <div>
              <h4 class="font-bold text-zinc-700 dark:text-zinc-300 mb-1 flex items-center gap-1">
                <UIcon
                  name="i-lucide-help-circle"
                  class="w-3.5 h-3.5"
                /> 背景与痛点 (Context)
              </h4>
              <p class="text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800/50 p-3 rounded-lg leading-relaxed whitespace-pre-wrap">
                {{ currentItem.context || '无详细描述' }}
              </p>
            </div>

            <div>
              <h4 class="font-bold text-zinc-700 dark:text-zinc-300 mb-1 flex items-center gap-1">
                <UIcon
                  name="i-lucide-check-circle"
                  class="w-3.5 h-3.5"
                /> 核心方案与决策 (Decision)
              </h4>
              <p class="text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800/50 p-3 rounded-lg leading-relaxed whitespace-pre-wrap font-mono">
                {{ currentItem.decision || '无方案详情' }}
              </p>
            </div>

            <div>
              <h4 class="font-bold text-zinc-700 dark:text-zinc-300 mb-1 flex items-center gap-1">
                <UIcon
                  name="i-lucide-target"
                  class="w-3.5 h-3.5"
                /> 落地结果与影响 (Consequences)
              </h4>
              <p class="text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800/50 p-3 rounded-lg leading-relaxed">
                {{ currentItem.consequences || currentItem.consequence || '正常落地' }}
              </p>
            </div>
          </div>

          <!-- Bottom Actions -->
          <div class="flex items-center justify-between pt-4 border-t border-zinc-200 dark:border-zinc-800">
            <span
              v-if="copySuccess"
              class="text-xs text-emerald-600 flex items-center gap-1"
            >
              <UIcon
                name="i-lucide-check"
                class="w-3.5 h-3.5"
              /> 已复制 Markdown
            </span>
            <span v-else />

            <div class="flex items-center gap-2">
              <UButton
                size="sm"
                variant="outline"
                color="neutral"
                icon="i-lucide-copy"
                @click="copyMarkdown(currentItem.rawMarkdown || currentItem.decision)"
              >
                复制标准 Markdown
              </UButton>
              <UButton
                size="sm"
                variant="solid"
                color="neutral"
                @click="isDetailOpen = false"
              >
                关闭
              </UButton>
            </div>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
