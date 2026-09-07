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
  env?: Record<string, string>
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

interface McpConfigFileItem {
  platform: string
  platformName: string
  path: string
  content: string
  format: 'json' | 'toml' | 'directory'
  isAvailable: boolean
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

// Detail modal state
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

// Config Files Manager Modal state
const isConfigModalOpen = ref(false)
const configList = ref<McpConfigFileItem[]>([])
const selectedConfigPlatform = ref('pi')
const rawConfigContent = ref('')
const isSavingConfig = ref(false)
const configSaveError = ref('')
const configSaveSuccess = ref('')

const openConfigModal = async (defaultPlatform?: string) => {
  isConfigModalOpen.value = true
  configSaveError.value = ''
  configSaveSuccess.value = ''
  try {
    const res = await $fetch<{ success: boolean, data: McpConfigFileItem[] }>('/api/mcp/configs')
    configList.value = res.data
    if (defaultPlatform && configList.value.some(c => c.platform === defaultPlatform)) {
      selectedConfigPlatform.value = defaultPlatform
    } else if (configList.value.length > 0) {
      selectedConfigPlatform.value = configList.value[0].platform
    }
    loadSelectedConfigContent()
  } catch (e) {
    console.error('Failed fetching configs:', e)
  }
}

const loadSelectedConfigContent = () => {
  configSaveError.value = ''
  configSaveSuccess.value = ''
  const item = configList.value.find(c => c.platform === selectedConfigPlatform.value)
  if (item) {
    rawConfigContent.value = item.content
  }
}

const selectConfigFile = (platform: string) => {
  selectedConfigPlatform.value = platform
  loadSelectedConfigContent()
}

const saveRawConfigFile = async () => {
  isSavingConfig.value = true
  configSaveError.value = ''
  configSaveSuccess.value = ''
  try {
    await $fetch('/api/mcp/configs/' + selectedConfigPlatform.value, {
      method: 'PUT',
      body: { content: rawConfigContent.value }
    })
    configSaveSuccess.value = '配置文件保存成功！'
    // Update local item
    const idx = configList.value.findIndex(c => c.platform === selectedConfigPlatform.value)
    if (idx !== -1) {
      configList.value[idx].content = rawConfigContent.value
      configList.value[idx].isAvailable = true
    }
    refresh()
    setTimeout(() => {
      configSaveSuccess.value = ''
    }, 3000)
  } catch (err: unknown) {
    const errorObj = err as { data?: { message?: string }, message?: string }
    configSaveError.value = errorObj.data?.message || errorObj.message || '保存失败'
  } finally {
    isSavingConfig.value = false
  }
}

// Server Form Modal state (Add / Edit)
const isServerModalOpen = ref(false)
const isEditingServer = ref(false)
const isSavingServer = ref(false)
const serverFormError = ref('')

const serverForm = ref({
  platform: 'pi',
  id: '',
  type: 'stdio' as 'stdio' | 'sse' | 'http',
  command: '',
  argsText: '',
  url: '',
  headersText: '',
  disabled: false
})

const editablePlatforms = [
  { id: 'pi', name: 'Pi CLI (~/.pi/agent/mcp.json)' },
  { id: 'claude', name: 'Claude Code (~/.claude.json)' },
  { id: 'workbuddy', name: 'WorkBuddy (~/.workbuddy/mcp.json)' },
  { id: 'opencode', name: 'OpenCode (~/.config/opencode/opencode.jsonc)' }
]

const openAddServer = (defaultPlatform?: string) => {
  isEditingServer.value = false
  serverFormError.value = ''
  serverForm.value = {
    platform: (defaultPlatform && defaultPlatform !== 'all' && defaultPlatform !== 'hub' && defaultPlatform !== 'agy' && defaultPlatform !== 'reasonix') ? defaultPlatform : 'pi',
    id: '',
    type: 'stdio',
    command: '',
    argsText: '',
    url: '',
    headersText: '',
    disabled: false
  }
  isServerModalOpen.value = true
}

const openEditServer = (server: UnifiedMcpServer) => {
  isEditingServer.value = true
  serverFormError.value = ''
  serverForm.value = {
    platform: server.platform,
    id: server.id,
    type: server.type === 'directory' ? 'stdio' : server.type,
    command: server.command || '',
    argsText: (server.args || []).join(' '),
    url: server.url || '',
    headersText: server.headers ? JSON.stringify(server.headers, null, 2) : '',
    disabled: Boolean(server.disabled)
  }
  isServerModalOpen.value = true
}

const saveServerForm = async () => {
  if (!serverForm.value.id.trim()) {
    serverFormError.value = '请输入服务 ID'
    return
  }
  if (serverForm.value.type === 'stdio' && !serverForm.value.command.trim()) {
    serverFormError.value = '请输入执行命令'
    return
  }
  if ((serverForm.value.type === 'sse' || serverForm.value.type === 'http') && !serverForm.value.url.trim()) {
    serverFormError.value = '请输入服务 URL'
    return
  }

  let headers: Record<string, string> | undefined
  if (serverForm.value.headersText.trim()) {
    try {
      headers = JSON.parse(serverForm.value.headersText)
    } catch {
      serverFormError.value = 'Headers 必须为合法的 JSON 对象'
      return
    }
  }

  const args = serverForm.value.argsText.trim()
    ? serverForm.value.argsText.trim().split(/\s+/)
    : []

  isSavingServer.value = true
  serverFormError.value = ''

  try {
    if (isEditingServer.value) {
      await $fetch('/api/mcp/servers/' + serverForm.value.platform + '/' + serverForm.value.id, {
        method: 'PUT',
        body: {
          type: serverForm.value.type,
          command: serverForm.value.command || undefined,
          args: args.length > 0 ? args : undefined,
          url: serverForm.value.url || undefined,
          headers,
          disabled: serverForm.value.disabled
        }
      })
    } else {
      await $fetch('/api/mcp/servers', {
        method: 'POST',
        body: {
          platform: serverForm.value.platform,
          id: serverForm.value.id.trim(),
          type: serverForm.value.type,
          command: serverForm.value.command || undefined,
          args: args.length > 0 ? args : undefined,
          url: serverForm.value.url || undefined,
          headers,
          disabled: serverForm.value.disabled
        }
      })
    }

    isServerModalOpen.value = false
    refresh()
  } catch (err: unknown) {
    const errorObj = err as { data?: { message?: string }, message?: string }
    serverFormError.value = errorObj.data?.message || errorObj.message || '保存失败'
  } finally {
    isSavingServer.value = false
  }
}

const toggleServerStatus = async (server: UnifiedMcpServer, event: Event) => {
  event.stopPropagation()
  try {
    await $fetch('/api/mcp/servers/' + server.platform + '/' + server.id + '/toggle', {
      method: 'POST',
      body: { disabled: !server.disabled }
    })
    server.disabled = !server.disabled
  } catch (e) {
    console.error('Failed toggling server:', e)
    refresh()
  }
}

const deleteServer = async (server: UnifiedMcpServer, event: Event) => {
  event.stopPropagation()
  if (!confirm(`确定要从 ${server.platformName} 中删除 MCP 服务 "${server.id}" 吗？`)) {
    return
  }

  try {
    await $fetch('/api/mcp/servers/' + server.platform + '/' + server.id, {
      method: 'DELETE'
    })
    if (selectedServer.value?.id === server.id) {
      isDetailOpen.value = false
    }
    refresh()
  } catch (e) {
    console.error('Failed deleting server:', e)
    alert('删除失败')
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
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
          全景聚合管理各 CLI / App 的 Model Context Protocol 配置、在线启停、参数修改与配置文件编辑
        </p>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <UButton
          color="neutral"
          variant="outline"
          size="sm"
          icon="i-lucide-file-code"
          @click="openConfigModal(currentTab)"
        >
          配置文件编辑
        </UButton>
        <UButton
          color="primary"
          size="sm"
          icon="i-lucide-plus"
          @click="openAddServer(currentTab)"
        >
          添加 MCP 服务
        </UButton>
        <UButton
          color="neutral"
          variant="subtle"
          size="sm"
          icon="i-lucide-refresh-cw"
          :loading="pending"
          @click="refresh"
        >
          刷新
        </UButton>
      </div>
    </div>

    <!-- Quick Stats Cards -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div class="p-3.5 rounded-xl border border-zinc-200/80 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 backdrop-blur shadow-xs">
        <div class="flex items-center justify-between">
          <span class="text-xs text-zinc-500">已配置服务总数</span>
          <UIcon
            name="i-lucide-layers"
            class="w-4 h-4 text-emerald-500"
          />
        </div>
        <div class="mt-2 text-2xl font-bold font-mono text-zinc-900 dark:text-zinc-100">
          {{ stats.total || 0 }}
        </div>
      </div>
      <div class="p-3.5 rounded-xl border border-zinc-200/80 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 backdrop-blur shadow-xs">
        <div class="flex items-center justify-between">
          <span class="text-xs text-zinc-500">去重独立服务</span>
          <UIcon
            name="i-lucide-cpu"
            class="w-4 h-4 text-indigo-500"
          />
        </div>
        <div class="mt-2 text-2xl font-bold font-mono text-zinc-900 dark:text-zinc-100">
          {{ stats.uniqueCount || 0 }}
        </div>
      </div>
      <div class="p-3.5 rounded-xl border border-zinc-200/80 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 backdrop-blur shadow-xs">
        <div class="flex items-center justify-between">
          <span class="text-xs text-zinc-500">Stdio 进程服务</span>
          <UIcon
            name="i-lucide-terminal"
            class="w-4 h-4 text-blue-500"
          />
        </div>
        <div class="mt-2 text-2xl font-bold font-mono text-zinc-900 dark:text-zinc-100">
          {{ stats.protocolCounts?.stdio || 0 }}
        </div>
      </div>
      <div class="p-3.5 rounded-xl border border-zinc-200/80 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 backdrop-blur shadow-xs">
        <div class="flex items-center justify-between">
          <span class="text-xs text-zinc-500">SSE / HTTP 远程流</span>
          <UIcon
            name="i-lucide-radio"
            class="w-4 h-4 text-amber-500"
          />
        </div>
        <div class="mt-2 text-2xl font-bold font-mono text-zinc-900 dark:text-zinc-100">
          {{ (stats.protocolCounts?.sse || 0) + (stats.protocolCounts?.http || 0) }}
        </div>
      </div>
    </div>

    <!-- Filter Bar -->
    <div class="space-y-3">
      <!-- Platform Tabs -->
      <div class="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs border-b border-zinc-100 dark:border-zinc-800/60">
        <button
          v-for="(meta, pKey) in platformMeta"
          :key="pKey"
          :class="[
            'px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 whitespace-nowrap',
            currentTab === pKey
              ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 shadow-xs'
              : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60'
          ]"
          @click="currentTab = pKey as string"
        >
          <UIcon
            :name="meta.icon"
            class="w-3.5 h-3.5"
          />
          <span>{{ meta.name }}</span>
          <span
            v-if="pKey === 'all' || stats.counts?.[pKey] !== undefined"
            :class="[
              'px-1.5 py-0.2 rounded-full text-[10px] font-mono',
              currentTab === pKey
                ? 'bg-zinc-800 text-zinc-200 dark:bg-zinc-200 dark:text-zinc-800'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'
            ]"
          >
            {{ pKey === 'all' ? (stats.total || 0) : (stats.counts?.[pKey] || 0) }}
          </span>
        </button>
      </div>

