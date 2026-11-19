<script setup lang="ts">
import type { SessionMessage, UnifiedSession } from '../../../server/utils/types'

interface SessionDetailData {
  session: UnifiedSession
  messages: SessionMessage[]
}

const route = useRoute()

const sessionId = computed(() => route.params.id as string)
const platform = computed(() => (route.query.cli as string) || '')

const detailMode = ref<'chat' | 'thinking'>('chat')
const isRefreshing = ref(false)

const { getPluginMeta } = usePlugins()

// lazy 加载：导航立即完成，页面壳与 loading 先渲染，数据到达后再填充，
// 避免大数据量会话阻塞路由切换（配合 /sessions/** 的 ssr:false）
const { data: sessionRes, pending, refresh } = useFetch<{ success: boolean, data: SessionDetailData }>(
  () => `/api/sessions/${sessionId.value}?cli=${platform.value}`,
  { lazy: true }
)

const session = computed(() => sessionRes.value?.data?.session)
const messages = computed(() => sessionRes.value?.data?.messages || [])

const toast = useToast()

// 工具/技能分析（统计、技能识别、调用明细弹窗）
// 整个返回对象要透传给 SessionToolDetailModal（弹窗内共用同一份调用明细状态）
const toolAnalytics = useToolAnalytics(messages)

// 沉淀/提炼弹窗状态（仅新建入口与跟踪，操作走 MCP）
const isHarvestModalOpen = ref(false)
const isExtractMemoryModalOpen = ref(false)

// 效能诊断（磁盘缓存报告 + SSE 流式诊断 + 规则引擎兜底）
// 诊断状态整体透传给 SessionEfficiencyModal，页面只消费评分徽章与维度拆解
const diagnosis = useSessionDiagnosis(sessionId, platform, messages)

// 思维链时间线
const thinkingTimeline = useThinkingTimeline(messages)
const thoughtCount = computed(() => thinkingTimeline.value.filter(t => t.type === 'thought').length)

// —— 大数据量渲染优化：分块挂载（useChunkedList）+ 长文本折叠（useLongTextCollapse）——
// 全量一次渲染 2000+ 条消息会冻结主线程，改为每批 RENDER_CHUNK 条，
// 视口内的哨兵元素触发继续补齐，长文本超限折叠、点击手动展开。
const RENDER_CHUNK = 150
const CONTENT_LIMIT = 6000
const THOUGHT_LIMIT = 3000
const TIMELINE_LIMIT = 3000
const TOOL_ARGS_LIMIT = 400

const chat = useChunkedList(messages, { chunk: RENDER_CHUNK, rootMargin: 800 })
const timeline = useChunkedList(thinkingTimeline, { chunk: RENDER_CHUNK, rootMargin: 800 })

// 保留原始下标 idx（消息 DOM id / 高亮 key 依赖全量数组的下标）
const visibleMessages = computed(() => chat.indexedItems.value.map(({ item, idx }) => ({ msg: item, idx })))
const visibleTimeline = computed(() => timeline.indexedItems.value.map(({ item, idx }) => ({ step: item, idx })))
const chatRemaining = chat.remaining
const timelineRemaining = timeline.remaining
const chatSentinelRef = chat.sentinelRef
const timelineSentinelRef = timeline.sentinelRef
const visibleChatCount = chat.visibleCount
const visibleTimelineCount = timeline.visibleCount
const loadAllChat = chat.loadAll
const loadAllTimeline = timeline.loadAll

/** 把目标下标纳入渲染窗口（分块渲染下跳转前必须先扩窗） */
const ensureChatRendered = (idx: number) => {
  if (idx >= chat.visibleCount.value) {
    chat.visibleCount.value = Math.min(idx + 60, messages.value.length)
  }
}
const ensureTimelineRendered = (idx: number) => {
  if (idx >= timeline.visibleCount.value) {
    timeline.visibleCount.value = Math.min(idx + 60, thinkingTimeline.value.length)
  }
}

const collapse = useLongTextCollapse()
const { expandedKeys, toggleExpand, overLimit, displayText } = collapse

