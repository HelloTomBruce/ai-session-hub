<script setup lang="ts">
import type { LocationQuery } from 'vue-router'

interface UnifiedSession {
  id: string
  cli: string
  category: 'cli' | 'app'
  title: string
  cwd: string
  createdAt: number
  updatedAt: number
  messageCount?: number
  cost?: number
  model?: string
  status?: string
  rawLocation: string
  extra?: Record<string, unknown>
}

interface StatsData {
  total: number
  counts: Record<string, number>
}

const { activePlugins, getPluginMeta, refresh: refreshPlugins } = usePlugins()

const route = useRoute()
const router = useRouter()

const currentTab = ref((route.query.cli as string) || (route.query.tab as string) || 'all')
const searchQuery = ref((route.query.q as string) || '')
const activeTagFilter = ref((route.query.tag as string) || '')

const syncUrlQuery = () => {
  const query: LocationQuery = { ...route.query }
  if (currentTab.value && currentTab.value !== 'all') {
    query.cli = currentTab.value
  } else {
    delete query.cli
    delete query.tab
  }
  if (searchQuery.value) {
    query.q = searchQuery.value
  } else {
    delete query.q
  }
  if (activeTagFilter.value) {
    query.tag = activeTagFilter.value
  } else {
    delete query.tag
  }

  const currentCli = (route.query.cli as string) || (route.query.tab as string) || 'all'
  const currentQ = (route.query.q as string) || ''
  const currentTag = (route.query.tag as string) || ''
  if (
    currentCli !== currentTab.value
    || currentQ !== searchQuery.value
    || currentTag !== activeTagFilter.value
  ) {
    router.replace({ query })
  }
}

watch(currentTab, syncUrlQuery)
watch(searchQuery, syncUrlQuery)
watch(activeTagFilter, syncUrlQuery)

watch(
  () => route.query,
  (newQuery) => {
    const tab = (newQuery.cli as string) || (newQuery.tab as string) || 'all'
    if (tab !== currentTab.value) {
      currentTab.value = tab
    }
    const q = (newQuery.q as string) || ''
    if (q !== searchQuery.value) {
      searchQuery.value = q
    }
    const tag = (newQuery.tag as string) || ''
    if (tag !== activeTagFilter.value) {
      activeTagFilter.value = tag
    }
  },
  { deep: true }
)

const toast = useToast()
const isRefreshing = ref(false)
const tagColors: Record<string, string> = {
  bugfix: '#ef4444', refactor: '#f59e0b', feature: '#22c55e',
  deploy: '#3b82f6', migration: '#8b5cf6', documentation: '#06b6d4',
  performance: '#ec4899', security: '#dc2626', testing: '#14b8a6'
}

const getTags = (item: UnifiedSession): string[] => (item.extra?.tags as string[]) || []

/** 卡片上最多展示的标签数，超出折叠为 +N（数据面已由自动打标规则收敛，这里只是兜底） */
const CARD_TAG_LIMIT = 4
const toggleTagFilter = (tag: string) => {
  activeTagFilter.value = activeTagFilter.value === tag ? '' : tag
}
const isSyncing = ref(false)
const lastSyncTime = ref('')

// Load cache status on mount
onMounted(async () => {
  try {
    const res = await $fetch('/api/cache/status')
    if (res.success && res.data.last_sync_at) {
      const d = new Date(res.data.last_sync_at)
      lastSyncTime.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    }
  } catch {
    // 忽略缓存状态加载失败，不影响页面主功能
  }
})

