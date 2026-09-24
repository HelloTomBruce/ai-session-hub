<script setup lang="ts">
interface SearchResultItem {
  rowid: number
  message_id: string
  session_id: string
  platform: string
  role: string
  title: string
  cwd: string
  tags: string[]
  updated_at: number
  snippet: string
  tool_summary?: string
  rank: number
}

interface SessionGroupedSearchResult {
  session_id: string
  platform: string
  title: string
  cwd: string
  tags: string[]
  updated_at: number
  matchedCount: number
  bestRank: number
  snippets: Array<{
    message_id: string
    role: string
    snippet: string
  }>
}

interface SearchData {
  results: SearchResultItem[]
  groupedSessions?: SessionGroupedSearchResult[]
  total: number
  query: string
  page: number
  pageSize: number
  platforms?: Record<string, number>
}

const query = ref('')
const selectedPlatform = ref('all')
const selectedRole = ref('all')
const viewMode = ref<'session' | 'message'>('session')

const results = ref<SearchResultItem[]>([])
const groupedSessions = ref<SessionGroupedSearchResult[]>([])
const platformCounts = ref<Record<string, number>>({})
const total = ref(0)
const page = ref(1)
const pageSize = 20

const isSearching = ref(false)
const hasSearched = ref(false)
const isSyncing = ref(false)
const error = ref('')

const { activePlugins, getPluginMeta } = usePlugins()
const { confirm } = useConfirm()

const toast = useToast()

const handleSearch = async (targetPage = 1) => {
  const q = query.value.trim()
  if (!q) return

  page.value = targetPage
  isSearching.value = true
  hasSearched.value = true
  error.value = ''

  const offset = (targetPage - 1) * pageSize
  const params = new URLSearchParams({
    q,
    limit: String(pageSize),
    offset: String(offset),
    groupBy: viewMode.value
  })

  if (selectedPlatform.value !== 'all') {
    params.set('platform', selectedPlatform.value)
  }
  if (selectedRole.value !== 'all') {
    params.set('role', selectedRole.value)
  }

  try {
    const res = await $fetch<{ success: boolean, data: SearchData }>(`/api/search?${params.toString()}`)
    if (res.success) {
      results.value = res.data.results || []
      groupedSessions.value = res.data.groupedSessions || []
      total.value = res.data.total || 0
      platformCounts.value = res.data.platforms || {}
    }
  } catch (err) {
    const fetchErr = err as { statusCode?: number, data?: { message?: string }, message?: string } | null | undefined
    if (fetchErr?.statusCode === 503) {
      error.value = '搜索索引未就绪，请先同步缓存数据。'
    } else {
      error.value = fetchErr?.data?.message || fetchErr?.message || '搜索请求失败'
    }
    results.value = []
    groupedSessions.value = []
    total.value = 0
  } finally {
    isSearching.value = false
  }
}

const handleSync = async (force = false) => {
  if (force && !await confirm({
    title: '强制全量重建会重新索引所有会话的正文与工具调用，耗时较长，确定继续吗？',
    danger: true,
    confirmLabel: '全量重建'
  })) {
    return
  }
  isSyncing.value = true
  try {
    const res = await $fetch<{
      success: boolean
      data?: {
        result?: { synced: number, total: number, errors: number }
        stats?: { sessions: number, messages: number, fts_entries: number }
      }
    }>(`/api/cache/sync${force ? '?force=true' : ''}`, { method: 'POST' })

    if (res.success) {
      const totalSessions = res.data?.stats?.sessions ?? res.data?.result?.total ?? 0
      const totalFts = res.data?.stats?.fts_entries ?? 0
      toast.add({
        title: `缓存与全文索引同步完成 (共 ${totalSessions} 个会话 / ${totalFts} 条索引)`,
        color: 'success',
        icon: 'i-lucide-check-circle'
      })
      error.value = ''
      if (query.value.trim()) {
        await handleSearch(1)
      }
    }
  } catch (err) {
    const fetchErr = err as { data?: { message?: string }, message?: string } | null | undefined
    toast.add({ title: fetchErr?.data?.message || fetchErr?.message || '同步失败', color: 'error', icon: 'i-lucide-alert-triangle' })
  } finally {
    isSyncing.value = false
  }
}

