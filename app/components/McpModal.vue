<script setup lang="ts">
const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', val: boolean): void
}>()

const isOpen = computed({
  get: () => props.open,
  set: v => emit('update:open', v)
})

const activeTab = ref<'config' | 'tools' | 'logs'>('config')
const copiedIndex = ref<number | null>(null)

interface McpLog {
  id: string
  timestamp: number
  type: 'tool' | 'resource' | 'connection'
  name: string
  params?: Record<string, unknown>
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

const switchTab = (tab: 'config' | 'tools' | 'logs') => {
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
    title: 'Claude Code CLI',
    desc: '在终端一键运行添加 Session Hub MCP 服务',
    type: 'cli',
    code: `claude mcp add session-hub -- http://localhost:3000/api/mcp/sse`
  },
  {
    title: 'Cursor / VS Code MCP 配置',
    desc: '直接配置在 Cursor Settings -> MCP 或 .cursor/mcp.json',
    type: 'json',
    code: `{
  "mcpServers": {
    "session-hub": {
      "url": "http://localhost:3000/api/mcp/sse"
    }
  }
}`
  },
  {
    title: 'Pi CLI (~/.pi/agent/mcp.json)',
    desc: 'Pi 智能代理跨会话记忆与知识增强',
    type: 'json',
    code: `{
  "mcpServers": {
    "session-hub": {
      "url": "http://localhost:3000/api/mcp/sse"
    }
  }
}`
  },
  {
    title: 'Antigravity (AGY CLI)',
    desc: '使用 agy 终端一键连接',
    type: 'cli',
    code: `agy mcp add session-hub --url http://localhost:3000/api/mcp/sse`
  }
]

const exposedTools = [
  {
    name: 'search_sessions_fts',
    tag: '全文检索 (FTS5)',
    color: 'amber',
    desc: '对本地所有 11+ 个 AI 编码工具的历史会话正文、工具调用、代码修改文件进行分词全文检索。',
    params: 'query (必需), platform, role, cwd, limit'
  },
  {
    name: 'list_sessions',
    tag: '会话列表',
    color: 'blue',
    desc: '列出所有本地 CLI 与 Desktop App 的历史会话元数据（支持按目录、关键词、平台过滤）。',
    params: 'platform, cwd, search, limit'
  },
  {
    name: 'get_session_details',
    tag: '会话详情',
    color: 'blue',
    desc: '获取指定会话的完整对话流、Thinking 思考链与 Tool Call 参数和执行输出。',
    params: 'platform (必需), sessionId (必需)'
  },
  {
    name: 'search_knowledge_vault',
    tag: '知识金库',
    color: 'emerald',
    desc: '检索沉淀的技术资产（架构决策 ADR、踩坑记录 Gotcha、设计模式 Pattern 与里程碑）。',
    params: 'query, type (adr/gotcha/pattern/milestone), tag, limit'
  },
  {
    name: 'capture_session_insight',
    tag: '资产沉淀 (写)',
    color: 'emerald',
    desc: '允许外部 Agent 在解决复杂技术难题后，主动向 Session Hub 写入一条新的技术决策或踩坑记录。',
    params: 'title (必需), type (必需), summary (必需), solution (必需), tags'
  },
  {
    name: 'get_project_adrs',
    tag: '架构决策',
    color: 'purple',
    desc: '获取指定工作区目录或全局所有的 ADR 决策列表。',
    params: 'cwd (工作区路径前缀)'
  },
  {
    name: 'distill_knowledge',
    tag: '会话蒸馏',
    color: 'cyan',
    desc: '调用 LLM 对一个或多个开发会话进行增量提炼，输出结构化复盘总结。',
    params: 'sessionIds, platform, cwd, limit'
  },
  {
    name: 'evaluate_session_value',
    tag: '价值量化',
    color: 'rose',
    desc: '调用量化评估引擎对会话的直接性、决策合理性与信息密度进行打分并给出评级。',
    params: 'platform (必需), sessionId (必需)'
  },
  {
    name: 'get_hub_stats',
    tag: '状态统计',
    color: 'zinc',
    desc: '获取本地各 AI 工具的会话总数与平台运行状态。',
    params: '无参数'
  }
]

