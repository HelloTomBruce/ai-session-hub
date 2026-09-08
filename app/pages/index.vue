<script setup lang="ts">
interface UnifiedSession {
  id: string
  cli: 'pi' | 'opencode' | 'agy' | 'claude' | 'codex' | 'workbuddy' | 'reasonix'
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
  extra?: Record<string, any>
}

interface StatsData {
  total: number
  counts: {
    pi: number
    opencode: number
    agy: number
    claude: number
    codex: number
    workbuddy: number
    reasonix: number
  }
}

const currentTab = ref('all')
const searchQuery = ref('')
const isRefreshing = ref(false)

// Data fetching
const { data: statsData, refresh: refreshStats } = await useFetch<{ success: boolean, data: StatsData }>('/api/cli/stats')
const { data: sessionData, pending, refresh: refreshSessions } = await useFetch<{ success: boolean, total: number, data: UnifiedSession[] }>(
  () => `/api/sessions?cli=${currentTab.value}&q=${encodeURIComponent(searchQuery.value)}`
)

const sessions = computed(() => sessionData.value?.data || [])
const counts = computed(() => statsData.value?.data?.counts || { pi: 0, opencode: 0, agy: 0, claude: 0, codex: 0, workbuddy: 0, reasonix: 0 })
const totalCount = computed(() => statsData.value?.data?.total || 0)

// Refresh all
const handleRefresh = async () => {
  isRefreshing.value = true
  await Promise.all([refreshStats(), refreshSessions()])
  isRefreshing.value = false
}