const targetMsgId = computed(() => {
  const q = (route.query.msgId as string) || ''
  if (!q) return ''
  // If composite key was passed (${cli}_${sessionId}_${rawMsgId}), strip prefix for backwards compatibility
  const prefix = `${platform.value}_${sessionId.value}_`
  if (q.startsWith(prefix)) {
    return q.slice(prefix.length)
  }
  return q
})
// —— 会话轮次导航（实现见 app/composables/useSessionTurns.ts）——
// 轮次 = 一条非空「真实用户输入」消息及其后续回复；记录消息下标与思维时间线
// intent 步下标，支持对话视图 / 时间线视图双模式跳转。
const {
  turns,
  activeTurnIdx,
  turnStripRef,
  activeHighlightedMsgId,
  jumpToTurn
} = useSessionTurns({
  messages,
  timeline: thinkingTimeline,
  detailMode,
  targetMsgId,
  ensureChatRendered,
  ensureTimelineRendered
})

const handleRefresh = async () => {
  isRefreshing.value = true
  await refresh()
  isRefreshing.value = false
}

// Edit Title Modal
const isEditOpen = ref(false)
const editingTitle = ref('')
const isSavingEdit = ref(false)

const openEditModal = () => {
  if (session.value) {
    editingTitle.value = session.value.title || ''
    isEditOpen.value = true
  }
}

const saveEditTitle = async () => {
  if (!session.value || !sessionId.value || !platform.value) return
  isSavingEdit.value = true
  try {
    const res = await $fetch<{ success: boolean, message?: string }>(`/api/sessions/${sessionId.value}?cli=${platform.value}`, {
      method: 'PUT',
      body: { title: editingTitle.value }
    })
    if (res.success) {
      if (session.value) {
        session.value.title = editingTitle.value
      }
      isEditOpen.value = false
      await refresh()
    } else {
      toast.add({ title: res.message || '修改失败', color: 'error', icon: 'i-lucide-alert-triangle' })
    }
  } catch (err) {
    const fetchErr = err as { data?: { message?: string }, message?: string } | null | undefined
    toast.add({ title: fetchErr?.data?.message || fetchErr?.message || '修改失败', color: 'error', icon: 'i-lucide-alert-triangle' })
  } finally {
    isSavingEdit.value = false
  }
}