const copyCode = (text: string, index: number) => {
  navigator.clipboard.writeText(text)
  copiedIndex.value = index
  setTimeout(() => copiedIndex.value = null, 2000)
}
</script>

<template>
  <UModal
    v-model:open="isOpen"
    :ui="{ content: 'max-w-3xl max-h-[85vh]' }"
  >
    <template #content>
      <div class="flex flex-col h-[75vh]">
        <!-- Modal Header -->
        <div class="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <div class="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <div>
              <h2 class="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                AI Session Hub — MCP 服务中心
                <span class="text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 font-normal">SSE Server</span>
              </h2>
            </div>
          </div>

          <div class="flex items-center gap-1">
            <div class="flex items-center bg-zinc-100 dark:bg-zinc-800 p-0.5 rounded-md text-xs font-medium">
              <button
                :class="[
                  'px-3 py-1 rounded transition-all',
                  activeTab === 'config'
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
                ]"
                @click="switchTab('config')"
              >
                接入配置
              </button>
              <button
                :class="[
                  'px-3 py-1 rounded transition-all',
                  activeTab === 'tools'
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
                ]"
                @click="switchTab('tools')"
              >
                开放工具 ({{ exposedTools.length }})
              </button>
              <button
                :class="[
                  'px-3 py-1 rounded transition-all flex items-center gap-1',
                  activeTab === 'logs'
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
                ]"
                @click="switchTab('logs')"
              >
                调用日志
                <span
                  v-if="logs.length"
                  class="px-1 py-0.2 rounded-full text-[10px] bg-zinc-200 dark:bg-zinc-700"
                >
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
        <div
          v-if="activeTab === 'config'"
          class="flex-1 overflow-y-auto p-5 space-y-4"
        >
          <!-- Endpoint Card -->
          <div class="p-3.5 bg-zinc-50 dark:bg-zinc-900/90 border border-zinc-200 dark:border-zinc-800 rounded-lg space-y-2">
            <div class="text-xs font-semibold text-zinc-800 dark:text-zinc-200 flex items-center justify-between">
              <span>本地 SSE 广播端点</span>
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
                {{ copiedIndex === 999 ? '已复制' : '复制' }}
              </UButton>
            </div>
            <p class="text-[11px] text-zinc-400">
              任何支持 Model Context Protocol (SSE) 的外部编码 Agent 均可通过此地址连接本平台。
            </p>
          </div>

          <!-- Configuration snippets -->
          <div class="space-y-3 pt-2">
            <h3 class="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              快速配置模板
            </h3>

            <div
              v-for="(cfg, idx) in configs"
              :key="idx"
              class="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden bg-white dark:bg-zinc-900"
            >
              <div class="px-3.5 py-2 bg-zinc-50 dark:bg-zinc-950/50 border-b border-zinc-100 dark:border-zinc-800/80 flex items-center justify-between">
                <div>
                  <span class="text-xs font-medium text-zinc-800 dark:text-zinc-200">{{ cfg.title }}</span>
                  <p class="text-[10px] text-zinc-400">
                    {{ cfg.desc }}
                  </p>
                </div>
                <UButton
                  size="xs"
                  variant="soft"
                  color="neutral"
                  :icon="copiedIndex === idx ? 'i-lucide-check' : 'i-lucide-copy'"
                  @click="copyCode(cfg.code, idx)"
                >
                  {{ copiedIndex === idx ? '已复制' : '复制配置' }}
                </UButton>
              </div>
              <div class="p-3 bg-zinc-950 font-mono text-xs text-zinc-200 overflow-x-auto selection:bg-zinc-700">
                <pre>{{ cfg.code }}</pre>
              </div>
            </div>
          </div>
        </div>

        <!-- Tab 2: Tools View -->
        <div
          v-else-if="activeTab === 'tools'"
          class="flex-1 overflow-y-auto p-5 space-y-3"
        >
          <div class="text-xs text-zinc-500 dark:text-zinc-400 pb-1">
            Session Hub 对外提供以下 9 个标准 MCP 工具，外部 Agent 连接后可直接调用检索或沉淀知识：
          </div>

          <div
            v-for="t in exposedTools"
            :key="t.name"
            class="p-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg space-y-1.5"
          >
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="font-mono text-xs font-bold text-zinc-900 dark:text-zinc-100">{{ t.name }}</span>
                <span class="text-[10px] font-mono px-1.5 py-0.2 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                  {{ t.tag }}
                </span>
              </div>
            </div>
            <p class="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed font-sans">
              {{ t.desc }}
            </p>
            <div class="text-[11px] font-mono text-zinc-400 bg-zinc-50 dark:bg-zinc-950 px-2 py-1 rounded">
              参数: {{ t.params }}
            </div>
          </div>
        </div>

        <!-- Tab 3: Logs View -->
        <div
          v-else
          class="flex-1 overflow-y-auto p-4 flex flex-col space-y-3"
        >
          <!-- Log Actions -->
          <div class="flex items-center justify-between text-xs text-zinc-500 pb-2 border-b border-zinc-100 dark:border-zinc-800">
            <span class="font-mono">实时记录 ({{ logs.length }})</span>
            <div class="flex items-center gap-2">
              <UButton
                size="xs"
                variant="ghost"
                color="neutral"
                icon="i-lucide-refresh-cw"
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
                清空
              </UButton>
            </div>
          </div>

          <!-- Empty State -->
          <div
            v-if="!logs.length"
            class="flex-1 flex flex-col items-center justify-center text-center p-8 text-zinc-400"
          >
            <UIcon
              name="i-lucide-activity"
              class="w-8 h-8 mb-2 opacity-50"
            />
            <p class="text-xs">
              暂无 MCP 交互日志
            </p>
            <p class="text-[11px] text-zinc-500 mt-1">
              当外部客户端通过 SSE 连接或调用工具时，将在此处实时显示参数与耗时
            </p>
          </div>

          <!-- Logs List -->
          <div
            v-else
            class="space-y-2 font-mono text-xs"
          >
            <div
              v-for="log in logs"
              :key="log.id"
              :class="[
                'p-2.5 rounded border text-[11px] space-y-1',
                log.status === 'success'
                  ? 'bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800'
                  : 'bg-red-500/5 dark:bg-red-500/10 border-red-500/20 text-red-700 dark:text-red-400'
              ]"
            >
              <div class="flex items-center justify-between text-zinc-400 text-[10px]">
                <div class="flex items-center gap-2">
                  <span
                    :class="[
                      'w-1.5 h-1.5 rounded-full',
                      log.status === 'success' ? 'bg-emerald-500' : 'bg-red-500'
                    ]"
                  />
                  <span class="uppercase font-bold">{{ log.type }}</span>
                  <span class="text-zinc-600 dark:text-zinc-300 font-semibold">{{ log.name }}</span>
                </div>
                <div class="flex items-center gap-2">
                  <span v-if="log.durationMs !== undefined">{{ log.durationMs }}ms</span>
                  <span>{{ formatTime(log.timestamp) }}</span>
                </div>
              </div>

              <!-- Params Preview -->
              <div
                v-if="log.params && Object.keys(log.params).length"
                class="text-zinc-500 dark:text-zinc-400 truncate"
              >
                参数: {{ JSON.stringify(log.params) }}
              </div>

              <!-- Response or Error Preview -->
              <div
                v-if="log.responsePreview"
                class="text-zinc-700 dark:text-zinc-300 truncate font-sans"
              >
                响应: {{ log.responsePreview }}
              </div>
              <div
                v-if="log.error"
                class="text-red-600 dark:text-red-400"
              >
                错误: {{ log.error }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>