// Formatters
const formatTime = (ts?: number) => {
  if (!ts) return '-'
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// Data fetching
const { data: statsData, refresh: refreshStats } = await useFetch<{ success: boolean, data: StatsData }>('/api/cli/stats')
const { data: sessionData, pending, refresh: refreshSessions } = await useFetch<{ success: boolean, total: number, data: UnifiedSession[] }>(
  () => `/api/sessions?cli=${currentTab.value}&q=${encodeURIComponent(searchQuery.value)}${activeTagFilter.value ? '&tag=' + encodeURIComponent(activeTagFilter.value) : ''}`
)

const sessions = computed(() => sessionData.value?.data || [])
const counts = computed(() => statsData.value?.data?.counts || {})
const totalCount = computed(() => statsData.value?.data?.total || 0)

// Refresh all
const handleRefresh = async () => {
  isRefreshing.value = true
  await Promise.all([refreshPlugins(), refreshStats(), refreshSessions()])
  isRefreshing.value = false
}

// Cache sync
const handleCacheSync = async () => {
  isSyncing.value = true
  try {
    const res = await $fetch<{ success: boolean, data: { result?: unknown, stats?: { last_sync_at?: string } } }>('/api/cache/sync', { method: 'POST' })
    if (res.success && res.data?.stats?.last_sync_at) {
      const d = new Date(res.data.stats.last_sync_at)
      lastSyncTime.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    }
    await handleRefresh()
  } catch (err) {
    const fetchErr = err as { data?: { message?: string }, message?: string } | null | undefined
    const msg = fetchErr?.data?.message || fetchErr?.message || '未知错误'
    toast.add({ title: '同步失败: ' + msg, color: 'error', icon: 'i-lucide-alert-triangle' })
  } finally {
    isSyncing.value = false
  }
}

// —— 大数据量渲染优化：卡片分块挂载 + 触底自动加载 ——
// 会话数千条时一次性渲染网格会长时间冻结主线程，改为每批渲染、滚到底部自动追加。
// 具体实现统一在 useChunkedList（chunk=60 / rootMargin=600，与抽取前一致）。
const {
  items: visibleSessions,
  visibleCount: visibleListCount,
  remaining: listRemaining,
  sentinelRef: listSentinelRef,
  reset: resetChunkedList
} = useChunkedList(sessions, { chunk: 60, rootMargin: 600 })

// 切换平台 / 搜索 / 标签过滤后重置渲染窗口
watch([currentTab, searchQuery, activeTagFilter], () => {
  resetChunkedList()
})

// —— 批量勾选（selectedIds / selectedSessions / isAllSelected / isIndeterminate ...）——
// 勾选范围是当前过滤结果的全部会话，与「全选本页 ({{ sessions.length }})」的计数一致。
const {
  selectedIds,
  toggleSelect,
  clearSelection,
  selectedSessions,
  isAllSelected,
  isIndeterminate,
  toggleSelectAll
} = useBatchSelection(sessions)

// —— 批量操作（批量删除 / 批量打标签 / 批量导出）——
const {
  isBatchDeleting,
  isBatchDeleteModalOpen,
  isBatchTagging,
  batchTagInput,
  openBatchDeleteConfirm,
  executeBatchDelete,
  handleBatchAddTag,
  handleBatchExport
} = useBatchActions({
  selectedSessions,
  clearSelection,
  refresh: handleRefresh
})

// —— 单条操作（详情跳转 / 重命名 / 删除）——
const {
  selectedSession,
  openDetail,
  isEditOpen,
  editingTitle,
  isSavingEdit,
  startEdit,
  saveEdit,
  isDeleteOpen,
  isDeleting,
  confirmDelete,
  executeDelete
} = useSessionActions<UnifiedSession>({
  refresh: handleRefresh,
  // 原名改完后同步页面列表里的同一条（refresh 之前先把 UI 改对，避免闪回旧标题）
  syncTitleToList: (session, title) => {
    const itemInList = sessionData.value?.data?.find(s => s.id === session.id)
    if (itemInList) itemInList.title = title
  }
})
</script>

<template>
  <div class="space-y-5">
    <!-- Top Stats Tabs -->
    <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 xl:grid-cols-8 gap-2">
      <!-- All -->
      <div
        :class="[
          'p-3 rounded-lg border transition-all cursor-pointer select-none',
          currentTab === 'all'
            ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 border-transparent shadow-sm'
            : 'bg-white dark:bg-zinc-900 border-zinc-200/90 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-700'
        ]"
        @click="currentTab = 'all'"
      >
        <div class="flex items-center justify-between">
          <span class="text-xs font-medium opacity-80">全部汇总</span>
          <UIcon
            name="i-lucide-grid"
            class="w-3.5 h-3.5 opacity-60"
          />
        </div>
        <div class="text-xl font-bold mt-1 font-mono tracking-tight">
          {{ totalCount }}
        </div>
      </div>

      <!-- Each Active Plugin Source Tab -->
      <div
        v-for="p in activePlugins"
        :key="p.manifest.id"
        :class="[
          'p-3 rounded-lg border transition-all cursor-pointer select-none',
          currentTab === p.manifest.id
            ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 border-transparent shadow-sm'
            : 'bg-white dark:bg-zinc-900 border-zinc-200/90 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-700'
        ]"
        @click="currentTab = p.manifest.id"
      >
        <div class="flex items-center justify-between">
          <span
            class="text-xs font-medium truncate flex items-center gap-1.5"
            :title="p.manifest.name"
          >
            <UIcon
              :name="p.manifest.icon || 'i-lucide-terminal'"
              class="w-3.5 h-3.5 shrink-0 opacity-70"
            />
            <span class="truncate">{{ p.manifest.name }}</span>
          </span>
          <span :class="['text-[9px] uppercase font-mono px-1 py-0.2 rounded', currentTab === p.manifest.id ? 'bg-zinc-800 text-zinc-300 dark:bg-zinc-200 dark:text-zinc-800' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400']">
            {{ (p.manifest.category || 'cli').toUpperCase() }}
          </span>
        </div>
        <div class="text-xl font-bold mt-1 font-mono tracking-tight flex items-center justify-between">
          <span>{{ counts[p.manifest.id] ?? p.sessionCount ?? 0 }}</span>
          <span
            v-if="!p.isAvailable"
            class="text-[10px] font-sans font-normal opacity-40"
          >未就绪</span>
        </div>
      </div>
    </div>

    <!-- Actions & Filter Bar -->
    <div class="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white dark:bg-zinc-900 p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 shadow-sm">
      <div class="flex items-center gap-2 w-full sm:w-auto flex-1 max-w-md">
        <UInput
          v-model="searchQuery"
          icon="i-lucide-search"
          placeholder="搜索会话标题、路径、ID或模型..."
          size="sm"
          class="w-full"
        />
      </div>

      <div class="flex items-center gap-2 w-full sm:w-auto justify-end">
        <UButton
          icon="i-lucide-database"
          color="neutral"
          size="sm"
          variant="outline"
          :loading="isSyncing"
          :disabled="isSyncing"
          @click="handleCacheSync"
        >
          同步
        </UButton>
        <span
          v-if="lastSyncTime"
          class="text-[10px] text-zinc-400 font-mono whitespace-nowrap hidden md:inline"
        >
          {{ lastSyncTime }}
        </span>
        <UButton
          icon="i-lucide-rotate-cw"
          color="neutral"
          variant="outline"
          size="sm"
          :loading="isRefreshing"
          @click="handleRefresh"
        >
          刷新
        </UButton>
      </div>
    </div>

    <!-- Batch Action Toolbar -->
    <div
      v-if="!pending && sessions.length > 0"
      class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-3.5 py-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200/90 dark:border-zinc-800 text-xs shadow-xs"
    >
      <!-- 左侧：全选与选中计数 -->
      <div class="flex items-center gap-3">
        <button
          type="button"
          class="flex items-center gap-2 text-zinc-700 dark:text-zinc-200 hover:text-zinc-900 dark:hover:white transition-colors cursor-pointer select-none"
          @click="toggleSelectAll"
        >
          <div
            class="w-4 h-4 rounded border-2 flex items-center justify-center transition-all shrink-0"
            :class="isAllSelected
              ? 'bg-zinc-900 dark:bg-zinc-100 border-zinc-900 dark:border-zinc-100 text-white dark:text-zinc-900 shadow-xs'
              : isIndeterminate
                ? 'bg-zinc-300 dark:bg-zinc-700 border-zinc-400 dark:border-zinc-500'
                : 'border-zinc-300 dark:border-zinc-600 hover:border-zinc-500 bg-white dark:bg-zinc-800'"
          >
            <UIcon
              v-if="isAllSelected"
              name="i-lucide-check"
              class="w-3 h-3 stroke-[3]"
            />
            <div
              v-else-if="isIndeterminate"
              class="w-2 h-0.5 bg-zinc-700 dark:bg-zinc-200 rounded-full"
            />
          </div>
          <span class="font-medium text-xs">
            全选本页 <span class="text-zinc-400 font-normal">({{ sessions.length }})</span>
          </span>
        </button>

        <span
          v-if="selectedIds.size > 0"
          class="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 tracking-tight"
        >
          已选 {{ selectedIds.size }} 项
        </span>
        <button
          v-if="selectedIds.size > 0"
          class="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 underline text-xs"
          @click="clearSelection"
        >
          取消选择
        </button>
      </div>

      <!-- 右侧：批量操作区 -->
      <div class="flex items-center gap-2 flex-wrap">
        <template v-if="selectedIds.size > 0">
          <UButton
            size="xs"
            color="error"
            variant="solid"
            icon="i-lucide-trash-2"
            :loading="isBatchDeleting"
            class="font-medium shadow-xs"
            @click="openBatchDeleteConfirm"
          >
            批量删除 ({{ selectedIds.size }})
          </UButton>
          <UButton
            size="xs"
            color="neutral"
            variant="subtle"
            icon="i-lucide-download"
            class="font-medium bg-white hover:bg-zinc-100 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-700 shadow-2xs"
            @click="handleBatchExport('json')"
          >
            导出 JSON
          </UButton>
          <UButton
            size="xs"
            color="neutral"
            variant="subtle"
            icon="i-lucide-file-text"
            class="font-medium bg-white hover:bg-zinc-100 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-700 shadow-2xs"
            @click="handleBatchExport('markdown')"
          >
            导出 Markdown
          </UButton>
          <div class="flex items-center gap-1 ml-0.5">
            <UInput
              v-model="batchTagInput"
              size="xs"
              placeholder="标签名..."
              class="w-24"
              @keyup.enter="handleBatchAddTag"
            />
            <UButton
              size="xs"
              color="neutral"
              variant="subtle"
              :loading="isBatchTagging"
              icon="i-lucide-tag"
              class="font-medium bg-white hover:bg-zinc-100 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-700 shadow-2xs"
              @click="handleBatchAddTag"
            >
              打标签
            </UButton>
          </div>
        </template>
        <template v-else>
          <span class="text-[11px] text-zinc-400 flex items-center gap-1.5">
            <UIcon
              name="i-lucide-mouse-pointer-click"
              class="w-3.5 h-3.5 opacity-60"
            />
            勾选卡片复选框或点击“全选本页”，即可执行批量删除与管理
          </span>
        </template>
      </div>
    </div>

    <!-- 标签筛选指示条：独立渲染。曾误插进下面的 v-if/v-else-if 链，导致点标签后卡片网格整块消失 -->
    <template v-if="activeTagFilter && !pending">
      <div class="mb-2 flex items-center gap-2 text-xs text-zinc-500">
        <span>筛选标签：</span>
        <span
          class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium cursor-pointer border"
          :style="{
            backgroundColor: (tagColors[activeTagFilter] || '#6366f1') + '20',
            color: tagColors[activeTagFilter] || '#6366f1',
            borderColor: (tagColors[activeTagFilter] || '#6366f1') + '40'
          }"
          @click="activeTagFilter = ''"
        >
          #{{ activeTagFilter }}
          <UIcon
            name="i-lucide-x"
            class="w-3 h-3"
          />
        </span>
        <span class="text-zinc-400">({{ sessions.length }})</span>
      </div>
    </template>

    <!-- Sessions List -->
    <template v-if="pending">
      <div class="py-16 text-center text-zinc-400">
        <UIcon
          name="i-lucide-loader-2"
          class="w-6 h-6 animate-spin mx-auto mb-2 text-zinc-500"
        />
        <p class="text-xs">
          加载会话数据中...
        </p>
      </div>
    </template>

    <template v-else-if="sessions.length === 0">
      <div class="py-16 text-center bg-white dark:bg-zinc-900 rounded-lg border border-dashed border-zinc-200 dark:border-zinc-800">
        <div class="w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mx-auto mb-2.5 text-zinc-400">
          <UIcon
            name="i-lucide-inbox"
            class="w-5 h-5"
          />
        </div>
        <h3 class="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          未检索到匹配的会话
        </h3>
        <p class="text-xs text-zinc-400 mt-0.5">
          请尝试更换上方平台分类或搜索关键字
        </p>
      </div>
    </template>

    <!-- Batch Action Bar & Sessions Grid -->
    <template v-else>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
        <SessionCard
          v-for="item in visibleSessions"
          :key="`${item.cli}-${item.id}`"
          :item="item"
          :selected="selectedIds.has(`${item.cli}::${item.id}`)"
          :tags="getTags(item)"
          :limit="CARD_TAG_LIMIT"
          :plugin-meta="getPluginMeta(item.cli)"
          :tag-colors="tagColors"
          :active-tag-filter="activeTagFilter"
          :format-time="formatTime"
          @select="toggleSelect(item)"
          @open="openDetail(item)"
          @edit="startEdit(item)"
          @remove="confirmDelete(item)"
          @tag="toggleTagFilter"
        />
      </div>

      <!-- 分块加载哨兵：滚入视口自动追加下一批卡片 -->
      <div
        v-if="listRemaining > 0"
        ref="listSentinelRef"
        class="py-6 text-center text-xs text-zinc-400 flex items-center justify-center gap-2"
      >
        <UIcon
          name="i-lucide-loader-2"
          class="w-3.5 h-3.5 animate-spin"
        />
        <span class="font-mono">已显示 {{ visibleListCount }} / {{ sessions.length }} 个会话，继续滚动自动加载</span>
      </div>
    </template>

    <!-- Edit Modal -->
    <!-- Edit Modal -->
    <UModal
      v-model:open="isEditOpen"
      :ui="{ content: 'max-w-md' }"
    >
      <template #content>
        <div class="p-4 space-y-3.5">
          <h3 class="text-sm font-bold text-zinc-900 dark:text-white">
            编辑会话标题
          </h3>
          <UFormField label="会话标题">
            <UInput
              v-model="editingTitle"
              size="sm"
              class="w-full"
              placeholder="输入新的会话标题"
            />
          </UFormField>
          <div class="flex justify-end gap-2 pt-2">
            <UButton
              variant="ghost"
              color="neutral"
              size="sm"
              @click="isEditOpen = false"
            >
              取消
            </UButton>
            <UButton
              color="neutral"
              size="sm"
              class="bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              :loading="isSavingEdit"
              @click="saveEdit"
            >
              保存修改
            </UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- Delete Confirmation Modal -->
    <UModal
      v-model:open="isDeleteOpen"
      :ui="{ content: 'max-w-md' }"
    >
      <template #content>
        <div class="p-4 space-y-3.5">
          <div class="flex items-center gap-2.5 text-red-600">
            <UIcon
              name="i-lucide-alert-triangle"
              class="w-5 h-5"
            />
            <h3 class="text-sm font-bold text-zinc-900 dark:text-white">
              确认删除会话？
            </h3>
          </div>
          <p class="text-xs text-zinc-500 dark:text-zinc-400">
            你正在删除来自 <span class="font-bold">{{ selectedSession?.cli.toUpperCase() }}</span> 的会话：
            <br>
            <span class="font-medium text-zinc-700 dark:text-zinc-200 mt-1 block font-mono text-xs">{{ selectedSession?.title }}</span>
          </p>
          <div class="flex justify-end gap-2 pt-2">
            <UButton
              variant="ghost"
              color="neutral"
              size="sm"
              @click="isDeleteOpen = false"
            >
              取消
            </UButton>
            <UButton
              color="error"
              size="sm"
              :loading="isDeleting"
              @click="executeDelete"
            >
              确认删除
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
    <!-- Batch Delete Confirmation Modal -->
    <UModal
      v-model:open="isBatchDeleteModalOpen"
      :ui="{ content: 'max-w-md' }"
    >
      <template #content>
        <div class="p-5 space-y-4">
          <div class="flex items-center gap-2.5 text-red-600">
            <UIcon
              name="i-lucide-alert-triangle"
              class="w-5 h-5 shrink-0"
            />
            <h3 class="text-base font-bold text-zinc-900 dark:text-white">
              确认批量删除 {{ selectedSessions.length }} 个会话？
            </h3>
          </div>

          <p class="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
            此操作将彻底删除所选会话在本地磁盘上的源文件、SQLite 缓存索引与诊断记录，<span class="font-semibold text-red-600 dark:text-red-400">操作不可撤销</span>。
          </p>

          <!-- 待删除会话预览列表 -->
          <div class="max-h-48 overflow-y-auto rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/40 p-2 space-y-1.5">
            <div
              v-for="s in selectedSessions.slice(0, 5)"
              :key="`${s.cli}::${s.id}`"
              class="flex items-center justify-between text-xs py-1 px-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
            >
              <div class="flex items-center gap-1.5 truncate mr-2">
                <UIcon
                  :name="getPluginMeta(s.cli).icon"
                  class="w-3.5 h-3.5 shrink-0 text-zinc-400"
                />
                <span class="truncate font-medium text-zinc-700 dark:text-zinc-300">{{ s.title }}</span>
              </div>
              <span class="font-mono text-[10px] text-zinc-400 shrink-0 uppercase">{{ s.cli }}</span>
            </div>
            <div
              v-if="selectedSessions.length > 5"
              class="text-[11px] text-center text-zinc-400 pt-1 border-t border-zinc-200 dark:border-zinc-800"
            >
              ... 以及其余 {{ selectedSessions.length - 5 }} 个会话
            </div>
          </div>

          <div class="flex justify-end gap-2 pt-1">
            <UButton
              variant="ghost"
              color="neutral"
              size="sm"
              :disabled="isBatchDeleting"
              @click="isBatchDeleteModalOpen = false"
            >
              取消
            </UButton>
            <UButton
              color="error"
              size="sm"
              icon="i-lucide-trash-2"
              :loading="isBatchDeleting"
              @click="executeBatchDelete"
            >
              确认批量删除 ({{ selectedSessions.length }})
            </UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- Floating Batch Action Bar (Sticky at bottom) -->
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="transform translate-y-12 opacity-0"
      enter-to-class="transform translate-y-0 opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="transform translate-y-0 opacity-100"
      leave-to-class="transform translate-y-12 opacity-0"
    >
      <div
        v-if="selectedIds.size > 0"
        class="dark fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-4 py-2.5 rounded-xl bg-zinc-900/95 dark:bg-zinc-800/95 text-white backdrop-blur shadow-2xl border border-zinc-700/60 max-w-[92vw]"
      >
        <div class="flex items-center gap-2 shrink-0">
          <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span class="text-xs font-semibold">已选 {{ selectedIds.size }} 个会话</span>
        </div>

        <div class="h-4 w-px bg-zinc-700 shrink-0" />

        <div class="flex items-center gap-2 overflow-x-auto">
          <UButton
            size="xs"
            color="error"
            variant="solid"
            icon="i-lucide-trash-2"
            class="font-medium shrink-0 shadow-xs"
            :loading="isBatchDeleting"
            @click="openBatchDeleteConfirm"
          >
            批量删除 ({{ selectedIds.size }})
          </UButton>

          <UButton
            size="xs"
            color="neutral"
            variant="subtle"
            icon="i-lucide-download"
            class="shrink-0 bg-zinc-800/90 hover:bg-zinc-700 text-zinc-100 hover:text-white border border-zinc-700/80 font-medium"
            @click="handleBatchExport('json')"
          >
            导出 JSON
          </UButton>

          <UButton
            size="xs"
            color="neutral"
            variant="subtle"
            icon="i-lucide-file-text"
            class="shrink-0 bg-zinc-800/90 hover:bg-zinc-700 text-zinc-100 hover:text-white border border-zinc-700/80 font-medium"
            @click="handleBatchExport('markdown')"
          >
            导出 MD
          </UButton>

          <button
            class="text-xs text-zinc-400 hover:text-zinc-200 underline shrink-0 ml-1 cursor-pointer"
            @click="clearSelection"
          >
            取消
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>
