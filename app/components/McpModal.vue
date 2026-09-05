<script setup lang="ts">
const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', val: boolean): void
}>()

const isOpen = computed({
  get: () => props.open,
  set: (v) => emit('update:open', v)
})

const activeTab = ref<'config' | 'logs'>('config')
const copiedIndex = ref<number | null>(null)

interface McpLog {
  id: string
  timestamp: number
  type: 'tool' | 'resource' | 'connection'
  name: string
  params?: any
  status: 'success' | 'error'
  durationMs?: number
  error?: string
  responsePreview?: string
}

const { data: logsData, refresh: refreshLogs, pending: isLoadingLogs } = await useFetch<{ success: boolean, data: McpLog[] }>('/api/mcp/logs', {
  server: false,
  immediate: false
})

const logs = computed(() => logsData.value?.data || [])

watch(() => props.open, (val) => {
  if (val && activeTab.value === 'logs') {
    refreshLogs()
  }
})

const switchTab = (tab: 'config' | 'logs') => {
  activeTab.value = tab
  if (tab === 'logs') refreshLogs()
}

const clearLogs = async () => {
  await $fetch('/api/mcp/logs', { method: 'DELETE' })
  refreshLogs()
}

const formatTime = (ts: number) => {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

const configs = [
  {
    title: 'Cursor / Claude Desktop / 兼容 HTTP (SSE) 客户端',
    desc: '直接通过本地 SSE 地址连接，推荐用于 Web IDE 或支持 Streamable HTTP/SSE 的客户端',
    code: `{
  "mcpServers": {
    "ai-session-hub": {
      "url": "http://localhost:3000/api/mcp/sse"
    }
  }
}`
  },
  {
    title: 'Claude Code CLI (~/.claude/settings.json)',
    desc: 'Claude Code CLI 当前标准配置方式（通过 npx/curl 或 stdio 桥接）',
    code: `{
  "mcpServers": {
    "ai-session-hub": {
      "url": "http://localhost:3000/api/mcp/sse"
    }
  }
}`
  },
  {
    title: 'OpenCode / Pi / Codex / Antigravity 配置',
    desc: '在支持 HTTP 的 AI Agent 配置中加入端点',
    code: `{
  "mcp": {
    "session-hub": {
      "url": "http://localhost:3000/api/mcp/sse"
    }
  }
}`
  }
]

const copyCode = (text: string, index: number) => {
  navigator.clipboard.writeText(text)
  copiedIndex.value = index
  setTimeout(() => copiedIndex.value = null, 2000)
}
</script>

<template>
  <UModal v-model:open="isOpen" :ui="{ content: 'max-w-3xl max-h-[85vh]' }">
    <template #content>
      <div class="flex flex-col h-[75vh]">
        <!-- Modal Header -->
        <div class="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <div class="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></div>
            <h2 class="text-sm font-bold text-zinc-900 dark:text-zinc-100">MCP 服务中枢 (Model Context Protocol)</h2>
          </div>

          <div class="flex items-center gap-1">
            <div class="flex items-center bg-zinc-100 dark:bg-zinc-800 p-0.5 rounded-md text-xs font-medium">
              <button
                @click="switchTab('config')"
                :class="[
                  'px-3 py-1 rounded transition-all',
                  activeTab === 'config'
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
                ]"
              >
                接入配置
              </button>
              <button
                @click="switchTab('logs')"
                :class="[
                  'px-3 py-1 rounded transition-all flex items-center gap-1',
                  activeTab === 'logs'
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
                ]"
              >
                调用日志
                <span v-if="logs.length" class="px-1 py-0.2 rounded-full text-[10px] bg-zinc-200 dark:bg-zinc-700">
                  {{ logs.length }}
                </span>
              </button>
            </div>

            <UButton
              size="sm"
              variant="ghost"
              color="neutral"
              icon="i-lucide-x"
              @click="isOpen = false"
            />
          </div>
        </div>

        <!-- Tab 1: Config View -->
        <div v-if="activeTab === 'config'" class="flex-1 overflow-y-auto p-5 space-y-4">
          <!-- Endpoint Card -->
          <div class="p-3.5 bg-zinc-50 dark:bg-zinc-900/90 border border-zinc-200 dark:border-zinc-800 rounded-lg space-y-2">
            <div class="text-xs font-semibold text-zinc-800 dark:text-zinc-200 flex items-center justify-between">
              <span>本地 SSE 服务端点</span>
              <span class="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                ACTIVE
              </span>
            </div>
            <div class="flex items-center justify-between bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded px-3 py-1.5 font-mono text-xs text-zinc-700 dark:text-zinc-300">
              <span>http://localhost:3000/api/mcp/sse</span>
              <UButton
                size="xs"
                variant="ghost"
                color="neutral"
                :icon="copiedIndex === 999 ? 'i-lucide-check' : 'i-lucide-copy'"
                @click="copyCode('http://localhost:3000/api/mcp/sse', 999)"
              >
                复制
              </UButton>
            </div>
            <p class="text-[11px] text-zinc-500 dark:text-zinc-400">
              包含 4 大工具：<code class="font-mono text-[10px]">list_sessions</code>、<code class="font-mono text-[10px]">get_session_details</code>、<code class="font-mono text-[10px]">distill_knowledge</code>、<code class="font-mono text-[10px]">get_hub_stats</code>
            </p>
          </div>

          <!-- Config Snippets -->
          <div class="space-y-3 pt-1">
            <h3 class="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider font-mono">
              各 AI 工具接入配置样例
            </h3>

            <div
              v-for="(cfg, idx) in configs"
              :key="idx"
              class="border border-zinc-200 dark:border-zinc-800 rounded-lg p-3.5 space-y-2 bg-white dark:bg-zinc-900"
            >
              <div class="flex items-center justify-between">
                <div>
                  <h4 class="text-xs font-bold text-zinc-900 dark:text-zinc-100">{{ cfg.title }}</h4>
                  <p class="text-[11px] text-zinc-500 dark:text-zinc-400">{{ cfg.desc }}</p>
                </div>
                <UButton
                  size="xs"
                  variant="outline"
                  color="neutral"
                  :icon="copiedIndex === idx ? 'i-lucide-check' : 'i-lucide-copy'"
                  @click="copyCode(cfg.code, idx)"
                >
                  {{ copiedIndex === idx ? '已复制' : '复制 JSON' }}
                </UButton>
              </div>

              <pre class="p-2.5 rounded bg-zinc-950 text-zinc-200 text-[11px] font-mono overflow-x-auto leading-relaxed">{{ cfg.code }}</pre>
            </div>
          </div>
        </div>

        <!-- Tab 2: Logs View -->
        <div v-else class="flex-1 overflow-y-auto p-4 flex flex-col justify-between">
          <div class="space-y-2">
            <div class="flex items-center justify-between pb-2 border-b border-zinc-100 dark:border-zinc-800">
              <span class="text-xs font-medium text-zinc-500">实时 MCP 工具调用记录</span>
              <div class="flex items-center gap-1.5">
                <UButton
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  icon="i-lucide-rotate-cw"
                  :loading="isLoadingLogs"
                  @click="() => refreshLogs()"
                >
                  刷新
                </UButton>
                <UButton
                  size="xs"
                  variant="ghost"
                  color="error"
                  icon="i-lucide-trash"
                  @click="clearLogs"
                >
                  清空日志
                </UButton>
              </div>
            </div>

            <div v-if="logs.length === 0" class="py-16 text-center text-zinc-400">
              <UIcon name="i-lucide-terminal" class="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p class="text-xs">暂无 MCP 外部调用记录</p>
              <p class="text-[11px] text-zinc-400 mt-0.5">当 Cursor、Claude Code 或其他 AI 工具调用该 MCP 服务时，调用详情将在此实时呈现。</p>
            </div>

            <div v-else class="space-y-2">
              <div
                v-for="log in logs"
                :key="log.id"
                class="p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs space-y-1.5"
              >
                <div class="flex items-center justify-between text-[11px]">
                  <div class="flex items-center gap-2">
                    <span :class="[
                      'px-1.5 py-0.2 rounded font-mono text-[10px] font-bold uppercase',
                      log.status === 'success' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' : 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300'
                    ]">
                      {{ log.status }}
                    </span>
                    <span class="font-bold font-mono text-zinc-800 dark:text-zinc-200">{{ log.name }}</span>
                  </div>
                  <div class="flex items-center gap-2 text-zinc-400 font-mono">
                    <span v-if="log.durationMs !== undefined">{{ log.durationMs }}ms</span>
                    <span>{{ formatTime(log.timestamp) }}</span>
                  </div>
                </div>

                <div v-if="log.params && Object.keys(log.params).length" class="text-[11px] text-zinc-500 font-mono bg-zinc-50 dark:bg-zinc-800/60 p-1.5 rounded truncate">
                  入参: {{ JSON.stringify(log.params) }}
                </div>

                <div v-if="log.responsePreview" class="text-[11px] text-zinc-600 dark:text-zinc-400">
                  响应: {{ log.responsePreview }}
                </div>

                <div v-if="log.error" class="text-[11px] text-red-500 font-mono">
                  错误: {{ log.error }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>