const navigateToSession = (platform: string, sessionId: string, msgId?: string) => {
  const url = msgId
    ? `/sessions/${sessionId}?cli=${platform}&msgId=${msgId}`
    : `/sessions/${sessionId}?cli=${platform}`
  navigateTo(url)
}

const highlightSnippet = (snippet: string) => {
  return snippet.replace(/<mark>/g, '<mark class="bg-amber-200/90 dark:bg-amber-800/90 dark:text-amber-100 text-amber-900 rounded px-1 py-0.5 font-semibold">')
}

const formatTime = (ts?: number) => {
  if (!ts) return '-'
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

watch([selectedPlatform, selectedRole, viewMode], () => {
  if (hasSearched.value && query.value.trim()) {
    handleSearch(1)
  }
})
</script>

<template>
  <div class="space-y-5 max-w-6xl mx-auto">
    <!-- Header -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div>
        <h1 class="text-xl font-bold text-zinc-900 dark:text-zinc-100 tracking-tight flex items-center gap-2">
          <UIcon
            name="i-lucide-search"
            class="w-5 h-5 text-amber-500"
          />
          全库智能全文检索 (FTS5)
        </h1>
        <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
          支持跨所有 11+ 平台的会话内容、工具调用、代码修改路径与中英文智能分词检索
        </p>
      </div>
      <div class="flex items-center gap-2">
        <UButton
          size="sm"
          variant="outline"
          color="neutral"
          icon="i-lucide-refresh-cw"
          :loading="isSyncing"
          @click="handleSync()"
        >
          {{ isSyncing ? '正在重建索引...' : '增量同步' }}
        </UButton>
        <UDropdownMenu
          :items="[[{
            label: '强制全量重建索引',
            icon: 'i-lucide-database-zap',
            onSelect: () => handleSync(true)
          }]]"
        >
          <UButton
            size="sm"
            variant="outline"
            color="neutral"
            icon="i-lucide-chevron-down"
            :disabled="isSyncing"
          />
        </UDropdownMenu>
      </div>
    </div>

    <!-- Search Box & Filter Controls -->
    <div class="bg-white dark:bg-zinc-900 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 space-y-3.5 shadow-xs">
      <div class="flex items-center gap-2.5">
        <div class="relative flex-1">
          <UInput
            v-model="query"
            placeholder="输入搜索关键词（支持多词组、函数名、中文词组、文件路径，如：登录 Bug、useFetch、auth.vue...）"
            size="lg"
            class="w-full font-mono text-sm"
            icon="i-lucide-search"
            @keyup.enter="handleSearch(1)"
          />
        </div>
        <UButton
          color="neutral"
          size="lg"
          class="bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-6 font-medium"
          :loading="isSearching"
          icon="i-lucide-search"
          @click="handleSearch(1)"
        >
          检索
        </UButton>
      </div>

      <!-- Filters & View Options Toolbar -->
      <div class="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-zinc-100 dark:border-zinc-800/80 text-xs">
        <!-- Platform Selector Filter -->
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="text-zinc-400 mr-1 font-medium">平台:</span>
          <button
            class="px-2 py-1 rounded-md text-xs transition-colors cursor-pointer"
            :class="selectedPlatform === 'all'
              ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 font-medium'
              : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'"
            @click="selectedPlatform = 'all'"
          >
            全部
          </button>
          <button
            v-for="p in activePlugins"
            :key="p.manifest.id"
            class="px-2 py-1 rounded-md text-xs flex items-center gap-1 transition-colors cursor-pointer"
            :class="selectedPlatform === p.manifest.id
              ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 font-medium'
              : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'"
            @click="selectedPlatform = p.manifest.id"
          >
            <UIcon
              :name="p.manifest.icon || 'i-lucide-terminal'"
              class="w-3.5 h-3.5"
            />
            <span>{{ p.manifest.name }}</span>
            <span
              v-if="platformCounts[p.manifest.id]"
              class="px-1 py-0.2 rounded-full text-[10px] bg-amber-500/20 text-amber-700 dark:text-amber-300 font-mono"
            >
              {{ platformCounts[p.manifest.id] }}
            </span>
          </button>
        </div>

        <!-- Role & Group Controls -->
        <div class="flex items-center gap-3">
          <!-- Role Filter -->
          <div class="flex items-center gap-1">
            <span class="text-zinc-400 mr-1">角色:</span>
            <button
              class="px-2 py-0.5 rounded text-xs transition-colors cursor-pointer"
              :class="selectedRole === 'all' ? 'bg-zinc-200 dark:bg-zinc-700 font-medium text-zinc-800 dark:text-zinc-200' : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'"
              @click="selectedRole = 'all'"
            >
              全部
            </button>
            <button
              class="px-2 py-0.5 rounded text-xs transition-colors cursor-pointer"
              :class="selectedRole === 'user' ? 'bg-zinc-200 dark:bg-zinc-700 font-medium text-zinc-800 dark:text-zinc-200' : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'"
              @click="selectedRole = 'user'"
            >
              User
            </button>
            <button
              class="px-2 py-0.5 rounded text-xs transition-colors cursor-pointer"
              :class="selectedRole === 'assistant' ? 'bg-zinc-200 dark:bg-zinc-700 font-medium text-zinc-800 dark:text-zinc-200' : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'"
              @click="selectedRole = 'assistant'"
            >
              Assistant
            </button>
          </div>

          <div class="h-3 w-px bg-zinc-200 dark:bg-zinc-700" />

          <!-- View Mode Toggle -->
          <div class="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 p-0.5 rounded-md">
            <button
              class="px-2 py-0.5 rounded text-xs flex items-center gap-1 transition-colors cursor-pointer"
              :class="viewMode === 'session' ? 'bg-white dark:bg-zinc-700 shadow-xs font-medium text-zinc-900 dark:text-zinc-100' : 'text-zinc-500'"
              @click="viewMode = 'session'"
            >
              <UIcon
                name="i-lucide-folder-tree"
                class="w-3.5 h-3.5"
              />
              按会话聚合
            </button>
            <button
              class="px-2 py-0.5 rounded text-xs flex items-center gap-1 transition-colors cursor-pointer"
              :class="viewMode === 'message' ? 'bg-white dark:bg-zinc-700 shadow-xs font-medium text-zinc-900 dark:text-zinc-100' : 'text-zinc-500'"
              @click="viewMode = 'message'"
            >
              <UIcon
                name="i-lucide-list"
                class="w-3.5 h-3.5"
              />
              全部平铺
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Error Alert State -->
    <div
      v-if="error"
      class="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 text-sm text-amber-800 dark:text-amber-300 flex items-center justify-between"
    >
      <div class="flex items-center gap-2">
        <UIcon
          name="i-lucide-alert-triangle"
          class="w-5 h-5 shrink-0 text-amber-500"
        />
        <span>{{ error }}</span>
      </div>
      <UButton
        size="xs"
        color="warning"
        variant="solid"
        :loading="isSyncing"
        @click="handleSync()"
      >
        一键同步缓存
      </UButton>
    </div>

    <!-- Results Area -->
    <div
      v-if="hasSearched && !isSearching && !error"
      class="space-y-4"
    >
      <!-- Result Stats -->
      <div class="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400 font-mono">
        <div>
          检索到 <span class="font-bold text-zinc-900 dark:text-zinc-100">{{ total }}</span> 条命中消息
          <span v-if="viewMode === 'session' && groupedSessions.length">
            （聚合为 {{ groupedSessions.length }} 个相关会话）
          </span>
        </div>
        <div v-if="total > 0">
          第 {{ page }} 页 / 共 {{ Math.ceil(total / pageSize) }} 页
        </div>
      </div>

      <!-- Empty State -->
      <div
        v-if="(viewMode === 'session' ? groupedSessions.length === 0 : results.length === 0)"
        class="text-center py-16 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800"
      >
        <UIcon
          name="i-lucide-file-search-2"
          class="w-12 h-12 mx-auto text-zinc-300 dark:text-zinc-600 mb-3"
        />
        <p class="text-sm font-medium text-zinc-600 dark:text-zinc-300">
          未检索到匹配的会话内容
        </p>
        <p class="text-xs text-zinc-400 dark:text-zinc-500 mt-1 max-w-sm mx-auto">
          请尝试缩短关键词，或点击右上角“增量同步/重建索引”更新最新历史记录
        </p>
      </div>

      <!-- VIEW 1: Grouped by Session -->
      <div
        v-else-if="viewMode === 'session'"
        class="space-y-3.5"
      >
        <div
          v-for="s in groupedSessions"
          :key="s.platform + '::' + s.session_id"
          class="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 transition-all shadow-xs overflow-hidden"
        >
          <!-- Session Header -->
          <div class="px-4 py-3 bg-zinc-50/60 dark:bg-zinc-950/40 border-b border-zinc-100 dark:border-zinc-800/80 flex items-center justify-between gap-3">
            <div class="flex items-center gap-2.5 min-w-0">
              <span class="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 shrink-0">
                <UIcon
                  :name="getPluginMeta(s.platform).icon"
                  class="w-3.5 h-3.5 text-zinc-500"
                />
                {{ getPluginMeta(s.platform).name }}
              </span>
              <span
                class="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate hover:text-amber-600 dark:hover:text-amber-400 cursor-pointer"
                @click="navigateToSession(s.platform, s.session_id)"
              >
                {{ s.title || '无标题会话' }}
              </span>
            </div>

            <div class="flex items-center gap-2 shrink-0">
              <span class="text-[11px] font-mono text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full font-medium">
                {{ s.matchedCount }} 条匹配
              </span>
              <UButton
                size="xs"
                variant="ghost"
                color="neutral"
                icon="i-lucide-external-link"
                @click="navigateToSession(s.platform, s.session_id)"
              >
                查看会话
              </UButton>
            </div>
          </div>

          <!-- Session Metadata Bar (CWD & Tags) -->
          <div
            v-if="s.cwd || s.tags?.length"
            class="px-4 py-1.5 text-[11px] font-mono bg-zinc-50/20 dark:bg-zinc-900/40 border-b border-zinc-100 dark:border-zinc-800/40 flex flex-wrap items-center gap-3 text-zinc-400"
          >
            <div
              v-if="s.cwd"
              class="flex items-center gap-1 truncate max-w-md"
            >
              <UIcon
                name="i-lucide-folder"
                class="w-3 h-3 text-zinc-400 shrink-0"
              />
              <span class="truncate">{{ s.cwd }}</span>
            </div>
            <div
              v-if="s.tags?.length"
              class="flex items-center gap-1 flex-wrap"
            >
              <span
                v-for="t in s.tags"
                :key="t"
                class="px-1.5 py-0.2 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-[10px]"
              >
                #{{ t }}
              </span>
            </div>
            <div class="ml-auto text-zinc-400">
              {{ formatTime(s.updated_at) }}
            </div>
          </div>

          <!-- Matched Snippets in this Session -->
          <div class="p-3 space-y-2">
            <div
              v-for="(snip, sIdx) in s.snippets"
              :key="sIdx"
              class="p-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-100 dark:border-zinc-800/80 hover:border-amber-400/50 dark:hover:border-amber-500/50 transition-colors cursor-pointer group"
              @click="navigateToSession(s.platform, s.session_id, snip.message_id)"
            >
              <div class="flex items-center justify-between pb-1 text-[11px] text-zinc-400 font-mono">
                <span class="flex items-center gap-1 font-semibold uppercase">
                  <UIcon
                    :name="snip.role === 'user' ? 'i-lucide-user' : 'i-lucide-bot'"
                    class="w-3 h-3 text-zinc-400"
                  />
                  {{ snip.role }}
                </span>
                <span class="text-zinc-400 group-hover:text-amber-500 transition-colors flex items-center gap-0.5 text-[10px]">
                  定位此消息 <UIcon
                    name="i-lucide-chevron-right"
                    class="w-3 h-3"
                  />
                </span>
              </div>
              <!-- eslint-disable vue/no-v-html -->
              <p
                class="text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed font-sans"
                v-html="highlightSnippet(snip.snippet)"
              />
              <!-- eslint-enable vue/no-v-html -->
            </div>
          </div>
        </div>
      </div>

      <!-- VIEW 2: Flat Message List -->
      <div
        v-else
        class="space-y-3"
      >
        <div
          v-for="r in results"
          :key="r.rowid"
          class="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 transition-all cursor-pointer shadow-xs p-3.5 space-y-2 group"
          @click="navigateToSession(r.platform, r.session_id, r.message_id)"
        >
          <!-- Message Header -->
          <div class="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
            <div class="flex items-center gap-2">
              <span class="inline-flex items-center gap-1 font-semibold px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
                <UIcon
                  :name="getPluginMeta(r.platform).icon"
                  class="w-3.5 h-3.5"
                />
                {{ getPluginMeta(r.platform).name }}
              </span>
              <span class="font-medium text-zinc-800 dark:text-zinc-200 truncate max-w-sm">{{ r.title }}</span>
              <span class="text-zinc-300 dark:text-zinc-700">·</span>
              <span class="font-mono uppercase text-[10px]">{{ r.role }}</span>
            </div>
            <div class="text-[11px] font-mono text-zinc-400 group-hover:text-amber-500 transition-colors flex items-center gap-1">
              <span>{{ formatTime(r.updated_at) }}</span>
              <UIcon
                name="i-lucide-chevron-right"
                class="w-3.5 h-3.5"
              />
            </div>
          </div>

          <!-- Tool Summary if exists -->
          <div
            v-if="r.tool_summary"
            class="text-[11px] font-mono text-zinc-500 dark:text-zinc-400 bg-zinc-100/70 dark:bg-zinc-800/60 px-2 py-1 rounded flex items-center gap-1.5"
          >
            <UIcon
              name="i-lucide-wrench"
              class="w-3 h-3 text-amber-500"
            />
            <span class="truncate">工具调用：{{ r.tool_summary }}</span>
          </div>

          <!-- Highlight Snippet -->
          <!-- eslint-disable vue/no-v-html -->
          <p
            class="text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed font-sans"
            v-html="highlightSnippet(r.snippet)"
          />
          <!-- eslint-enable vue/no-v-html -->
        </div>
      </div>

      <!-- Pagination -->
      <div
        v-if="total > pageSize"
        class="flex items-center justify-center gap-2 pt-4"
      >
        <UButton
          size="sm"
          variant="outline"
          color="neutral"
          :disabled="page <= 1"
          icon="i-lucide-chevron-left"
          @click="handleSearch(page - 1)"
        >
          上一页
        </UButton>
        <span class="text-xs font-mono text-zinc-500 px-3">
          {{ page }} / {{ Math.ceil(total / pageSize) }}
        </span>
        <UButton
          size="sm"
          variant="outline"
          color="neutral"
          :disabled="page >= Math.ceil(total / pageSize)"
          trailing-icon="i-lucide-chevron-right"
          @click="handleSearch(page + 1)"
        >
          下一页
        </UButton>
      </div>
    </div>
  </div>
</template>
