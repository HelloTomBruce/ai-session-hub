<script setup lang="ts">
interface SearchResultItem {
  rowid: number
  snippet: string
  content: string
  title: string
  session_id: string
  platform: string
  role: string
  rank: number
}

interface SearchData {
  results: SearchResultItem[]
  total: number
  query: string
}

const query = ref('')
const results = ref<SearchResultItem[]>([])
const total = ref(0)
const isSearching = ref(false)
const hasSearched = ref(false)
const error = ref('')
const limit = 20

const sourceMeta: Record<string, { name: string, icon: string }> = {
  pi: { name: 'Pi CLI', icon: 'i-lucide-terminal' },
  opencode: { name: 'OpenCode', icon: 'i-lucide-code-2' },
  agy: { name: 'AGY CLI', icon: 'i-lucide-sparkles' },
  claude: { name: 'Claude Code', icon: 'i-lucide-bot' },
  codex: { name: 'Codex App', icon: 'i-lucide-cpu' },
  workbuddy: { name: 'WorkBuddy', icon: 'i-lucide-briefcase' },
  reasonix: { name: 'Reasonix', icon: 'i-lucide-brain-circuit' },
  kimi: { name: 'Kimi CLI', icon: 'i-lucide-bot' },
  trae: { name: 'Trae', icon: 'i-lucide-pen-tool' },
  cursor: { name: 'Cursor', icon: 'i-lucide-cursor-arrow' },
  mimo: { name: 'Mimo CLI', icon: 'i-lucide-smartphone' }
}

const handleSearch = async () => {
  const q = query.value.trim()
  if (!q) return

  isSearching.value = true
  hasSearched.value = true
  error.value = ''

  try {
    const res = await $fetch<{ success: boolean, data: SearchData }>(`/api/search?q=${encodeURIComponent(q)}&limit=${limit}`)
    if (res.success) {
      results.value = res.data.results
      total.value = res.data.total
    }
  } catch (err) {
    const fetchErr = err as { statusCode?: number, data?: { message?: string }, message?: string } | null | undefined
    if (fetchErr?.statusCode === 503) {
      error.value = '搜索索引未就绪，请先在会话页面点击"同步缓存"按钮，或等待首次索引完成后重试。'
    } else {
      error.value = fetchErr?.data?.message || fetchErr?.message || '搜索请求失败'
    }
    results.value = []
    total.value = 0
  } finally {
    isSearching.value = false
  }
}

const navigateToSession = (platform: string, sessionId: string) => {
  navigateTo(`/sessions/${sessionId}?cli=${platform}`)
}

const highlightSnippet = (snippet: string) => {
  return snippet.replace(/<mark>/g, '<mark class="bg-amber-200 dark:bg-amber-800 rounded px-0.5 font-medium">')
}
</script>

<template>
  <div class="space-y-5">
    <!-- Header -->
    <div>
      <h1 class="text-xl font-bold text-zinc-900 dark:text-zinc-100 tracking-tight flex items-center gap-2">
        <UIcon
          name="i-lucide-search"
          class="w-5 h-5"
        />
        全文搜索
      </h1>
      <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
        跨所有 AI 编码工具的会话内容全文检索，支持模糊匹配和关键词高亮
      </p>
    </div>

    <!-- Search Box -->
    <div class="flex items-center gap-3">
      <UInput
        v-model="query"
        placeholder="输入搜索关键词，如 登录、bugfix、Nuxt 升级..."
        size="lg"
        class="flex-1 w-full"
        icon="i-lucide-search"
        @keyup.enter="handleSearch"
      />
      <UButton
        color="neutral"
        class="bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
        :loading="isSearching"
        icon="i-lucide-search"
        @click="handleSearch"
      >
        搜索
      </UButton>
    </div>

    <!-- Error State -->
    <div
      v-if="error"
      class="p-4 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 text-sm text-amber-800 dark:text-amber-300"
    >
      <div class="flex items-center gap-2">
        <UIcon
          name="i-lucide-alert-triangle"
          class="w-4 h-4 shrink-0"
        />
        <span>{{ error }}</span>
      </div>
    </div>

    <!-- Results -->
    <div
      v-if="hasSearched && !isSearching && !error"
      class="space-y-3"
    >
      <!-- Result Count -->
      <div class="text-xs text-zinc-500 dark:text-zinc-400 font-mono">
        共找到 <span class="font-bold text-zinc-700 dark:text-zinc-200">{{ total }}</span> 条相关记录
        <span v-if="results.length < total">
          ，显示前 {{ results.length }} 条
        </span>
      </div>

      <!-- Empty State -->
      <div
        v-if="results.length === 0"
        class="text-center py-12"
      >
        <UIcon
          name="i-lucide-file-search-2"
          class="w-12 h-12 mx-auto text-zinc-300 dark:text-zinc-600 mb-3"
        />
        <p class="text-sm text-zinc-500 dark:text-zinc-400">
          没有找到匹配的内容
        </p>
        <p class="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
          试试换一个关键词，或先同步缓存
        </p>
      </div>

      <!-- Result Cards -->
      <div
        v-for="r in results"
        :key="r.rowid"
        class="group"
      >
        <div
          class="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 transition-all cursor-pointer shadow-sm hover:shadow"
          @click="navigateToSession(r.platform, r.session_id)"
        >
          <!-- Header -->
          <div class="px-3.5 py-2 flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800/80">
            <div class="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
              <UIcon
                :name="sourceMeta[r.platform]?.icon || 'i-lucide-terminal'"
                class="w-3.5 h-3.5"
              />
              <span class="font-medium">{{ sourceMeta[r.platform]?.name || r.platform }}</span>
              <span class="text-zinc-300 dark:text-zinc-600">·</span>
              <span class="font-mono uppercase text-[10px]">{{ r.role }}</span>
            </div>
            <div class="text-[10px] text-zinc-400 font-mono">
              匹配度 {{ (r.rank * 100).toFixed(0) }}%
            </div>
          </div>

          <!-- Title -->
          <div class="px-3.5 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 truncate">
            {{ r.title || '无标题' }}
          </div>

          <!-- Snippet with highlights -->
          <div class="px-3.5 pb-3">
            <!-- Safe to render as HTML: the snippet is generated server-side by SQLite FTS5
                 snippet(), which HTML-escapes all matched text and only injects trusted
                 <mark> delimiters; highlightSnippet merely restyles those mark tags. -->
            <!-- eslint-disable vue/no-v-html -->
            <p
              class="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed line-clamp-3"
              v-html="highlightSnippet(r.snippet)"
            />
            <!-- eslint-enable vue/no-v-html -->
          </div>
        </div>
      </div>
    </div>

    <!-- Initial State -->
    <div
      v-if="!hasSearched && !isSearching"
      class="text-center py-16"
    >
      <UIcon
        name="i-lucide-search"
        class="w-16 h-16 mx-auto text-zinc-200 dark:text-zinc-700 mb-4"
      />
      <h3 class="text-sm font-medium text-zinc-500 dark:text-zinc-400">
        搜索 AI 编码会话
      </h3>
      <p class="text-xs text-zinc-400 dark:text-zinc-500 mt-2 max-w-sm mx-auto">
        输入关键词，搜索所有平台会话的对话内容。支持中文、英文和混合搜索。
      </p>
      <div class="mt-4 flex items-center justify-center gap-2 text-xs text-zinc-400 dark:text-zinc-500">
        <span class="px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-800 font-mono">bug 修复</span>
        <span class="px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-800 font-mono">Nuxt 升级</span>
        <span class="px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-800 font-mono">SQLite 查询</span>
      </div>
    </div>
  </div>
</template>