// Formatters
const formatTime = (ts?: number) => {
  if (!ts) return '-'
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const sourceMeta = {
  pi: {
    name: 'Pi CLI',
    type: 'CLI',
    icon: 'i-lucide-terminal'
  },
  opencode: {
    name: 'OpenCode',
    type: 'CLI',
    icon: 'i-lucide-code-2'
  },
  agy: {
    name: 'AGY CLI',
    type: 'CLI',
    icon: 'i-lucide-sparkles'
  },
  claude: {
    name: 'Claude Code',
    type: 'CLI',
    icon: 'i-lucide-bot'
  },
  codex: {
    name: 'Codex App',
    type: 'APP',
    icon: 'i-lucide-cpu'
  },
  workbuddy: {
    name: 'WorkBuddy',
    type: 'APP',
    icon: 'i-lucide-briefcase'
  },
  reasonix: {
    name: 'Reasonix',
    type: 'APP',
    icon: 'i-lucide-brain-circuit'
  }
}

// Modal States
const isDetailOpen = ref(false)
const selectedSession = ref<UnifiedSession | null>(null)
const sessionDetail = ref<any>(null)
const isLoadingDetail = ref(false)
const detailMode = ref<'chat' | 'thinking'>('chat')

const openDetail = (session: UnifiedSession) => {
  navigateTo(`/sessions/${session.id}?cli=${session.cli}`)
}

// Extract thinking steps from messages
const thinkingTimeline = computed(() => {
  if (!sessionDetail.value?.messages) return []
  const timeline: Array<{
    type: 'intent' | 'thought' | 'tool' | 'conclusion'
    title: string
    detail?: string
    timestamp?: number
    badge?: string
    role: string
  }> = []

  for (const msg of sessionDetail.value.messages) {
    if (msg.role === 'user') {
      timeline.push({
        type: 'intent',
        title: '用户提出意图 / 任务需求',
        detail: msg.content,
        timestamp: msg.timestamp,
        role: 'user'
      })
    } else if (msg.role === 'assistant') {
      if (msg.thought) {
        timeline.push({
          type: 'thought',
          title: '思维链推导与架构选型 (Thinking Rationale)',
          detail: msg.thought,
          timestamp: msg.timestamp,
          role: 'assistant'
        })
      }
      if (msg.toolCalls && msg.toolCalls.length) {
        for (const tool of msg.toolCalls) {
          const name = tool.name || tool.type || 'Tool'
          const args = typeof tool.arguments === 'string' ? tool.arguments : JSON.stringify(tool.arguments || tool.args || tool.input || {})
          timeline.push({
            type: 'tool',
            title: `工具调用: ${name}`,
            detail: args,
            badge: name,
            timestamp: msg.timestamp,
            role: 'tool'
          })
        }
      }
      if (msg.content && msg.content.trim()) {
        timeline.push({
          type: 'conclusion',
          title: '方案产出 / 答复反馈',
          detail: msg.content,
          timestamp: msg.timestamp,
          role: 'assistant'
        })
      }
    }
  }
  return timeline
})

// Edit Modal
const isEditOpen = ref(false)
const editingTitle = ref('')
const isSavingEdit = ref(false)

const startEdit = (session: UnifiedSession) => {
  selectedSession.value = session
  editingTitle.value = session.title
  isEditOpen.value = true
}

const saveEdit = async () => {
  if (!selectedSession.value) return
  isSavingEdit.value = true
  try {
    const res = await $fetch<{ success: boolean, message?: string }>(`/api/sessions/${selectedSession.value.id}?cli=${selectedSession.value.cli}`, {
      method: 'PUT',
      body: { title: editingTitle.value }
    })
    if (res.success) {
      if (selectedSession.value) {
        selectedSession.value.title = editingTitle.value
      }
      const itemInList = sessionData.value?.data?.find(s => s.id === selectedSession.value?.id)
      if (itemInList) {
        itemInList.title = editingTitle.value
      }
      isEditOpen.value = false
      await handleRefresh()
    } else {
      alert(res.message || '修改失败')
    }
  } catch (err: any) {
    alert(err?.data?.message || err?.message || '修改失败')
  } finally {
    isSavingEdit.value = false
  }
}

// Delete Modal
const isDeleteOpen = ref(false)
const isDeleting = ref(false)

const confirmDelete = (session: UnifiedSession) => {
  selectedSession.value = session
  isDeleteOpen.value = true
}

const executeDelete = async () => {
  if (!selectedSession.value) return
  isDeleting.value = true
  try {
    await $fetch(`/api/sessions/${selectedSession.value.id}?cli=${selectedSession.value.cli}`, {
      method: 'DELETE'
    })
    isDeleteOpen.value = false
    if (isDetailOpen.value) isDetailOpen.value = false
    handleRefresh()
  } catch (err: any) {
    alert(err?.data?.message || '删除失败')
  } finally {
    isDeleting.value = false
  }
}

// Resume command helper
const copyResumeCommand = (session: UnifiedSession) => {
  let cmd = ''
  if (session.cli === 'pi') {
    cmd = `cd "${session.cwd}" && pi --resume`
  } else if (session.cli === 'opencode') {
    cmd = `cd "${session.cwd}" && opencode session ${session.id}`
  } else if (session.cli === 'agy') {
    cmd = `agy resume --id ${session.id}`
  } else if (session.cli === 'claude') {
    cmd = `cd "${session.cwd}" && claude --resume`
  } else if (session.cli === 'codex') {
    cmd = `open -a "Codex" || cd "${session.cwd}" && codex thread ${session.id}`
  } else if (session.cli === 'workbuddy') {
    cmd = `open -a "WorkBuddy"`
  } else if (session.cli === 'reasonix') {
    cmd = `open -a "Reasonix"`
  }
  navigator.clipboard.writeText(cmd)
  alert(`已复制启动命令到剪贴板：\n${cmd}`)
}
</script>

<template>
  <div class="space-y-5">
    <!-- Top Stats Tabs -->
    <div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
      <!-- All -->
      <div 
        @click="currentTab = 'all'"
        :class="[
          'p-3 rounded-lg border transition-all cursor-pointer select-none',
          currentTab === 'all' 
            ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 border-transparent shadow-sm' 
            : 'bg-white dark:bg-zinc-900 border-zinc-200/90 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-700'
        ]"
      >
        <div class="flex items-center justify-between">
          <span class="text-xs font-medium opacity-80">全部汇总</span>
          <UIcon name="i-lucide-grid" class="w-3.5 h-3.5 opacity-60" />
        </div>
        <div class="text-xl font-bold mt-1 font-mono tracking-tight">{{ totalCount }}</div>
      </div>

      <!-- Each Source Tab -->
      <div 
        v-for="(meta, key) in sourceMeta"
        :key="key"
        @click="currentTab = key"
        :class="[
          'p-3 rounded-lg border transition-all cursor-pointer select-none',
          currentTab === key 
            ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 border-transparent shadow-sm' 
            : 'bg-white dark:bg-zinc-900 border-zinc-200/90 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-700'
        ]"
      >
        <div class="flex items-center justify-between">
          <span class="text-xs font-medium truncate flex items-center gap-1.5">
            <UIcon :name="meta.icon" class="w-3.5 h-3.5 shrink-0 opacity-70" />
            <span class="truncate">{{ meta.name }}</span>
          </span>
          <span :class="['text-[9px] uppercase font-mono px-1 py-0.2 rounded', currentTab === key ? 'bg-zinc-800 text-zinc-300 dark:bg-zinc-200 dark:text-zinc-800' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400']">
            {{ meta.type }}
          </span>
        </div>
        <div class="text-xl font-bold mt-1 font-mono tracking-tight">
          {{ (counts as any)[key] || 0 }}
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

    <!-- Sessions List -->
    <div v-if="pending" class="py-16 text-center text-zinc-400">
      <UIcon name="i-lucide-loader-2" class="w-6 h-6 animate-spin mx-auto mb-2 text-zinc-500" />
      <p class="text-xs">加载会话数据中...</p>
    </div>

    <div v-else-if="sessions.length === 0" class="py-16 text-center bg-white dark:bg-zinc-900 rounded-lg border border-dashed border-zinc-200 dark:border-zinc-800">
      <div class="w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mx-auto mb-2.5 text-zinc-400">
        <UIcon name="i-lucide-inbox" class="w-5 h-5" />
      </div>
      <h3 class="text-sm font-semibold text-zinc-700 dark:text-zinc-300">未检索到匹配的会话</h3>
      <p class="text-xs text-zinc-400 mt-0.5">请尝试更换上方平台分类或搜索关键字</p>
    </div>

    <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
      <div
        v-for="item in sessions"
        :key="`${item.cli}-${item.id}`"
        class="group bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800/90 hover:border-zinc-300 dark:hover:border-zinc-700 shadow-sm transition-all flex flex-col justify-between overflow-hidden"
      >
        <div class="p-4 flex-1 cursor-pointer" @click="openDetail(item)">
          <!-- Top Tag & Time -->
          <div class="flex items-center justify-between mb-2.5 gap-2">
            <span class="px-2 py-0.5 rounded text-[11px] font-medium font-mono border border-zinc-200 dark:border-zinc-700/80 bg-zinc-50 dark:bg-zinc-800/60 text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
              <UIcon :name="sourceMeta[item.cli]?.icon || 'i-lucide-terminal'" class="w-3 h-3 text-zinc-500 dark:text-zinc-400" />
              {{ sourceMeta[item.cli]?.name || item.cli }}
            </span>
            <span class="text-[11px] text-zinc-400 font-mono">
              {{ formatTime(item.updatedAt) }}
            </span>
          </div>

          <!-- Title -->
          <h3 class="font-medium text-zinc-900 dark:text-zinc-100 text-sm line-clamp-2 mb-2 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition-colors">
            {{ item.title }}
          </h3>

          <!-- Details & Path -->
          <div class="space-y-1 text-xs text-zinc-500 dark:text-zinc-400">
            <div class="flex items-center gap-1 truncate font-mono text-[11px]">
              <UIcon name="i-lucide-folder" class="w-3.5 h-3.5 shrink-0 text-zinc-400" />
              <span class="truncate" :title="item.cwd">{{ item.cwd || '默认工作区' }}</span>
            </div>
            
            <div class="flex items-center gap-3 text-zinc-400 dark:text-zinc-500 pt-1 text-[11px]">
              <span v-if="item.messageCount !== undefined" class="flex items-center gap-1">
                <UIcon name="i-lucide-message-square" class="w-3 h-3" />
                {{ item.messageCount }}
              </span>
              <span v-if="item.model" class="flex items-center gap-1 truncate max-w-[130px] font-mono">
                <UIcon name="i-lucide-cpu" class="w-3 h-3" />
                {{ item.model }}
              </span>
              <span v-if="item.cost !== undefined && item.cost > 0" class="font-mono">
                ${{ item.cost.toFixed(4) }}
              </span>
              <span v-if="item.status" class="px-1 py-0.2 rounded bg-zinc-100 dark:bg-zinc-800 text-[10px] uppercase font-mono">
                {{ item.status }}
              </span>
            </div>
          </div>
        </div>

        <!-- Footer Actions -->
        <div class="bg-zinc-50/70 dark:bg-zinc-900/70 border-t border-zinc-100 dark:border-zinc-800/80 px-3.5 py-1.5 flex items-center justify-between text-xs">
          <div class="flex items-center gap-1">
            <UButton
              size="xs"
              variant="ghost"
              color="neutral"
              icon="i-lucide-eye"
              @click="openDetail(item)"
            >
              查看
            </UButton>
            <UButton
              size="xs"
              variant="ghost"
              color="neutral"
              icon="i-lucide-play"
              @click="copyResumeCommand(item)"
              title="复制启动/恢复命令"
            >
              打开/继续
            </UButton>
          </div>

          <div class="flex items-center gap-0.5">
            <UButton
              size="xs"
              variant="ghost"
              color="neutral"
              icon="i-lucide-edit-3"
              @click="startEdit(item)"
              title="重命名 / 编辑"
            />
            <UButton
              size="xs"
              variant="ghost"
              color="error"
              icon="i-lucide-trash-2"
              @click="confirmDelete(item)"
              title="删除会话"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Edit Modal -->
    <UModal v-model:open="isEditOpen" :ui="{ content: 'max-w-md' }">
      <template #content>
        <div class="p-4 space-y-3.5">
          <h3 class="text-sm font-bold text-zinc-900 dark:text-white">编辑会话标题</h3>
          <UFormField label="会话标题">
            <UInput v-model="editingTitle" size="sm" class="w-full" placeholder="输入新的会话标题" />
          </UFormField>
          <div class="flex justify-end gap-2 pt-2">
            <UButton variant="ghost" color="neutral" size="sm" @click="isEditOpen = false">取消</UButton>
            <UButton color="neutral" size="sm" class="bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" :loading="isSavingEdit" @click="saveEdit">保存修改</UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- Delete Confirmation Modal -->
    <UModal v-model:open="isDeleteOpen" :ui="{ content: 'max-w-md' }">
      <template #content>
        <div class="p-4 space-y-3.5">
          <div class="flex items-center gap-2.5 text-red-600">
            <UIcon name="i-lucide-alert-triangle" class="w-5 h-5" />
            <h3 class="text-sm font-bold text-zinc-900 dark:text-white">确认删除会话？</h3>
          </div>
          <p class="text-xs text-zinc-500 dark:text-zinc-400">
            你正在删除来自 <span class="font-bold">{{ selectedSession?.cli.toUpperCase() }}</span> 的会话：
            <br />
            <span class="font-medium text-zinc-700 dark:text-zinc-200 mt-1 block font-mono text-xs">{{ selectedSession?.title }}</span>
          </p>
          <div class="flex justify-end gap-2 pt-2">
            <UButton variant="ghost" color="neutral" size="sm" @click="isDeleteOpen = false">取消</UButton>
            <UButton color="error" size="sm" :loading="isDeleting" @click="executeDelete">确认删除</UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