      <!-- Protocol & Search -->
      <div class="flex flex-col sm:flex-row items-center justify-between gap-3">
        <!-- Protocol Pills -->
        <div class="flex items-center gap-1 overflow-x-auto w-full sm:w-auto text-xs">
          <button
            v-for="(pInfo, protoKey) in protocolMeta"
            :key="protoKey"
            :class="[
              'px-2.5 py-1 rounded-md transition-colors flex items-center gap-1 whitespace-nowrap',
              selectedProtocol === protoKey
                ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 font-semibold'
                : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            ]"
            @click="selectedProtocol = protoKey as string"
          >
            <UIcon
              :name="pInfo.icon"
              class="w-3.5 h-3.5"
            />
            <span>{{ pInfo.name }}</span>
          </button>
        </div>

        <!-- Search Bar -->
        <div class="w-full sm:w-64">
          <UInput
            v-model="searchQuery"
            icon="i-lucide-search"
            placeholder="搜索服务名、命令或工具..."
            size="xs"
            class="w-full"
          />
        </div>
      </div>
    </div>

    <!-- Servers Grid -->
    <div
      v-if="pending"
      class="py-16 text-center text-zinc-400 text-sm space-y-2"
    >
      <UIcon
        name="i-lucide-loader-2"
        class="w-6 h-6 animate-spin mx-auto text-zinc-500"
      />
      <p>正在扫描本地各 CLI/App 的 MCP 服务配置...</p>
    </div>

    <div
      v-else-if="servers.length === 0"
      class="py-16 text-center text-zinc-400 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-2xl bg-zinc-50/50 dark:bg-zinc-900/30 space-y-3"
    >
      <UIcon
        name="i-lucide-server-off"
        class="w-8 h-8 mx-auto text-zinc-400"
      />
      <div>
        <h3 class="font-medium text-zinc-700 dark:text-zinc-300 text-sm">
          暂无符合条件的 MCP 服务
        </h3>
        <p class="text-xs text-zinc-500 mt-1">
          当前平台或协议筛选下未发现已配置的 MCP 服务，可点击右上角添加。
        </p>
      </div>
      <UButton
        size="xs"
        color="primary"
        icon="i-lucide-plus"
        @click="openAddServer(currentTab)"
      >
        立即添加 MCP 服务
      </UButton>
    </div>

    <div
      v-else
      class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5"
    >
      <div
        v-for="server in servers"
        :key="server.platform + ':' + server.id"
        class="group relative p-4 rounded-xl border border-zinc-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900/90 hover:border-zinc-300 dark:hover:border-zinc-700 shadow-xs hover:shadow-md transition-all flex flex-col justify-between"
      >
        <div>
          <!-- Header row -->
          <div class="flex items-start justify-between gap-2">
            <div
              class="flex items-center gap-2 cursor-pointer flex-1 min-w-0"
              @click="openDetail(server)"
            >
              <div
                class="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                :class="server.disabled ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400' : (protocolMeta[server.type]?.color || 'bg-zinc-100 text-zinc-700')"
              >
                <UIcon
                  :name="protocolMeta[server.type]?.icon || 'i-lucide-server'"
                  class="w-4 h-4"
                />
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5">
                  <h3
                    class="font-mono font-bold text-sm truncate"
                    :class="server.disabled ? 'text-zinc-400 line-through' : 'text-zinc-900 dark:text-zinc-100'"
                  >
                    {{ server.name }}
                  </h3>
                  <span
                    v-if="server.disabled"
                    class="px-1.5 py-0.2 rounded text-[10px] bg-rose-500/10 text-rose-500 font-medium"
                  >
                    已禁用
                  </span>
                </div>
              </div>
            </div>

            <!-- Platform Badge & Toggle -->
            <div class="flex items-center gap-1.5 flex-shrink-0">
              <span
                :class="['px-2 py-0.5 rounded-md text-[10px] font-medium border', platformMeta[server.platform]?.badgeBg || 'bg-zinc-100 text-zinc-600']"
              >
                {{ server.platformName }}
              </span>
              <!-- Toggle Enabled/Disabled (for editable platforms) -->
              <button
                v-if="server.platform !== 'hub' && server.platform !== 'agy' && server.platform !== 'reasonix'"
                :title="server.disabled ? '点击启用服务' : '点击禁用服务'"
                :class="[
                  'w-6 h-6 rounded-md flex items-center justify-center transition-colors',
                  server.disabled
                    ? 'text-zinc-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/40'
                    : 'text-emerald-600 dark:text-emerald-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40'
                ]"
                @click="toggleServerStatus(server, $event)"
              >
                <UIcon
                  :name="server.disabled ? 'i-lucide-circle-off' : 'i-lucide-circle-check'"
                  class="w-4 h-4"
                />
              </button>
            </div>
          </div>

          <!-- Body details -->
          <div
            class="mt-3 space-y-1.5 text-xs text-zinc-600 dark:text-zinc-400 cursor-pointer"
            @click="openDetail(server)"
          >
            <!-- Command or URL -->
            <div
              v-if="server.command"
              class="font-mono text-[11px] p-1.5 rounded bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-100 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 truncate"
            >
              <span class="text-zinc-400">$ </span>{{ server.command }} {{ (server.args || []).join(' ') }}
            </div>
            <div
              v-else-if="server.url"
              class="font-mono text-[11px] p-1.5 rounded bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-100 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 truncate"
            >
              <span class="text-emerald-500">URL </span>{{ server.url }}
            </div>

            <!-- Shared across clients indicator -->
            <div
              v-if="server.sharedWith && server.sharedWith.length > 0"
              class="flex items-center gap-1.5 text-[11px] text-zinc-500 pt-1"
            >
              <UIcon
                name="i-lucide-share-2"
                class="w-3.5 h-3.5 text-indigo-500"
              />
              <span>同源复用于:</span>
              <div class="flex items-center gap-1">
                <span
                  v-for="sw in server.sharedWith"
                  :key="sw"
                  class="px-1.5 py-0.2 rounded bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 text-[10px]"
                >
                  {{ platformMeta[sw]?.name || sw }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- Footer row with Action Buttons -->
        <div class="mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800/60 flex items-center justify-between text-xs text-zinc-400">
          <div class="flex items-center gap-1.5">
            <span
              v-if="server.toolsCount > 0"
              class="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-mono text-[11px]"
            >
              <UIcon
                name="i-lucide-wrench"
                class="w-3.5 h-3.5"
              />
              {{ server.toolsCount }} 个工具
            </span>
            <span
              v-else
              class="text-zinc-400 text-[11px]"
            >
              动态提供
            </span>
          </div>

          <div class="flex items-center gap-1">
            <!-- Edit Button (for JSON platforms) -->
            <button
              v-if="server.platform !== 'hub' && server.platform !== 'agy' && server.platform !== 'reasonix'"
              title="编辑服务配置"
              class="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
              @click.stop="openEditServer(server)"
            >
              <UIcon
                name="i-lucide-pencil"
                class="w-3.5 h-3.5"
              />
            </button>
            <!-- Delete Button -->
            <button
              v-if="server.platform !== 'hub' && server.platform !== 'agy' && server.platform !== 'reasonix'"
              title="删除服务"
              class="p-1 rounded hover:bg-rose-50 dark:hover:bg-rose-950/40 text-zinc-400 hover:text-rose-500 transition-colors"
              @click.stop="deleteServer(server, $event)"
            >
              <UIcon
                name="i-lucide-trash-2"
                class="w-3.5 h-3.5"
              />
            </button>
            <!-- Detail view -->
            <button
              class="flex items-center gap-1 px-2 py-0.8 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-medium transition-colors"
              @click="openDetail(server)"
            >
              <span>详情</span>
              <UIcon
                name="i-lucide-chevron-right"
                class="w-3.5 h-3.5"
              />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Server Detail Modal -->
    <UModal
      v-model:open="isDetailOpen"
      :ui="{ content: 'sm:max-w-2xl' }"
    >
      <template #content>
        <div
          v-if="selectedServer"
          class="p-6 space-y-5"
        >
          <!-- Modal Header -->
          <div class="flex items-start justify-between gap-4 pb-4 border-b border-zinc-100 dark:border-zinc-800">
            <div class="flex items-center gap-3">
              <div
                class="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                :class="protocolMeta[selectedServer.type]?.color || 'bg-zinc-100 text-zinc-700'"
              >
                <UIcon
                  :name="protocolMeta[selectedServer.type]?.icon || 'i-lucide-server'"
                  class="w-5 h-5"
                />
              </div>
              <div>
                <h3 class="font-mono font-bold text-base text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                  {{ selectedServer.name }}
                  <span
                    :class="['px-2 py-0.5 rounded text-[10px] font-normal border', platformMeta[selectedServer.platform]?.badgeBg]"
                  >
                    {{ selectedServer.platformName }}
                  </span>
                </h3>
                <p class="font-mono text-xs text-zinc-400 truncate max-w-md mt-0.5">
                  {{ selectedServer.configPath }}
                </p>
              </div>
            </div>
            <div class="flex items-center gap-1.5">
              <UButton
                v-if="selectedServer.platform !== 'hub' && selectedServer.platform !== 'agy' && selectedServer.platform !== 'reasonix'"
                size="xs"
                variant="outline"
                color="neutral"
                icon="i-lucide-pencil"
                @click="isDetailOpen = false; openEditServer(selectedServer)"
              >
                编辑
              </UButton>
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                icon="i-lucide-x"
                @click="isDetailOpen = false"
              />
            </div>
          </div>

          <!-- Key info fields -->
          <div class="grid grid-cols-2 gap-3 text-xs">
            <div class="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-100 dark:border-zinc-800/80 space-y-1">
              <span class="text-zinc-400">通讯协议</span>
              <div class="font-medium text-zinc-900 dark:text-zinc-100">
                {{ protocolMeta[selectedServer.type]?.name || selectedServer.type }}
              </div>
            </div>
            <div class="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-100 dark:border-zinc-800/80 space-y-1">
              <span class="text-zinc-400">运行状态</span>
              <div
                class="font-medium flex items-center gap-1.5"
                :class="selectedServer.disabled ? 'text-rose-500' : 'text-emerald-500'"
              >
                <div
                  class="w-2 h-2 rounded-full"
                  :class="selectedServer.disabled ? 'bg-rose-500' : 'bg-emerald-500'"
                />
                {{ selectedServer.disabled ? '已禁用 (Disabled)' : '已启用 (Active)' }}
              </div>
            </div>
          </div>

          <!-- Command or URL -->
          <div
            v-if="selectedServer.command"
            class="space-y-1.5"
          >
            <label class="text-xs font-semibold text-zinc-700 dark:text-zinc-300">启动进程命令</label>
            <div class="font-mono text-xs p-3 rounded-lg bg-zinc-900 text-zinc-200 flex items-center justify-between gap-2 overflow-x-auto">
              <span>{{ selectedServer.command }} {{ (selectedServer.args || []).join(' ') }}</span>
              <button
                class="text-zinc-400 hover:text-white"
                @click="copyText(selectedServer.command + ' ' + (selectedServer.args || []).join(' '))"
              >
                <UIcon
                  name="i-lucide-copy"
                  class="w-4 h-4"
                />
              </button>
            </div>
          </div>

          <div
            v-if="selectedServer.url"
            class="space-y-1.5"
          >
            <label class="text-xs font-semibold text-zinc-700 dark:text-zinc-300">远程端点 URL</label>
            <div class="font-mono text-xs p-3 rounded-lg bg-zinc-900 text-zinc-200 flex items-center justify-between gap-2 overflow-x-auto">
              <span>{{ selectedServer.url }}</span>
              <button
                class="text-zinc-400 hover:text-white"
                @click="copyText(selectedServer.url)"
              >
                <UIcon
                  name="i-lucide-copy"
                  class="w-4 h-4"
                />
              </button>
            </div>
          </div>

          <!-- Headers -->
          <div
            v-if="selectedServer.headers && Object.keys(selectedServer.headers).length > 0"
            class="space-y-1.5"
          >
            <label class="text-xs font-semibold text-zinc-700 dark:text-zinc-300">请求头信息 (Headers)</label>
            <div class="font-mono text-xs p-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-800 space-y-1">
              <div
                v-for="(val, key) in selectedServer.headers"
                :key="key"
                class="flex items-center justify-between"
              >
                <span class="text-zinc-500">{{ key }}:</span>
                <span class="text-zinc-900 dark:text-zinc-100 font-bold">{{ maskToken(val) }}</span>
              </div>
            </div>
          </div>

          <!-- Instructions -->
          <div
            v-if="selectedServer.instructions"
            class="space-y-1.5"
          >
            <label class="text-xs font-semibold text-zinc-700 dark:text-zinc-300">系统上下文提示 (Instructions)</label>
            <div class="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 text-zinc-700 dark:text-zinc-300 text-xs leading-relaxed max-h-32 overflow-y-auto">
              {{ selectedServer.instructions }}
            </div>
          </div>

          <!-- Exposed Tools List -->
          <div
            v-if="selectedServer.tools && selectedServer.tools.length > 0"
            class="space-y-2"
          >
            <div class="flex items-center justify-between">
              <label class="text-xs font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
                <UIcon
                  name="i-lucide-wrench"
                  class="w-3.5 h-3.5 text-emerald-500"
                />
                已注册工具列表 ({{ selectedServer.tools.length }})
              </label>
            </div>
            <div class="space-y-1.5 max-h-48 overflow-y-auto pr-1">
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

          <!-- Config Snippets -->
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
                  JSON (Pi / Claude / WorkBuddy / OpenCode)
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

    <!-- Raw Config Files Manager Modal -->
    <UModal
      v-model:open="isConfigModalOpen"
      :ui="{ content: 'sm:max-w-3xl' }"
    >
      <template #content>
        <div class="p-6 space-y-4">
          <!-- Header -->
          <div class="flex items-center justify-between pb-3 border-b border-zinc-200 dark:border-zinc-800">
            <div class="flex items-center gap-2">
              <UIcon
                name="i-lucide-file-code"
                class="w-5 h-5 text-indigo-500"
              />
              <h3 class="font-bold text-base text-zinc-900 dark:text-zinc-100">
                MCP 配置文件在线编辑器
              </h3>
            </div>
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-lucide-x"
              @click="isConfigModalOpen = false"
            />
          </div>

          <!-- Platform Selector Tabs -->
          <div class="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs border-b border-zinc-100 dark:border-zinc-800">
            <button
              v-for="cfg in configList"
              :key="cfg.platform"
              :class="[
                'px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 whitespace-nowrap',
                selectedConfigPlatform === cfg.platform
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              ]"
              @click="selectConfigFile(cfg.platform)"
            >
              <UIcon
                :name="platformMeta[cfg.platform]?.icon || 'i-lucide-file'"
                class="w-3.5 h-3.5"
              />
              <span>{{ cfg.platformName }}</span>
              <span
                v-if="!cfg.isAvailable"
                class="text-[10px] text-amber-500"
              >(未创建)</span>
            </button>
          </div>

          <!-- Active File Path Info -->
          <div class="flex items-center justify-between text-xs text-zinc-500">
            <span class="font-mono truncate max-w-lg">
              路径: {{ configList.find(c => c.platform === selectedConfigPlatform)?.path }}
            </span>
            <span class="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 font-mono uppercase text-[10px]">
              {{ configList.find(c => c.platform === selectedConfigPlatform)?.format || 'json' }}
            </span>
          </div>

          <!-- Code Editor Textarea -->
          <div class="space-y-1">
            <textarea
              v-model="rawConfigContent"
              rows="16"
              spellcheck="false"
              class="w-full p-3 font-mono text-xs rounded-xl bg-zinc-900 text-zinc-100 border border-zinc-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 leading-relaxed resize-y"
              placeholder="配置文件内容..."
            />
          </div>

          <!-- Alert feedback -->
          <div
            v-if="configSaveError"
            class="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs flex items-center gap-2"
          >
            <UIcon
              name="i-lucide-alert-triangle"
              class="w-4 h-4 flex-shrink-0"
            />
            <span>{{ configSaveError }}</span>
          </div>
          <div
            v-if="configSaveSuccess"
            class="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-xs flex items-center gap-2"
          >
            <UIcon
              name="i-lucide-check-circle"
              class="w-4 h-4 flex-shrink-0"
            />
            <span>{{ configSaveSuccess }}</span>
          </div>

          <!-- Actions -->
          <div class="flex items-center justify-between pt-3 border-t border-zinc-100 dark:border-zinc-800">
            <span class="text-[11px] text-zinc-400">
              保存时将自动执行格式语法校验并持久化到本地文件系统
            </span>
            <div class="flex items-center gap-2">
              <UButton
                color="neutral"
                variant="outline"
                size="sm"
                @click="isConfigModalOpen = false"
              >
                取消
              </UButton>
              <UButton
                color="primary"
                size="sm"
                icon="i-lucide-save"
                :loading="isSavingConfig"
                @click="saveRawConfigFile"
              >
                保存配置文件
              </UButton>
            </div>
          </div>
        </div>
      </template>
    </UModal>

    <!-- Add / Edit Server Modal -->
    <UModal
      v-model:open="isServerModalOpen"
      :ui="{ content: 'sm:max-w-lg' }"
    >
      <template #content>
        <div class="p-6 space-y-4">
          <!-- Header -->
          <div class="flex items-center justify-between pb-3 border-b border-zinc-200 dark:border-zinc-800">
            <h3 class="font-bold text-base text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <UIcon
                :name="isEditingServer ? 'i-lucide-pencil' : 'i-lucide-plus-circle'"
                class="w-5 h-5 text-indigo-500"
              />
              {{ isEditingServer ? '编辑 MCP 服务配置' : '添加 MCP 服务' }}
            </h3>
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-lucide-x"
              @click="isServerModalOpen = false"
            />
          </div>

          <!-- Form Fields -->
          <div class="space-y-3.5 text-xs">
            <!-- Target Platform -->
            <div class="space-y-1">
              <label class="font-semibold text-zinc-700 dark:text-zinc-300">目标客户端平台</label>
              <select
                v-model="serverForm.platform"
                :disabled="isEditingServer"
                class="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option
                  v-for="p in editablePlatforms"
                  :key="p.id"
                  :value="p.id"
                >
                  {{ p.name }}
                </option>
              </select>
            </div>

            <!-- Server ID -->
            <div class="space-y-1">
              <label class="font-semibold text-zinc-700 dark:text-zinc-300">服务唯一标识 (Server ID)</label>
              <input
                v-model="serverForm.id"
                :disabled="isEditingServer"
                type="text"
                placeholder="例如: gitlab, memory, context7"
                class="w-full px-3 py-2 font-mono rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
            </div>

            <!-- Protocol Type -->
            <div class="space-y-1">
              <label class="font-semibold text-zinc-700 dark:text-zinc-300">协议类型</label>
              <div class="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  :class="[
                    'py-2 px-3 rounded-lg border font-medium transition-all text-center flex items-center justify-center gap-1.5',
                    serverForm.type === 'stdio'
                      ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 font-bold'
                      : 'border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50'
                  ]"
                  @click="serverForm.type = 'stdio'"
                >
                  <UIcon
                    name="i-lucide-terminal"
                    class="w-3.5 h-3.5"
                  />
                  Stdio
                </button>
                <button
                  type="button"
                  :class="[
                    'py-2 px-3 rounded-lg border font-medium transition-all text-center flex items-center justify-center gap-1.5',
                    serverForm.type === 'sse'
                      ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 font-bold'
                      : 'border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50'
                  ]"
                  @click="serverForm.type = 'sse'"
                >
                  <UIcon
                    name="i-lucide-radio"
                    class="w-3.5 h-3.5"
                  />
                  SSE
                </button>
                <button
                  type="button"
                  :class="[
                    'py-2 px-3 rounded-lg border font-medium transition-all text-center flex items-center justify-center gap-1.5',
                    serverForm.type === 'http'
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 font-bold'
                      : 'border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50'
                  ]"
                  @click="serverForm.type = 'http'"
                >
                  <UIcon
                    name="i-lucide-globe"
                    class="w-3.5 h-3.5"
                  />
                  HTTP
                </button>
              </div>
            </div>

            <!-- Stdio fields -->
            <template v-if="serverForm.type === 'stdio'">
              <div class="space-y-1">
                <label class="font-semibold text-zinc-700 dark:text-zinc-300">执行命令 (Command)</label>
                <input
                  v-model="serverForm.command"
                  type="text"
                  placeholder="例如: npx, uvx, node, kb"
                  class="w-full px-3 py-2 font-mono rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
              </div>
              <div class="space-y-1">
                <label class="font-semibold text-zinc-700 dark:text-zinc-300">命令行参数 (空格分隔)</label>
                <input
                  v-model="serverForm.argsText"
                  type="text"
                  placeholder="例如: -y @modelcontextprotocol/server-postgres"
                  class="w-full px-3 py-2 font-mono rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
              </div>
            </template>

            <!-- SSE / HTTP fields -->
            <template v-else>
              <div class="space-y-1">
                <label class="font-semibold text-zinc-700 dark:text-zinc-300">远程端点 URL</label>
                <input
                  v-model="serverForm.url"
                  type="text"
                  placeholder="例如: http://localhost:8000/sse"
                  class="w-full px-3 py-2 font-mono rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
              </div>
              <div class="space-y-1">
                <label class="font-semibold text-zinc-700 dark:text-zinc-300">自定义请求头 (JSON 格式，可选)</label>
                <textarea
                  v-model="serverForm.headersText"
                  rows="3"
                  placeholder="{&quot;Authorization&quot;: &quot;Bearer ...&quot;, &quot;Private-Token&quot;: &quot;...&quot;}"
                  class="w-full px-3 py-2 font-mono rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
              </div>
            </template>

            <!-- Disabled Switch -->
            <div class="flex items-center justify-between p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-100 dark:border-zinc-800">
              <div>
                <span class="font-medium text-zinc-800 dark:text-zinc-200">启用该服务</span>
                <p class="text-[11px] text-zinc-400">
                  禁用后客户端将不加载此 MCP 服务
                </p>
              </div>
              <input
                :checked="!serverForm.disabled"
                type="checkbox"
                class="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                @change="serverForm.disabled = !($event.target as HTMLInputElement).checked"
              >
            </div>
          </div>

          <!-- Error Alert -->
          <div
            v-if="serverFormError"
            class="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs flex items-center gap-2"
          >
            <UIcon
              name="i-lucide-alert-triangle"
              class="w-4 h-4 flex-shrink-0"
            />
            <span>{{ serverFormError }}</span>
          </div>

          <!-- Actions -->
          <div class="flex items-center justify-end gap-2 pt-3 border-t border-zinc-100 dark:border-zinc-800">
            <UButton
              color="neutral"
              variant="outline"
              size="sm"
              @click="isServerModalOpen = false"
            >
              取消
            </UButton>
            <UButton
              color="primary"
              size="sm"
              icon="i-lucide-check"
              :loading="isSavingServer"
              @click="saveServerForm"
            >
              {{ isEditingServer ? '保存修改' : '确认添加' }}
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
