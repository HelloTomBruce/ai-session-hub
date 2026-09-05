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
    badgeBg: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800',
    icon: 'i-lucide-terminal'
  },
  opencode: {
    name: 'OpenCode',
    type: 'CLI',
    badgeBg: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800',
    icon: 'i-lucide-code-2'
  },
  agy: {
    name: 'AGY CLI',
    type: 'CLI',
    badgeBg: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800',
    icon: 'i-lucide-sparkles'
  },
  claude: {
    name: 'Claude Code',
    type: 'CLI',
    badgeBg: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/50 dark:text-violet-300 dark:border-violet-800',
    icon: 'i-lucide-bot'
  },
  codex: {
    name: 'Codex App',
    type: 'APP',
    badgeBg: 'bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-950/50 dark:text-cyan-300 dark:border-cyan-800',
    icon: 'i-lucide-cpu'
  },
  workbuddy: {
    name: 'WorkBuddy',
    type: 'APP',
    badgeBg: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800',
    icon: 'i-lucide-briefcase'
  },
  reasonix: {
    name: 'Reasonix',
    type: 'APP',
    badgeBg: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200 dark:bg-fuchsia-950/50 dark:text-fuchsia-300 dark:border-fuchsia-800',
    icon: 'i-lucide-brain-circuit'
  }
}

// Modal States
const isDetailOpen = ref(false)
const selectedSession = ref<UnifiedSession | null>(null)
const sessionDetail = ref<any>(null)
const isLoadingDetail = ref(false)