const formatTime = (ts?: number) => {
  if (!ts) return '-'
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const backUrl = computed(() => {
  return platform.value ? `/?cli=${platform.value}` : '/'
})
</script>

<template>
  <div class="space-y-5 pb-12">
    <!-- 详情页头部（实现见 app/components/session/SessionHeaderBanner.vue） -->
    <SessionHeaderBanner
      :session="session"
      :session-id="sessionId"
      :platform="platform"
      :back-url="backUrl"
      :diag="diagnosis"
      :tool="toolAnalytics"
      :get-plugin-meta="getPluginMeta"
      :format-time="formatTime"
      :is-refreshing="isRefreshing"
      :on-refresh="handleRefresh"
      :on-extract-memory="() => (isExtractMemoryModalOpen = true)"
      :on-harvest="() => (isHarvestModalOpen = true)"
      :on-edit-title="openEditModal"
    />

    <!-- Main Content Container -->
    <!-- overflow-clip 而非 hidden：hidden 会创建滚动容器导致内部 sticky 失效 -->
    <div class="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-clip flex flex-col min-h-[600px]">
      <!-- View Mode Header Switcher -->
      <div class="px-5 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-zinc-50/50 dark:bg-zinc-900/50">
        <div class="flex items-center gap-1.5 bg-zinc-200/70 dark:bg-zinc-800 p-1 rounded-lg">
          <button
            :class="[
              'px-3 py-1.5 rounded-md font-medium transition-all text-xs flex items-center gap-1.5',
              detailMode === 'chat'
                ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'
            ]"
            @click="detailMode = 'chat'"
          >
            <UIcon
              name="i-lucide-messages-square"
              class="w-4 h-4"
            />
            完整对话交互 ({{ messages.length }})
          </button>
          <button
            :class="[
              'px-3 py-1.5 rounded-md font-medium transition-all text-xs flex items-center gap-1.5',
              detailMode === 'thinking'
                ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'
            ]"
            @click="detailMode = 'thinking'"
          >
            <UIcon
              name="i-lucide-brain"
              class="w-4 h-4 text-amber-500"
            />
            思维决策路径时间轴 ({{ thoughtCount }} 决策点)
          </button>
        </div>

        <span class="text-xs text-zinc-400 font-mono">
          模式: {{ detailMode === 'chat' ? 'Full Transcript' : 'Thinking Timeline' }}
        </span>
      </div>

      <!-- 会话轮次快捷导航：吸顶展示，点击跳转该轮用户消息，滚动时自动跟随高亮 -->
      <div
        v-if="turns.length"
        class="sticky top-14 z-30 px-5 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-center gap-2.5"
      >
        <span class="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 flex items-center gap-1 shrink-0">
          <UIcon
            name="i-lucide-list-ordered"
            class="w-3.5 h-3.5"
          />
          对话轮次 ({{ turns.length }})
        </span>
        <div
          ref="turnStripRef"
          class="flex items-center gap-1.5 overflow-x-auto py-0.5 min-w-0"
        >
          <button
            v-for="(t, ti) in turns"
            :id="'turn-chip-' + ti"
            :key="t.msgId + '-' + ti"
            :class="[
              'px-2 py-1 rounded-md border text-[11px] whitespace-nowrap shrink-0 cursor-pointer transition-all flex items-center gap-1.5 max-w-[280px]',
              activeTurnIdx === ti
                ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 border-transparent shadow-xs'
                : 'bg-zinc-50 dark:bg-zinc-800/60 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700/60 hover:bg-zinc-100 dark:hover:bg-zinc-700'
            ]"
            :title="t.full"
            @click="jumpToTurn(ti)"
          >
            <span class="font-mono font-bold shrink-0">#{{ ti + 1 }}</span>
            <span class="truncate font-sans max-w-[220px]">{{ t.preview }}</span>
          </button>
          <button
            class="px-2 py-1 rounded-md border border-zinc-200 dark:border-zinc-700/60 bg-zinc-50 dark:bg-zinc-800/60 text-[11px] font-mono text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 shrink-0 cursor-pointer transition-all flex items-center gap-1"
            title="跳转到最后一轮"
            @click="jumpToTurn(turns.length - 1)"
          >
            <UIcon
              name="i-lucide-corner-right-down"
              class="w-3 h-3"
            />
            最新
          </button>
        </div>
      </div>

      <!-- Loading State -->
      <div
        v-if="pending"
        class="py-24 text-center text-zinc-400"
      >
        <UIcon
          name="i-lucide-loader-2"
          class="w-8 h-8 animate-spin mx-auto mb-2.5 text-zinc-500"
        />
        <p class="text-sm">
          正在加载会话详情与思考路径...
        </p>
      </div>

      <!-- Empty State -->
      <div
        v-else-if="!messages.length"
        class="py-24 text-center text-zinc-400"
      >
        <UIcon
          name="i-lucide-message-square-off"
          class="w-8 h-8 mx-auto mb-2 opacity-40"
        />
        <p class="text-sm">
          该会话暂无文本交互记录
        </p>
      </div>

      <!-- View 1: Full Chat Stream -->
      <div
        v-else-if="detailMode === 'chat'"
        class="p-6 space-y-4 bg-zinc-50/30 dark:bg-zinc-950/30"
      >
        <SessionChatMessage
          v-for="{ msg, idx } in visibleMessages"
          :key="msg.id || idx"
          :msg="msg"
          :idx="idx"
          :msg-id="msg.id || String(idx)"
          :highlighted="activeHighlightedMsgId === (msg.id || String(idx))"
          :collapse="collapse"
          :content-limit="CONTENT_LIMIT"
          :thought-limit="THOUGHT_LIMIT"
          :tool-args-limit="TOOL_ARGS_LIMIT"
          :format-time="formatTime"
        />

        <!-- 分块加载哨兵：滚入视口自动追加下一批消息 -->
        <div
          v-if="chatRemaining > 0"
          ref="chatSentinelRef"
          class="py-5 text-center text-xs text-zinc-400 flex items-center justify-center gap-2 flex-wrap"
        >
          <UIcon
            name="i-lucide-loader-2"
            class="w-3.5 h-3.5 animate-spin"
          />
          <span class="font-mono">已显示 {{ visibleChatCount }} / {{ messages.length }} 条，继续滚动自动加载</span>
          <button
            class="px-2 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-[11px] font-mono cursor-pointer transition-colors"
            @click="loadAllChat"
          >
            一次全部加载
          </button>
        </div>
      </div>

      <!-- View 2: Thinking Timeline -->
      <div
        v-else
        class="p-8 space-y-6 bg-zinc-50/60 dark:bg-zinc-950/60"
      >
        <div class="relative border-l-2 border-zinc-200 dark:border-zinc-800 ml-4 space-y-8">
          <div
            v-for="{ step, idx: sIdx } in visibleTimeline"
            :id="'tl-step-' + sIdx"
            :key="sIdx"
            class="relative pl-7 group"
          >
            <!-- Dot Icon -->
            <div
              :class="[
                'absolute -left-[10px] top-1 w-5 h-5 rounded-full flex items-center justify-center border-2 bg-white dark:bg-zinc-900 shadow-xs',
                step.type === 'intent' ? 'border-blue-500 text-blue-500'
                : step.type === 'thought' ? 'border-amber-500 text-amber-500'
                  : step.type === 'tool' ? 'border-purple-500 text-purple-500'
                    : 'border-emerald-500 text-emerald-500'
              ]"
            >
              <div
                :class="[
                  'w-2 h-2 rounded-full',
                  step.type === 'intent' ? 'bg-blue-500'
                  : step.type === 'thought' ? 'bg-amber-500'
                    : step.type === 'tool' ? 'bg-purple-500'
                      : 'bg-emerald-500'
                ]"
              />
            </div>

            <!-- Card Content -->
            <div
              :class="[
                'p-4 rounded-xl border text-xs shadow-xs space-y-2 transition-all',
                step.type === 'thought' ? 'bg-amber-500/5 dark:bg-amber-500/10 border-amber-500/30'
                : step.type === 'tool' ? 'bg-purple-500/5 dark:bg-purple-500/10 border-purple-500/30'
                  : step.type === 'intent' ? 'bg-blue-500/5 dark:bg-blue-500/10 border-blue-500/30'
                    : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800'
              ]"
            >
              <div class="flex items-center justify-between pb-1 border-b border-zinc-200/50 dark:border-zinc-800/50">
                <span class="font-semibold text-xs text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                  <UIcon
                    :name="
                      step.type === 'intent' ? 'i-lucide-user'
                      : step.type === 'thought' ? 'i-lucide-lightbulb'
                        : step.type === 'tool' ? 'i-lucide-wrench'
                          : 'i-lucide-check-circle'
                    "
                    class="w-4 h-4"
                  />
                  {{ step.title }}
                </span>
                <span
                  v-if="step.timestamp"
                  class="text-[11px] text-zinc-400 font-mono"
                >
                  {{ formatTime(step.timestamp) }}
                </span>
              </div>

              <div
                v-if="step.detail"
                class="text-xs leading-relaxed whitespace-pre-wrap text-zinc-700 dark:text-zinc-300 font-sans break-words"
              >
                {{ displayText(step.detail, 'tl:' + sIdx, TIMELINE_LIMIT) }}
              </div>
              <button
                v-if="overLimit(step.detail, TIMELINE_LIMIT)"
                class="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-[10px] font-mono text-zinc-500 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700 cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors w-fit"
                @click="toggleExpand('tl:' + sIdx)"
              >
                {{ expandedKeys.has('tl:' + sIdx) ? '▲ 收起' : `▼ 展开全部（共 ${(step.detail || '').length} 字符）` }}
              </button>
            </div>
          </div>

          <!-- 分块加载哨兵 -->
          <div
            v-if="timelineRemaining > 0"
            ref="timelineSentinelRef"
            class="py-5 text-center text-xs text-zinc-400 flex items-center justify-center gap-2 flex-wrap"
          >
            <UIcon
              name="i-lucide-loader-2"
              class="w-3.5 h-3.5 animate-spin"
            />
            <span class="font-mono">已显示 {{ visibleTimelineCount }} / {{ thinkingTimeline.length }} 步，继续滚动自动加载</span>
            <button
              class="px-2 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-[11px] font-mono cursor-pointer transition-colors"
              @click="loadAllTimeline"
            >
              一次全部加载
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 工具调用明细弹窗（实现见 app/components/session/SessionToolDetailModal.vue） -->
    <SessionToolDetailModal
      :tool="toolAnalytics"
      :format-time="formatTime"
    />

    <!-- 会话效能诊断弹窗（实现见 app/components/session/SessionEfficiencyModal.vue） -->
    <SessionEfficiencyModal :diag="diagnosis" />

    <!-- Edit Title Modal -->
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
              @click="saveEditTitle"
            >
              保存修改
            </UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- Harvest & Value Evaluation Modal -->
    <HarvestModal
      v-model:open="isHarvestModalOpen"
      :session-id="sessionId"
      :platform="platform"
      :session-title="session?.title"
    />

    <!-- Grafeo Memory Extraction Modal -->
    <ExtractMemoryModal
      v-model:open="isExtractMemoryModalOpen"
      :session="session"
      :messages="messages"
    />
  </div>
</template>
