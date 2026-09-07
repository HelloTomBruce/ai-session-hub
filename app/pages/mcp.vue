<script setup lang="ts">
interface McpToolSchema {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

interface UnifiedMcpServer {
  id: string
  name: string
  platform: string
  platformName: string
  type: 'stdio' | 'sse' | 'http' | 'directory'
  command?: string
  args?: string[]
  url?: string
  headers?: Record<string, string>
  disabled?: boolean
  configPath: string
  toolsCount: number
  tools?: McpToolSchema[]
  instructions?: string
  sharedWith?: string[]
}

interface McpStats {
  total: number
  uniqueCount: number
  counts: Record<string, number>
  protocolCounts: Record<string, number>
}

interface McpServerDetailResponse {
  server: UnifiedMcpServer
  rawConfig: Record<string, unknown>
  configSnippets: {
    json: string
    toml: string
  }
}

const currentTab = ref('all')
const selectedProtocol = ref('all')
const searchQuery = ref('')

const { data: mcpData, pending, refresh } = await useFetch<{
  success: boolean
  total: number
  stats: McpStats
  data: UnifiedMcpServer[]
}>(() => '/api/mcp/servers?platform=' + currentTab.value + '&protocol=' + selectedProtocol.value + '&q=' + encodeURIComponent(searchQuery.value))

const servers = computed(() => mcpData.value?.data || [])
const stats = computed(() => mcpData.value?.stats || { total: 0, uniqueCount: 0, counts: {}, protocolCounts: {} })

const platformMeta: Record<string, { name: string, icon: string, badgeBg: string }> = {
  all: {
    name: '全部平台',
    icon: 'i-lucide-grid',
    badgeBg: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
  },
  hub: {
    name: 'Session Hub',
    icon: 'i-lucide-layers',
    badgeBg: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
  },
  pi: {
    name: 'Pi CLI',
    icon: 'i-lucide-terminal',
    badgeBg: 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800'
  },
  claude: {
    name: 'Claude Code',
    icon: 'i-lucide-bot',
    badgeBg: 'bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800'
  },
  workbuddy: {
    name: 'WorkBuddy',
    icon: 'i-lucide-briefcase',
    badgeBg: 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800'
  },
  reasonix: {
    name: 'Reasonix',
    icon: 'i-lucide-brain-circuit',
    badgeBg: 'bg-cyan-50 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-300 border-cyan-200 dark:border-cyan-800'
  },
  agy: {
    name: 'AGY CLI',
    icon: 'i-lucide-sparkles',
    badgeBg: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'
  },
  opencode: {
    name: 'OpenCode',
    icon: 'i-lucide-code-2',
    badgeBg: 'bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800'
  }
}

const protocolMeta: Record<string, { name: string, icon: string, color: string }> = {
  all: { name: '全部协议', icon: 'i-lucide-network', color: '' },
  stdio: { name: 'Stdio (本地进程)', icon: 'i-lucide-terminal', color: 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200' },
  sse: { name: 'SSE (实时流)', icon: 'i-lucide-radio', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' },
  http: { name: 'HTTP (API)', icon: 'i-lucide-globe', color: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300' },
  directory: { name: 'Schema 目录', icon: 'i-lucide-folder-tree', color: 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300' }
}

const isDetailOpen = ref(false)
const selectedServer = ref<UnifiedMcpServer | null>(null)
const detailData = ref<McpServerDetailResponse | null>(null)
const isLoadingDetail = ref(false)
const copySnippetType = ref<'json' | 'toml'>('json')
const copied = ref(false)
const copiedSnippet = ref(false)

const openDetail = async (server: UnifiedMcpServer) => {
  selectedServer.value = server
  isDetailOpen.value = true
  isLoadingDetail.value = true
  try {
    const res = await $fetch<{ success: boolean, data: McpServerDetailResponse }>('/api/mcp/servers/' + server.platform + '/' + server.id)
    detailData.value = res.data
  } catch (e) {
    console.error(e)
  } finally {
    isLoadingDetail.value = false
  }
}

const copyText = (text: string) => {
  navigator.clipboard.writeText(text)
  copied.value = true
  setTimeout(() => {
    copied.value = false
  }, 2000)
}

const copySnippet = () => {
  const snippet = copySnippetType.value === 'json'
    ? detailData.value?.configSnippets?.json
    : detailData.value?.configSnippets?.toml
  if (snippet) {
    navigator.clipboard.writeText(snippet)
    copiedSnippet.value = true
    setTimeout(() => {
      copiedSnippet.value = false
    }, 2000)
  }
}

const maskToken = (val: string) => {
  if (val.length <= 10) return '******'
  return val.slice(0, 6) + '...' + val.slice(-4)
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-200/80 dark:border-zinc-800/80">
      <div>
        <h1 class="text-xl font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
          <UIcon
            name="i-lucide-server"
            class="w-6 h-6 text-zinc-800 dark:text-zinc-200"
          />
          MCP 服务管理 (MCP Hub)
        </h1>
        <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
          全景聚合管理各 CLI / App 的 Model Context Protocol 配置、协议连接与工具接口 (Tools & Resources)
        </p>
      </div>
      <div class="flex items-center gap-2">
        <div class="px-3 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm flex items-center gap-2 text-xs">
          <UIcon
            name="i-lucide-layers"
            class="w-4 h-4 text-emerald-500"
          />
          <span class="text-zinc-500">独立服务:</span>
          <span class="font-mono font-bold text-zinc-900 dark:text-zinc-100">{{ stats.uniqueCount || 0 }}</span>
        </div>
        <div class="px-3 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm flex items-center gap-2 text-xs">
          <UIcon
            name="i-lucide-plug"
            class="w-4 h-4 text-indigo-500"
          />
          <span class="text-zinc-500">配置实例:</span>
          <span class="font-mono font-bold text-zinc-900 dark:text-zinc-100">{{ stats.total || 0 }}</span>
        </div>
        <UButton
          icon="i-lucide-refresh-cw"
          variant="outline"
          color="neutral"
          size="sm"
          :loading="pending"
          @click="refresh()"
        >
          刷新
        </UButton>
      </div>
    </div>

    <div class="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none border-b border-zinc-100 dark:border-zinc-800/50">
      <button
        v-for="(meta, key) in platformMeta"
        :key="key"
        :class="[
          'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap cursor-pointer select-none',
          currentTab === key
            ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 shadow-sm'
            : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800/60'
        ]"
        @click="currentTab = key"
      >
        <UIcon
          :name="meta.icon"
          class="w-3.5 h-3.5"
        />
        <span>{{ meta.name }}</span>
        <span
          :class="[
            'text-[10px] font-mono px-1.5 py-0.2 rounded-full',
            currentTab === key
              ? 'bg-white/20 text-white dark:bg-zinc-900/20 dark:text-zinc-900'
              : 'bg-zinc-200/70 dark:bg-zinc-800 text-zinc-500'
          ]"
        >
          {{ stats.counts[key] !== undefined ? stats.counts[key] : (key === 'all' ? stats.total : 0) }}
        </span>
      </button>
    </div>

    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div class="relative max-w-md w-full">
        <UInput
          v-model="searchQuery"
          icon="i-lucide-search"
          size="sm"
          placeholder="搜索服务名称、命令、URL 或暴露工具 (如 devtools, gitlab, memory)..."
          class="w-full"
        />
        <button
          v-if="searchQuery"
          class="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 text-xs"
          @click="searchQuery = ''"
        >
          <UIcon
            name="i-lucide-x"
            class="w-3.5 h-3.5"
          />
        </button>
      </div>
      <div class="flex items-center gap-1.5 flex-wrap">
        <button
          v-for="(meta, key) in protocolMeta"
          :key="key"
          :class="[
            'px-2.5 py-1 rounded text-xs transition-colors cursor-pointer flex items-center gap-1',
            selectedProtocol === key
              ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 font-semibold'
              : 'bg-zinc-100 dark:bg-zinc-800/80 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
          ]"
          @click="selectedProtocol = key"
        >
          <UIcon
            :name="meta.icon"
            class="w-3 h-3"
          />
          <span>{{ meta.name }}</span>
          <span class="text-[10px] font-mono opacity-70">
            ({{ stats.protocolCounts[key] !== undefined ? stats.protocolCounts[key] : stats.total }})
          </span>
        </button>
      </div>
    </div>

    <div
      v-if="pending"
      class="py-16 text-center text-zinc-400"
    >
      <UIcon
        name="i-lucide-loader-2"
        class="w-6 h-6 animate-spin mx-auto mb-2 text-zinc-500"
      />
      <p class="text-xs">
        加载 MCP 配置与服务状态中...
      </p>
    </div>

    <div
      v-else-if="servers.length === 0"
      class="py-16 text-center bg-white dark:bg-zinc-900 rounded-lg border border-dashed border-zinc-200 dark:border-zinc-800"
    >
      <div class="w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mx-auto mb-2.5 text-zinc-400">
        <UIcon
          name="i-lucide-server-off"
          class="w-5 h-5"
        />
      </div>
      <h3 class="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
        未找到匹配的 MCP 服务
      </h3>
      <p class="text-xs text-zinc-400 mt-0.5">
        请尝试切换平台或清除搜索条件
      </p>
    </div>

    <div
      v-else
      class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5"
    >
      <div
        v-for="item in servers"
        :key="item.platform + '-' + item.id"
        class="group bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 hover:shadow-sm transition-all flex flex-col justify-between p-4 cursor-pointer relative overflow-hidden"
        @click="openDetail(item)"
      >
        <div class="space-y-3">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span :class="['px-2 py-0.5 rounded text-[11px] font-medium border flex items-center gap-1', platformMeta[item.platform]?.badgeBg || 'bg-zinc-100 text-zinc-700']">
                <UIcon
                  :name="platformMeta[item.platform]?.icon || 'i-lucide-server'"
                  class="w-3 h-3"
                />
                {{ platformMeta[item.platform]?.name || item.platformName }}
              </span>
              <span :class="['px-1.5 py-0.5 rounded text-[10px] font-medium uppercase font-mono', protocolMeta[item.type]?.color || 'bg-zinc-100 text-zinc-700']">
                {{ item.type }}
              </span>
              <span
                v-if="item.disabled"
                class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
              >
                已停用
              </span>
            </div>
            <UIcon
              name="i-lucide-chevron-right"
              class="w-4 h-4 text-zinc-300 group-hover:text-zinc-600 dark:group-hover:text-zinc-200 group-hover:translate-x-0.5 transition-all"
            />
          </div>

          <div>
            <h3 class="text-sm font-bold text-zinc-900 dark:text-white group-hover:text-zinc-700 dark:group-hover:text-zinc-200 transition-colors flex items-center gap-1.5">
              {{ item.name }}
            </h3>
            <div class="mt-2 p-2 rounded bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-100 dark:border-zinc-800 text-[11px] font-mono text-zinc-600 dark:text-zinc-300 break-all line-clamp-2">
              <span
                v-if="item.command"
                class="text-indigo-600 dark:text-indigo-400 font-semibold"
              >$ {{ item.command }} {{ (item.args || []).join(' ') }}</span>
              <span
                v-else-if="item.url"
                class="text-blue-600 dark:text-blue-400 font-semibold"
              >{{ item.url }}</span>
              <span
                v-else-if="item.type === 'directory'"
                class="text-purple-600 dark:text-purple-400"
              >{{ item.configPath }}</span>
            </div>
          </div>
        </div>

        <div class="mt-3.5 pt-2.5 border-t border-zinc-100 dark:border-zinc-800/80 space-y-2">
          <div
            v-if="item.toolsCount > 0"
            class="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400"
          >
            <UIcon
              name="i-lucide-wrench"
              class="w-3.5 h-3.5 text-zinc-500"
            />
            <span>包含 <strong class="text-zinc-900 dark:text-zinc-100">{{ item.toolsCount }}</strong> 个 MCP 工具</span>
          </div>
          <div
            v-if="item.sharedWith && item.sharedWith.length > 0"
            class="text-[11px] text-zinc-500 flex items-center gap-1"
          >
            <span class="text-emerald-600 dark:text-emerald-400 font-medium">多端共享:</span>
            <span class="font-mono uppercase text-[10px] text-zinc-700 dark:text-zinc-300">
              {{ item.sharedWith.map(p => platformMeta[p]?.name || p).join(', ') }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <UModal
      v-model:open="isDetailOpen"
      :ui="{ content: 'max-w-3xl' }"
    >
      <template #content>
        <div class="p-6 space-y-5 max-h-[85vh] overflow-y-auto">
          <div class="flex items-start justify-between gap-4 pb-4 border-b border-zinc-100 dark:border-zinc-800">
            <div class="space-y-1.5">
              <div class="flex items-center gap-2 flex-wrap">
                <span :class="['px-2 py-0.5 rounded text-xs font-medium border flex items-center gap-1', platformMeta[selectedServer?.platform || '']?.badgeBg || 'bg-zinc-100']">
                  <UIcon
                    :name="platformMeta[selectedServer?.platform || '']?.icon || 'i-lucide-server'"
                    class="w-3.5 h-3.5"
                  />
                  {{ platformMeta[selectedServer?.platform || '']?.name || selectedServer?.platformName }}
                </span>
                <span :class="['px-2 py-0.5 rounded text-xs font-medium uppercase font-mono', protocolMeta[selectedServer?.type || '']?.color || 'bg-zinc-100']">
                  {{ selectedServer?.type }}
                </span>
              </div>
              <h2 class="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                {{ selectedServer?.name }}
              </h2>
            </div>
            <UButton
              variant="ghost"
              color="neutral"
              size="sm"
              icon="i-lucide-x"
              @click="isDetailOpen = false"
            />
          </div>

          <div class="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800 text-xs flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 overflow-hidden">
              <UIcon
                name="i-lucide-file-text"
                class="w-4 h-4 text-zinc-400 shrink-0"
              />
              <span class="font-mono text-zinc-600 dark:text-zinc-300 truncate">{{ selectedServer?.configPath }}</span>
            </div>
            <UButton
              variant="ghost"
              color="neutral"
              size="xs"
              :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
              @click="copyText(selectedServer?.configPath || '')"
            >
              {{ copied ? '已复制' : '复制路径' }}
            </UButton>
          </div>

          <div class="space-y-2">
            <h4 class="text-xs font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
              <UIcon
                name="i-lucide-terminal"
                class="w-3.5 h-3.5"
              />
              连接与启动配置
            </h4>
            <div class="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 text-xs font-mono space-y-1.5">
              <div
                v-if="selectedServer?.command"
                class="flex items-start gap-2"
              >
                <span class="text-zinc-400 shrink-0 w-20">Command:</span>
                <span class="text-zinc-800 dark:text-zinc-200 font-semibold">{{ selectedServer.command }}</span>
              </div>
              <div
                v-if="selectedServer?.args && selectedServer.args.length"
                class="flex items-start gap-2"
              >
                <span class="text-zinc-400 shrink-0 w-20">Args:</span>
                <span class="text-zinc-800 dark:text-zinc-200">{{ selectedServer.args.join(' ') }}</span>
              </div>
              <div
                v-if="selectedServer?.url"
                class="flex items-start gap-2"
              >
                <span class="text-zinc-400 shrink-0 w-20">URL:</span>
                <span class="text-blue-600 dark:text-blue-400 font-semibold">{{ selectedServer.url }}</span>
              </div>
              <div
                v-if="selectedServer?.headers && Object.keys(selectedServer.headers).length"
                class="flex items-start gap-2"
              >
                <span class="text-zinc-400 shrink-0 w-20">Headers:</span>
                <div class="space-y-0.5">
                  <div
                    v-for="(v, k) in selectedServer.headers"
                    :key="k"
                  >
                    {{ k }}: <span class="text-zinc-500">{{ maskToken(v) }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div
            v-if="selectedServer?.tools && selectedServer.tools.length > 0"
            class="space-y-2"
          >
            <h4 class="text-xs font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
              <UIcon
                name="i-lucide-wrench"
                class="w-3.5 h-3.5"
              />
              暴露的 MCP 工具列表 ({{ selectedServer.tools.length }})
            </h4>
            <div class="space-y-2 max-h-[260px] overflow-y-auto pr-1">
              <div
                v-for="tool in selectedServer.tools"
                :key="tool.name"
                class="p-2.5 rounded border border-zinc-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900/80 text-xs space-y-1"
              >
                <div class="font-mono font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                  <UIcon
                    name="i-lucide-code"
                    class="w-3.5 h-3.5 text-indigo-500"
                  />
                  {{ tool.name }}
                </div>
                <p
                  v-if="tool.description"
                  class="text-zinc-500 dark:text-zinc-400 leading-relaxed text-[11px]"
                >
                  {{ tool.description }}
                </p>
              </div>
            </div>
          </div>

          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <h4 class="text-xs font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
                <UIcon
                  name="i-lucide-copy"
                  class="w-3.5 h-3.5"
                />
                跨客户端配置代码生成 (可直接复制使用)
              </h4>
              <div class="flex items-center gap-1 text-xs">
                <button
                  :class="['px-2 py-0.5 rounded font-mono', copySnippetType === 'json' ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 font-bold' : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800']"
                  @click="copySnippetType = 'json'"
                >
                  JSON (Pi / Claude / WorkBuddy)
                </button>
                <button
                  :class="['px-2 py-0.5 rounded font-mono', copySnippetType === 'toml' ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 font-bold' : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800']"
                  @click="copySnippetType = 'toml'"
                >
                  TOML (Reasonix)
                </button>
              </div>
            </div>

            <div class="relative">
              <pre class="p-3 rounded-lg bg-zinc-900 text-zinc-200 text-xs font-mono overflow-x-auto max-h-[180px] leading-relaxed">{{ copySnippetType === 'json' ? (detailData?.configSnippets?.json || '') : (detailData?.configSnippets?.toml || '') }}</pre>
              <UButton
                size="xs"
                variant="outline"
                color="neutral"
                class="absolute right-2 top-2 bg-zinc-800 text-zinc-200 border-zinc-700"
                :icon="copiedSnippet ? 'i-lucide-check' : 'i-lucide-copy'"
                @click="copySnippet"
              >
                {{ copiedSnippet ? '已复制' : '复制配置' }}
              </UButton>
            </div>
          </div>

          <div class="flex justify-end pt-3 border-t border-zinc-100 dark:border-zinc-800">
            <UButton
              color="neutral"
              size="sm"
              @click="isDetailOpen = false"
            >
              关闭
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