const openDetail = async (session: UnifiedSession) => {
  selectedSession.value = session
  isDetailOpen.value = true
  isLoadingDetail.value = true
  try {
    const res = await $fetch<{ success: boolean, data: any }>(`/api/sessions/${session.id}?cli=${session.cli}`)
    sessionDetail.value = res.data
  } catch (e) {
    console.error(e)
  } finally {
    isLoadingDetail.value = false
  }
}

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
    await $fetch(`/api/sessions/${selectedSession.value.id}?cli=${selectedSession.value.cli}`, {
      method: 'PUT',
      body: { title: editingTitle.value }
    })
    isEditOpen.value = false
    handleRefresh()
  } catch (err: any) {
    alert(err?.data?.message || '修改失败')
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

// Create New Session Modal
const isCreateOpen = ref(false)
const newForm = ref({
  cli: 'pi' as keyof typeof sourceMeta,
  title: '',
  cwd: '/Users/zhangbei/code',
  initialPrompt: ''
})
const isCreating = ref(false)

const openCreateModal = () => {
  newForm.value = {
    cli: currentTab.value !== 'all' ? (currentTab.value as any) : 'pi',
    title: '',
    cwd: '/Users/zhangbei/code',
    initialPrompt: ''
  }
  isCreateOpen.value = true
}

const handleCreate = async () => {
  if (!newForm.value.cwd) {
    alert('工作目录必填')
    return
  }
  isCreating.value = true
  try {
    await $fetch('/api/sessions', {
      method: 'POST',
      body: newForm.value
    })
    isCreateOpen.value = false
    handleRefresh()
  } catch (err: any) {
    alert(err?.data?.message || '创建会话失败')
  } finally {
    isCreating.value = false
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
  <div class="space-y-6">
    <!-- Top Stats / Tabs Cards -->
    <div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
      <!-- All -->
      <div 
        @click="currentTab = 'all'"
        :class="[
          'p-3 rounded-xl border transition-all cursor-pointer select-none',
          currentTab === 'all' 
            ? 'bg-white dark:bg-neutral-900 border-primary shadow-sm ring-2 ring-primary/20' 
            : 'bg-white/60 dark:bg-neutral-900/60 border-slate-200 dark:border-neutral-800 hover:border-slate-300'
        ]"
      >
        <div class="flex items-center justify-between">
          <span class="text-xs font-medium text-slate-500 dark:text-neutral-400">全部汇总</span>
          <UIcon name="i-lucide-grid" class="w-3.5 h-3.5 text-slate-400" />
        </div>
        <div class="text-xl font-bold mt-1 text-slate-900 dark:text-white">{{ totalCount }}</div>
      </div>

      <!-- Each Source Tab -->
      <div 
        v-for="(meta, key) in sourceMeta"
        :key="key"
        @click="currentTab = key"
        :class="[
          'p-3 rounded-xl border transition-all cursor-pointer select-none',
          currentTab === key 
            ? 'bg-white dark:bg-neutral-900 border-primary shadow-sm ring-2 ring-primary/20' 
            : 'bg-white/60 dark:bg-neutral-900/60 border-slate-200 dark:border-neutral-800 hover:border-slate-300'
        ]"
      >
        <div class="flex items-center justify-between">
          <span class="text-xs font-medium truncate flex items-center gap-1">
            <UIcon :name="meta.icon" class="w-3.5 h-3.5 shrink-0" />
            <span class="truncate">{{ meta.name }}</span>
          </span>
          <span class="text-[10px] uppercase font-mono px-1 py-0.2 rounded bg-slate-100 dark:bg-neutral-800 text-slate-400">
            {{ meta.type }}
          </span>
        </div>
        <div class="text-xl font-bold mt-1 text-slate-900 dark:text-white">
          {{ (counts as any)[key] || 0 }}
        </div>
      </div>
    </div>

    <!-- Actions & Filter Bar -->
    <div class="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white dark:bg-neutral-900 p-3 rounded-xl border border-slate-200 dark:border-neutral-800 shadow-sm">
      <div class="flex items-center gap-2 w-full sm:w-auto flex-1 max-w-md">
        <UInput
          v-model="searchQuery"
          icon="i-lucide-search"
          placeholder="搜索会话标题、路径、ID或模型..."
          class="w-full"
        />
      </div>

      <div class="flex items-center gap-2 w-full sm:w-auto justify-end">
        <UButton
          icon="i-lucide-rotate-cw"
          color="neutral"
          variant="outline"
          :loading="isRefreshing"
          @click="handleRefresh"
        >
          刷新
        </UButton>

        <UButton
          icon="i-lucide-plus"
          color="primary"
          @click="openCreateModal"
        >
          新建会话
        </UButton>
      </div>
    </div>

    <!-- Sessions List -->
    <div v-if="pending" class="py-16 text-center text-slate-400">
      <UIcon name="i-lucide-loader-2" class="w-8 h-8 animate-spin mx-auto mb-2 text-primary" />
      <p class="text-sm">正在加载会话数据...</p>
    </div>

    <div v-else-if="sessions.length === 0" class="py-20 text-center bg-white dark:bg-neutral-900 rounded-2xl border border-dashed border-slate-200 dark:border-neutral-800">
      <div class="w-12 h-12 rounded-full bg-slate-100 dark:bg-neutral-800 flex items-center justify-center mx-auto mb-3 text-slate-400">
        <UIcon name="i-lucide-inbox" class="w-6 h-6" />
      </div>
      <h3 class="text-base font-semibold text-slate-800 dark:text-neutral-200">没有找到匹配的会话</h3>
      <p class="text-sm text-slate-400 mt-1">尝试更换平台筛选或搜索关键词</p>
    </div>

    <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <div
        v-for="item in sessions"
        :key="`${item.cli}-${item.id}`"
        class="group bg-white dark:bg-neutral-900 rounded-xl border border-slate-200/90 dark:border-neutral-800/90 hover:border-slate-300 dark:hover:border-neutral-700 shadow-sm hover:shadow transition-all flex flex-col justify-between overflow-hidden"
      >
        <div class="p-5 flex-1 cursor-pointer" @click="openDetail(item)">
          <!-- Top Tag & Time -->
          <div class="flex items-center justify-between mb-3 gap-2">
            <span :class="['px-2 py-0.5 rounded-md text-xs font-semibold border flex items-center gap-1', sourceMeta[item.cli]?.badgeBg || 'bg-slate-100']">
              <UIcon :name="sourceMeta[item.cli]?.icon || 'i-lucide-terminal'" class="w-3.5 h-3.5" />
              {{ sourceMeta[item.cli]?.name || item.cli }}
            </span>
            <span class="text-xs text-slate-400 dark:text-neutral-500 font-mono">
              {{ formatTime(item.updatedAt) }}
            </span>
          </div>

          <!-- Title -->
          <h3 class="font-semibold text-slate-900 dark:text-white text-base line-clamp-2 mb-2 group-hover:text-primary transition-colors">
            {{ item.title }}
          </h3>

          <!-- Details & Path -->
          <div class="space-y-1.5 text-xs text-slate-500 dark:text-neutral-400">
            <div class="flex items-center gap-1 truncate font-mono">
              <UIcon name="i-lucide-folder" class="w-3.5 h-3.5 shrink-0 text-slate-400" />
              <span class="truncate" :title="item.cwd">{{ item.cwd || '默认工作区' }}</span>
            </div>
            
            <div class="flex items-center gap-3 text-slate-400 dark:text-neutral-500 pt-1">
              <span v-if="item.messageCount !== undefined" class="flex items-center gap-1">
                <UIcon name="i-lucide-message-square" class="w-3.5 h-3.5" />
                {{ item.messageCount }} 消息
              </span>
              <span v-if="item.model" class="flex items-center gap-1 truncate max-w-[140px]">
                <UIcon name="i-lucide-cpu" class="w-3.5 h-3.5" />
                {{ item.model }}
              </span>
              <span v-if="item.cost !== undefined && item.cost > 0" class="flex items-center gap-1 font-mono">
                ${{ item.cost.toFixed(4) }}
              </span>
              <span v-if="item.status" class="px-1.5 py-0.2 rounded bg-slate-100 dark:bg-neutral-800 text-[10px]">
                {{ item.status }}
              </span>
            </div>
          </div>
        </div>

        <!-- Footer Actions -->
        <div class="bg-slate-50/70 dark:bg-neutral-900/70 border-t border-slate-100 dark:border-neutral-800/80 px-4 py-2 flex items-center justify-between text-xs">
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

          <div class="flex items-center gap-1">
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

    <!-- Detail Drawer / Modal -->
    <UModal v-model:open="isDetailOpen" :ui="{ content: 'max-w-4xl max-h-[85vh]' }">
      <template #content>
        <div v-if="selectedSession" class="flex flex-col h-[80vh]">
          <!-- Header -->
          <div class="p-5 border-b border-slate-200 dark:border-neutral-800 flex items-start justify-between gap-4">
            <div class="space-y-1">
              <div class="flex items-center gap-2">
                <span :class="['px-2 py-0.5 rounded-md text-xs font-semibold border flex items-center gap-1', sourceMeta[selectedSession.cli]?.badgeBg]">
                  <UIcon :name="sourceMeta[selectedSession.cli]?.icon" class="w-3.5 h-3.5" />
                  {{ sourceMeta[selectedSession.cli]?.name }}
                </span>
                <span class="text-xs text-slate-400 font-mono">ID: {{ selectedSession.id }}</span>
              </div>
              <h2 class="text-lg font-bold text-slate-900 dark:text-white">{{ selectedSession.title }}</h2>
              <p class="text-xs text-slate-400 font-mono flex items-center gap-1">
                <UIcon name="i-lucide-folder" class="w-3.5 h-3.5" />
                {{ selectedSession.cwd }}
              </p>
            </div>

            <div class="flex items-center gap-2">
              <UButton
                size="sm"
                color="primary"
                icon="i-lucide-play"
                @click="copyResumeCommand(selectedSession)"
              >
                复制启动命令
              </UButton>
              <UButton
                size="sm"
                variant="ghost"
                color="neutral"
                icon="i-lucide-x"
                @click="isDetailOpen = false"
              />
            </div>
          </div>

          <!-- Messages Body -->
          <div class="flex-1 overflow-y-auto p-5 space-y-4">
            <div v-if="isLoadingDetail" class="py-12 text-center text-slate-400">
              <UIcon name="i-lucide-loader-2" class="w-6 h-6 animate-spin mx-auto mb-2 text-primary" />
              <p class="text-xs">加载会话消息中...</p>
            </div>

            <div v-else-if="!sessionDetail?.messages?.length" class="py-12 text-center text-slate-400">
              <p class="text-sm">该会话暂无文本消息记录或记录为空</p>
            </div>

            <div
              v-for="(msg, idx) in sessionDetail?.messages || []"
              :key="idx"
              :class="[
                'p-4 rounded-xl text-sm space-y-2 border',
                msg.role === 'user'
                  ? 'bg-primary-50/50 dark:bg-primary-950/20 border-primary-200/50 dark:border-primary-800/30'
                  : 'bg-white dark:bg-neutral-900 border-slate-200 dark:border-neutral-800'
              ]"
            >
              <div class="flex items-center justify-between text-xs text-slate-400">
                <span class="font-bold flex items-center gap-1.5">
                  <UIcon :name="msg.role === 'user' ? 'i-lucide-user' : 'i-lucide-bot'" class="w-4 h-4" />
                  {{ msg.role === 'user' ? 'User' : 'Assistant' }}
                  <span v-if="msg.model" class="font-normal font-mono text-slate-400">({{ msg.model }})</span>
                </span>
                <span v-if="msg.timestamp" class="font-mono">{{ formatTime(msg.timestamp) }}</span>
              </div>

              <!-- Thought block -->
              <div v-if="msg.thought" class="p-3 bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40 rounded-lg text-xs text-amber-800 dark:text-amber-300/90 whitespace-pre-wrap font-sans">
                <div class="font-semibold mb-1 flex items-center gap-1">
                  <UIcon name="i-lucide-lightbulb" class="w-3.5 h-3.5" /> 思考过程
                </div>
                {{ msg.thought }}
              </div>

              <!-- Content text -->
              <div class="whitespace-pre-wrap leading-relaxed text-slate-800 dark:text-neutral-200 font-sans break-words">
                {{ msg.content }}
              </div>

              <!-- Tool Calls -->
              <div v-if="msg.toolCalls?.length" class="pt-2">
                <div class="text-xs font-semibold text-slate-400 mb-1 flex items-center gap-1">
                  <UIcon name="i-lucide-wrench" class="w-3.5 h-3.5" /> 工具调用 ({{ msg.toolCalls.length }})
                </div>
                <div class="space-y-1">
                  <div
                    v-for="(tool, tIdx) in msg.toolCalls"
                    :key="tIdx"
                    class="bg-slate-100 dark:bg-neutral-800 px-2.5 py-1.5 rounded text-xs font-mono text-slate-600 dark:text-neutral-300 truncate"
                  >
                    {{ tool.name || tool.type || 'Tool' }}: {{ JSON.stringify(tool.arguments || tool.args || tool.input || '') }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </UModal>

    <!-- Edit Modal -->
    <UModal v-model:open="isEditOpen" :ui="{ content: 'max-w-md' }">
      <template #content>
        <div class="p-5 space-y-4">
          <h3 class="text-base font-bold text-slate-900 dark:text-white">编辑会话标题</h3>
          <UFormField label="会话标题">
            <UInput v-model="editingTitle" class="w-full" placeholder="输入新的会话标题" />
          </UFormField>
          <div class="flex justify-end gap-2 pt-2">
            <UButton variant="ghost" color="neutral" @click="isEditOpen = false">取消</UButton>
            <UButton color="primary" :loading="isSavingEdit" @click="saveEdit">保存修改</UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- Delete Confirmation Modal -->
    <UModal v-model:open="isDeleteOpen" :ui="{ content: 'max-w-md' }">
      <template #content>
        <div class="p-5 space-y-4">
          <div class="flex items-center gap-3 text-red-500">
            <UIcon name="i-lucide-alert-triangle" class="w-6 h-6" />
            <h3 class="text-base font-bold text-slate-900 dark:text-white">确认删除会话？</h3>
          </div>
          <p class="text-sm text-slate-500 dark:text-neutral-400">
            你正在删除来自 <span class="font-bold">{{ selectedSession?.cli.toUpperCase() }}</span> 的会话：
            <br />
            <span class="font-medium text-slate-700 dark:text-neutral-200 mt-1 block font-mono text-xs">{{ selectedSession?.title }}</span>
          </p>
          <div class="flex justify-end gap-2 pt-2">
            <UButton variant="ghost" color="neutral" @click="isDeleteOpen = false">取消</UButton>
            <UButton color="error" :loading="isDeleting" @click="executeDelete">确认删除</UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- Create Modal -->
    <UModal v-model:open="isCreateOpen" :ui="{ content: 'max-w-lg' }">
      <template #content>
        <div class="p-6 space-y-4">
          <h3 class="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <UIcon name="i-lucide-plus-circle" class="w-5 h-5 text-primary" />
            新建会话
          </h3>

          <div class="space-y-4">
            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-neutral-300 mb-1.5">选择目标平台 / CLI / APP</label>
              <div class="grid grid-cols-4 sm:grid-cols-4 gap-2">
                <div
                  v-for="(meta, key) in sourceMeta"
                  :key="key"
                  @click="newForm.cli = key"
                  :class="[
                    'p-2 rounded-lg border text-center cursor-pointer select-none text-xs font-medium transition-all',
                    newForm.cli === key
                      ? 'border-primary bg-primary-50 dark:bg-primary-950/30 text-primary font-bold'
                      : 'border-slate-200 dark:border-neutral-800 hover:border-slate-300'
                  ]"
                >
                  <UIcon :name="meta.icon" class="w-4 h-4 mx-auto mb-1" />
                  {{ meta.name }}
                </div>
              </div>
            </div>

            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-neutral-300 mb-1.5">会话标题 / 备注</label>
              <UInput v-model="newForm.title" placeholder="如：重构登录模块、调试 API 等" class="w-full" />
            </div>

            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-neutral-300 mb-1.5">工作目录 (CWD)</label>
              <UInput v-model="newForm.cwd" placeholder="/Users/zhangbei/code" class="w-full font-mono text-xs" />
            </div>

            <div>
              <label class="block text-xs font-semibold text-slate-600 dark:text-neutral-300 mb-1.5">初始 Prompt（可选）</label>
              <UTextarea v-model="newForm.initialPrompt" placeholder="给该会话初始化的需求或首条消息..." class="w-full" :rows="3" />
            </div>
          </div>

          <div class="flex justify-end gap-2 pt-4 border-t border-slate-100 dark:border-neutral-800">
            <UButton variant="ghost" color="neutral" @click="isCreateOpen = false">取消</UButton>
            <UButton color="primary" :loading="isCreating" @click="handleCreate">立即创建</UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
