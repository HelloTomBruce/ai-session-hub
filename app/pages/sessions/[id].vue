<script setup lang="ts">
import type { Ref } from 'vue'
import type { SessionMessage, SessionToolCall, UnifiedSession } from '../../../server/utils/types'

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
const {
  isToolModalOpen,
  selectedToolName,
  selectedToolCalls,
  openToolDetails,
  toolStats
} = useToolAnalytics(messages)

// 沉淀/提炼弹窗状态（仅新建入口与跟踪，操作走 MCP）
const isHarvestModalOpen = ref(false)
const isExtractMemoryModalOpen = ref(false)

// 效能诊断（磁盘缓存报告 + SSE 流式诊断 + 规则引擎兜底）
const {
  isEfficiencyModalOpen,
  isDiagnosing,
  aiDiagnosisResult,
  diagnoseStatus,
  diagnoseStreamText,
  runAIDiagnosis,
  efficiencyAnalysis
} = useSessionDiagnosis(sessionId, platform, messages)

// 思维链时间线
const thinkingTimeline = useThinkingTimeline(messages)
const thoughtCount = computed(() => thinkingTimeline.value.filter(t => t.type === 'thought').length)

// —— 大数据量渲染优化：分块挂载 + 触底自动加载 + 长文本折叠 ——
// 全量一次渲染 2000+ 条消息会冻结主线程，改为每批 RENDER_CHUNK 条，
// 视口内的哨兵元素触发继续补齐，长文本超限折叠、点击手动展开。
const RENDER_CHUNK = 150
const CONTENT_LIMIT = 6000
const THOUGHT_LIMIT = 3000
const TIMELINE_LIMIT = 3000
const TOOL_ARGS_LIMIT = 400

const visibleChatCount = ref(RENDER_CHUNK)
const visibleTimelineCount = ref(RENDER_CHUNK)

// 保留原始下标 idx（消息 DOM id / 高亮 key 依赖全量数组的下标）
const visibleMessages = computed(() =>
  messages.value.slice(0, visibleChatCount.value).map((msg, idx) => ({ msg, idx }))
)
const visibleTimeline = computed(() =>
  thinkingTimeline.value.slice(0, visibleTimelineCount.value).map((step, idx) => ({ step, idx }))
)
const chatRemaining = computed(() => messages.value.length - visibleChatCount.value)
const timelineRemaining = computed(() => thinkingTimeline.value.length - visibleTimelineCount.value)

const loadMoreChat = () => {
  if (chatRemaining.value > 0) {
    visibleChatCount.value = Math.min(visibleChatCount.value + RENDER_CHUNK, messages.value.length)
  }
}
const loadMoreTimeline = () => {
  if (timelineRemaining.value > 0) {
    visibleTimelineCount.value = Math.min(visibleTimelineCount.value + RENDER_CHUNK, thinkingTimeline.value.length)
  }
}
const loadAllChat = () => {
  visibleChatCount.value = messages.value.length
}
const loadAllTimeline = () => {
  visibleTimelineCount.value = thinkingTimeline.value.length
}

const chatSentinelRef = ref<HTMLElement | null>(null)
const timelineSentinelRef = ref<HTMLElement | null>(null)

// 哨兵进入视口后持续补齐直到铺满屏幕（IntersectionObserver 对持续相交不会重复回调）
const fillUntilVisible = async (sentinelRef: Ref<HTMLElement | null>, loadMore: () => void) => {
  await nextTick()
  const el = sentinelRef.value
  if (!el) return
  if (el.getBoundingClientRect().top < window.innerHeight + 800) {
    loadMore()
    await fillUntilVisible(sentinelRef, loadMore)
  }
}

let chatObserver: IntersectionObserver | null = null
let timelineObserver: IntersectionObserver | null = null

onMounted(() => {
  chatObserver = new IntersectionObserver((entries) => {
    if (entries.some(e => e.isIntersecting)) fillUntilVisible(chatSentinelRef, loadMoreChat)
  }, { rootMargin: '800px' })
  timelineObserver = new IntersectionObserver((entries) => {
    if (entries.some(e => e.isIntersecting)) fillUntilVisible(timelineSentinelRef, loadMoreTimeline)
  }, { rootMargin: '800px' })
  // 轮次导航 scroll-spy
  window.addEventListener('scroll', onTurnScroll, { passive: true })
})

onBeforeUnmount(() => {
  chatObserver?.disconnect()
  timelineObserver?.disconnect()
  window.removeEventListener('scroll', onTurnScroll)
  if (turnScrollRaf) cancelAnimationFrame(turnScrollRaf)
})

watch(chatSentinelRef, (el, oldEl) => {
  if (oldEl) chatObserver?.unobserve(oldEl)
  if (el) chatObserver?.observe(el)
})
watch(timelineSentinelRef, (el, oldEl) => {
  if (oldEl) timelineObserver?.unobserve(oldEl)
  if (el) timelineObserver?.observe(el)
})

// 长文本折叠：按 key 记录手动展开状态
const expandedKeys = ref(new Set<string>())
const toggleExpand = (key: string) => {
  const next = new Set(expandedKeys.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expandedKeys.value = next
}
const overLimit = (text: string | undefined, limit: number) => Boolean(text && text.length > limit)
const displayText = (text: string | undefined, key: string, limit: number) => {
  if (!text) return ''
  if (text.length <= limit || expandedKeys.value.has(key)) return text
  return text.slice(0, limit)
}
const chatKey = (prefix: string, msg: SessionMessage, idx: number) => `${prefix}:${msg.id || String(idx)}`
const toolArgsText = (tool: SessionToolCall) => {
  const raw = typeof tool.arguments === 'string'
    ? tool.arguments
    : JSON.stringify(tool.arguments || tool.args || tool.input || {})
  if (raw.length > TOOL_ARGS_LIMIT) {
    return `${raw.slice(0, TOOL_ARGS_LIMIT)} …（已截断，完整 JSON 见工具明细弹窗）`
  }
  return raw
}

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
const activeHighlightedMsgId = ref('')

// 消息 id → 原始下标映射：分块渲染下定位跳转需先把目标纳入渲染窗口
const msgIndexById = computed(() => {
  const map = new Map<string, number>()
  messages.value.forEach((msg, idx) => {
    if (msg.id) map.set(msg.id, idx)
    map.set(String(idx), idx)
  })
  return map
})

const scrollToTargetMessage = () => {
  if (!targetMsgId.value) return
  const rawQueryId = (route.query.msgId as string) || ''
  const targetIdx = msgIndexById.value.get(targetMsgId.value)
    ?? (rawQueryId ? msgIndexById.value.get(rawQueryId) : undefined)
  jumpToChatMessage(
    targetIdx,
    [targetMsgId.value, rawQueryId].filter(Boolean),
    targetMsgId.value
  )
}

// 跳转到指定消息：目标在分块窗口外时先扩窗，再平滑滚动并短暂高亮
const jumpToChatMessage = (msgIdx: number | undefined, idCandidates: string[], highlightId: string) => {
  if (msgIdx !== undefined && msgIdx >= visibleChatCount.value) {
    visibleChatCount.value = Math.min(msgIdx + 60, messages.value.length)
  }
  nextTick(() => {
    setTimeout(() => {
      let el: HTMLElement | null = null
      for (const id of idCandidates) {
        el = document.getElementById('msg-' + id)
        if (el) break
      }
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        activeHighlightedMsgId.value = highlightId
        setTimeout(() => {
          activeHighlightedMsgId.value = ''
        }, 3500)
      }
    }, 250)
  })
}

// —— 会话轮次快捷导航 ——
// 轮次 = 一条非空「真实用户输入」消息及其后续回复；记录消息下标与思维时间线
// intent 步下标，支持对话视图 / 时间线视图双模式跳转。
interface TurnInfo {
  msgIdx: number
  msgId: string
  preview: string
  full: string
  timestamp?: number
  timelineIdx: number | null
}

// 平台 CLI 会把环境上下文作为用户消息注入会话文件（如 # Environment、模型声明、
// 技能清单、<system-reminder> 提醒块），需剥离后才能提取真实用户输入。
const stripInjectedContent = (raw: string): string => {
  const text = raw
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '')
    .replace(/<task-notification>[\s\S]*?<\/task-notification>/gi, '')
    .replace(/<total_tokens>[^<]*<\/total_tokens>/gi, '')
    .replace(/<env>[\s\S]*?<\/env>/gi, '')
    .trim()
  // 整条消息均为平台注入时直接置空
  const injectedPrefixPatterns: RegExp[] = [
    /^# Environment\b/,
    /^You are powered by\b/,
    /^Available agent types\b/,
    /^The following skills are available\b/,
    /^Caveat:/,
    /^# System Prompt\b/,
    /^# Session-Event(s)?\b/,
    /^As you answer the user's questions\b/,
    /^Today's date is\b/,
    /^The user hasn't heard from you\b/,
    /^The TodoWrite tool has(n't)? been used\b/
  ]
  if (injectedPrefixPatterns.some(p => p.test(text))) return ''
  return text
}

const turns = computed<TurnInfo[]>(() => {
  const intentIndexes: number[] = []
  thinkingTimeline.value.forEach((s, i) => {
    if (s.type === 'intent') intentIndexes.push(i)
  })
  const list: TurnInfo[] = []
  let userSeen = 0
  messages.value.forEach((m, idx) => {
    if (m.role !== 'user') return
    // 时间线为每条 user 消息(含注入/空内容)都生成 intent 步，先推进游标再过滤
    const tlIdx = userSeen < intentIndexes.length ? (intentIndexes[userSeen] ?? null) : null
    userSeen++
    const text = stripInjectedContent(m.content || '')
    if (!text) return
    const compact = text.replace(/\s+/g, ' ')
    list.push({
      msgIdx: idx,
      msgId: m.id || String(idx),
      preview: compact.slice(0, 40) + (compact.length > 40 ? '…' : ''),
      full: text,
      timestamp: m.timestamp,
      timelineIdx: tlIdx
    })
  })
  return list
})

const activeTurnIdx = ref(0)
const turnStripRef = ref<HTMLElement | null>(null)
let turnScrollRaf = 0

const updateActiveTurn = () => {
  if (!turns.value.length) return
  let current = 0
  for (let i = 0; i < turns.value.length; i++) {
    const turn = turns.value[i]
    if (!turn) break
    const el = document.getElementById('msg-' + turn.msgId)
    // 未渲染的轮次位于分块窗口之外（更靠下），后续轮次必然同样未渲染
    if (!el) break
    if (el.getBoundingClientRect().top <= window.innerHeight * 0.5) current = i
    else break
  }
  if (current !== activeTurnIdx.value) {
    activeTurnIdx.value = current
    nextTick(() => {
      // 仅横向滚动导航条让 chip 可见；scrollIntoView 会连窗口一起滚，把页面拉回顶部
      const strip = turnStripRef.value
      const chipEl = document.getElementById('turn-chip-' + current)
      if (!strip || !chipEl) return
      const target = chipEl.offsetLeft - strip.offsetLeft - strip.clientWidth / 2 + chipEl.clientWidth / 2
      strip.scrollTo({ left: Math.max(0, target), behavior: 'smooth' })
    })
  }
}

let suppressSpyUntil = 0

const onTurnScroll = () => {
  // 点击跳转的平滑滚动期间不重算，避免中间态覆盖用户选择的轮次
  if (performance.now() < suppressSpyUntil) return
  if (turnScrollRaf) return
  turnScrollRaf = requestAnimationFrame(() => {
    turnScrollRaf = 0
    updateActiveTurn()
  })
}

const jumpToTurn = (ti: number) => {
  const turn = turns.value[ti]
  if (!turn) return
  suppressSpyUntil = performance.now() + 1200
  activeTurnIdx.value = ti
  if (detailMode.value === 'chat') {
    jumpToChatMessage(turn.msgIdx, [turn.msgId], turn.msgId)
  } else if (turn.timelineIdx !== null) {
    if (turn.timelineIdx >= visibleTimelineCount.value) {
      visibleTimelineCount.value = Math.min(turn.timelineIdx + 60, thinkingTimeline.value.length)
    }
    nextTick(() => {
      setTimeout(() => {
        document.getElementById('tl-step-' + turn.timelineIdx)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 250)
    })
  }
}

onMounted(() => {
  scrollToTargetMessage()
})

watch(() => messages.value, () => {
  scrollToTargetMessage()
  nextTick(updateActiveTurn)
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
    <!-- Top Nav / Back Banner -->
    <div class="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 shadow-sm">
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div class="flex items-start md:items-center gap-3 min-w-0 flex-1">
          <NuxtLink
            :to="backUrl"
            class="shrink-0"
          >
            <UButton
              variant="outline"
              color="neutral"
              size="sm"
              icon="i-lucide-arrow-left"
            >
              返回清单
            </UButton>
          </NuxtLink>

          <div class="space-y-0.5 min-w-0 flex-1">
            <div class="flex items-center gap-2 min-w-0">
              <span class="px-2 py-0.5 rounded text-[11px] font-medium font-mono bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5 shrink-0">
                <UIcon
                  :name="getPluginMeta(platform).icon"
                  class="w-3.5 h-3.5"
                />
                {{ getPluginMeta(platform).name }}
              </span>
              <span class="text-xs text-zinc-400 font-mono truncate min-w-0">ID: {{ sessionId }}</span>
            </div>
            <div class="flex items-center gap-2 min-w-0">
              <h1
                class="text-base font-bold text-zinc-900 dark:text-zinc-100 truncate min-w-0"
                :title="session?.title || '会话详情'"
              >
                {{ session?.title || '会话详情' }}
              </h1>
              <UButton
                size="xs"
                variant="ghost"
                color="neutral"
                icon="i-lucide-edit-3"
                class="shrink-0"
                title="修改会话标题"
                @click="openEditModal"
              />
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2 self-end md:self-auto shrink-0">
          <UButton
            size="sm"
            variant="outline"
            color="neutral"
            icon="i-lucide-rotate-cw"
            :loading="isRefreshing"
            @click="handleRefresh"
          >
            刷新
          </UButton>
          <UButton
            color="neutral"
            variant="solid"
            icon="i-lucide-brain"
            size="sm"
            title="提取通用架构决策、排坑经验并存入 Grafeo 记忆图谱"
            @click="isExtractMemoryModalOpen = true"
          >
            提炼记忆
          </UButton>
          <UButton
            color="neutral"
            variant="solid"
            icon="i-lucide-sparkles"
            size="sm"
            title="启动多维量化评估并沉淀高价值知识"
            @click="isHarvestModalOpen = true"
          >
            沉淀资产
          </UButton>
        </div>
      </div>

      <!-- Info badges bar -->
      <div class="flex flex-wrap items-center justify-between gap-4 text-xs text-zinc-500 dark:text-zinc-400 pt-3 mt-3 border-t border-zinc-100 dark:border-zinc-800">
        <div class="flex flex-wrap items-center gap-4">
          <div class="flex items-center gap-1 font-mono">
            <UIcon
              name="i-lucide-folder"
              class="w-3.5 h-3.5 text-zinc-400"
            />
            <span>{{ session?.cwd || '默认工作目录' }}</span>
          </div>
          <div
            v-if="session?.updatedAt"
            class="flex items-center gap-1 font-mono"
          >
            <UIcon
              name="i-lucide-clock"
              class="w-3.5 h-3.5 text-zinc-400"
            />
            <span>更新时间: {{ formatTime(session.updatedAt) }}</span>
          </div>
          <div
            v-if="session?.model"
            class="flex items-center gap-1 font-mono"
          >
            <UIcon
              name="i-lucide-cpu"
              class="w-3.5 h-3.5 text-zinc-400"
            />
            <span>模型: {{ session.model }}</span>
          </div>
          <div
            v-if="session?.cost"
            class="flex items-center gap-1 font-mono"
          >
            <UIcon
              name="i-lucide-dollar-sign"
              class="w-3.5 h-3.5 text-zinc-400"
            />
            <span>花费: ${{ session.cost.toFixed(4) }}</span>
          </div>
        </div>

        <!-- Efficiency Rating Badge (Clickable for Diagnosis Report) -->
        <button
          class="flex items-center gap-2 bg-zinc-50 dark:bg-zinc-800/80 hover:bg-zinc-100 dark:hover:bg-zinc-700 px-2.5 py-1 rounded-md border border-zinc-200/80 dark:border-zinc-700/60 font-mono transition-all cursor-pointer group shadow-2xs"
          title="点击查看会话效能诊断报告与扣分归因"
          @click="isEfficiencyModalOpen = true"
        >
          <span class="text-[11px] text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
            <UIcon
              name="i-lucide-activity"
              class="w-3.5 h-3.5 text-zinc-500 group-hover:text-zinc-900 dark:group-hover:text-zinc-100"
            />
            会话效能:
          </span>
          <span
            :class="[
              'px-1.5 py-0.2 rounded font-bold text-xs shadow-2xs',
              efficiencyAnalysis.grade === 'S' ? 'bg-emerald-500 text-white'
              : efficiencyAnalysis.grade === 'A' ? 'bg-blue-500 text-white'
                : efficiencyAnalysis.grade === 'B' ? 'bg-amber-500 text-white'
                  : 'bg-red-500 text-white'
            ]"
          >
            {{ efficiencyAnalysis.grade }} 级
          </span>
          <span class="text-[11px] font-bold text-zinc-800 dark:text-zinc-200">{{ efficiencyAnalysis.score }}分</span>
          <span class="text-[10px] text-zinc-400 font-sans">({{ efficiencyAnalysis.gradeLabel }})</span>
          <UIcon
            name="i-lucide-chevron-right"
            class="w-3.5 h-3.5 text-zinc-400 group-hover:translate-x-0.5 transition-transform"
          />
        </button>
      </div>

      <!-- Efficiency Insights Breakdown -->
      <div class="pt-3 mt-3 border-t border-zinc-100 dark:border-zinc-800 flex flex-wrap items-center gap-4 text-xs font-mono">
        <div class="flex items-center gap-1 text-zinc-600 dark:text-zinc-300">
          <UIcon
            name="i-lucide-target"
            class="w-3.5 h-3.5 text-blue-500"
          />
          <span>路径精准度: <strong class="text-zinc-900 dark:text-zinc-100">{{ efficiencyAnalysis.directness }}%</strong></span>
        </div>
        <div class="flex items-center gap-1 text-zinc-600 dark:text-zinc-300">
          <UIcon
            name="i-lucide-repeat"
            class="w-3.5 h-3.5 text-purple-500"
          />
          <span>搜索/修改比: <strong class="text-zinc-900 dark:text-zinc-100">{{ efficiencyAnalysis.searchToEditRatio }}:1</strong></span>
        </div>
        <div class="flex items-center gap-1 text-zinc-600 dark:text-zinc-300">
          <UIcon
            name="i-lucide-shield-alert"
            class="w-3.5 h-3.5 text-amber-500"
          />
          <span>思路修正/返工: <strong :class="efficiencyAnalysis.backtrackCount > 2 ? 'text-amber-600' : 'text-zinc-900 dark:text-zinc-100'">{{ efficiencyAnalysis.backtrackCount }} 次</strong></span>
        </div>
        <div class="flex items-center gap-1 text-zinc-600 dark:text-zinc-300">
          <UIcon
            name="i-lucide-messages-square"
            class="w-3.5 h-3.5 text-emerald-500"
          />
          <span>交互轮次: <strong class="text-zinc-900 dark:text-zinc-100">{{ efficiencyAnalysis.userTurns }} 问 / {{ efficiencyAnalysis.assistantTurns }} 答</strong></span>
        </div>
      </div>

      <!-- Tools & Skills Metrics Bar -->
      <div
        v-if="toolStats.totalToolCalls > 0 || toolStats.skills.length > 0"
        class="pt-3 mt-3 border-t border-zinc-100 dark:border-zinc-800 space-y-2"
      >
        <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
          <!-- Tool usage summary -->
          <div class="flex items-center gap-2">
            <span class="font-medium text-zinc-700 dark:text-zinc-300 flex items-center gap-1 text-xs">
              <UIcon
                name="i-lucide-wrench"
                class="w-3.5 h-3.5 text-purple-500"
              />
              工具调用: <span class="font-mono font-bold text-zinc-900 dark:text-zinc-100">{{ toolStats.totalToolCalls }}</span> 次 ({{ toolStats.uniqueToolCount }} 种工具)
            </span>
          </div>

          <!-- Skills summary -->
          <div
            v-if="toolStats.skills.length"
            class="flex items-center gap-1.5"
          >
            <span class="font-medium text-zinc-700 dark:text-zinc-300 flex items-center gap-1 text-xs">
              <UIcon
                name="i-lucide-puzzle"
                class="w-3.5 h-3.5 text-amber-500"
              />
              触发技能 ({{ toolStats.skills.length }}):
            </span>
            <span
              v-for="sk in toolStats.skills"
              :key="sk"
              class="px-2 py-0.5 rounded-full text-[10px] font-mono bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30"
            >
              {{ sk }}
            </span>
          </div>
        </div>

        <!-- Tool Pills with Frequency Counts -->
        <div class="flex flex-wrap gap-1.5 pt-0.5">
          <button
            v-for="t in toolStats.tools"
            :key="t.name"
            class="px-2.5 py-1 rounded-md bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 border border-zinc-200 dark:border-zinc-700/60 text-[11px] font-mono flex items-center gap-1.5 text-zinc-800 dark:text-zinc-200 cursor-pointer select-none transition-all shadow-2xs group"
            :title="`点击查看 ${t.name} 的全部 ${t.count} 次调用明细`"
            @click="openToolDetails(t.name)"
          >
            <UIcon
              name="i-lucide-wrench"
              class="w-3 h-3 text-purple-500 group-hover:rotate-12 transition-transform"
            />
            <span class="font-medium">{{ t.name }}</span>
            <span class="px-1.5 py-0.2 rounded text-[10px] bg-zinc-200 dark:bg-zinc-700 group-hover:bg-purple-100 group-hover:text-purple-700 dark:group-hover:bg-purple-900/60 dark:group-hover:text-purple-300 text-zinc-700 dark:text-zinc-300 font-bold transition-colors">
              ×{{ t.count }}
            </span>
          </button>
        </div>
      </div>
    </div>

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
        <div
          v-for="{ msg, idx } in visibleMessages"
          :id="'msg-' + (msg.id || idx)"
          :key="msg.id || idx"
          :class="[
            'p-4 rounded-xl text-xs space-y-2 border transition-all duration-300',
            msg.role === 'user'
              ? 'bg-zinc-100/90 dark:bg-zinc-800/80 border-zinc-200 dark:border-zinc-700/70 ml-8 lg:ml-20'
              : 'bg-white dark:bg-zinc-900 border-zinc-200/90 dark:border-zinc-800 mr-8 lg:mr-20 shadow-xs',
            activeHighlightedMsgId === (msg.id || String(idx))
              ? 'ring-2 ring-amber-500 shadow-lg scale-[1.01]'
              : ''
          ]"
        >
          <!-- Message Header -->
          <div class="flex items-center justify-between text-xs text-zinc-400 pb-1 border-b border-zinc-100 dark:border-zinc-800/60">
            <span class="font-semibold flex items-center gap-1.5 text-zinc-800 dark:text-zinc-200">
              <UIcon
                :name="msg.role === 'user' ? 'i-lucide-user' : 'i-lucide-bot'"
                class="w-4 h-4 text-zinc-500"
              />
              {{ msg.role === 'user' ? 'User' : 'Assistant' }}
              <span
                v-if="msg.model"
                class="font-normal font-mono text-zinc-400"
              >({{ msg.model }})</span>
            </span>
            <span
              v-if="msg.timestamp"
              class="font-mono text-[11px]"
            >{{ formatTime(msg.timestamp) }}</span>
          </div>

          <!-- Thought Block -->
          <div
            v-if="msg.thought"
            class="p-3.5 bg-amber-500/5 dark:bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap font-sans"
          >
            <div class="font-semibold text-amber-600 dark:text-amber-400 mb-1.5 flex items-center gap-1.5 text-[11px] uppercase font-mono">
              <UIcon
                name="i-lucide-lightbulb"
                class="w-3.5 h-3.5"
              /> 思考路径与推导依据 (Thinking Process)
            </div>
            {{ displayText(msg.thought, chatKey('t', msg, idx), THOUGHT_LIMIT) }}
            <button
              v-if="overLimit(msg.thought, THOUGHT_LIMIT)"
              class="mt-1.5 px-2 py-0.5 rounded bg-amber-500/10 dark:bg-amber-500/20 text-[10px] font-mono text-amber-600 dark:text-amber-400 border border-amber-500/30 cursor-pointer hover:bg-amber-500/20 transition-colors"
              @click="toggleExpand(chatKey('t', msg, idx))"
            >
              {{ expandedKeys.has(chatKey('t', msg, idx)) ? '▲ 收起思考过程' : `▼ 展开思考过程（共 ${(msg.thought || '').length} 字符）` }}
            </button>
          </div>

          <!-- Content text -->
          <div class="whitespace-pre-wrap leading-relaxed text-zinc-800 dark:text-zinc-200 font-sans text-xs break-words">
            {{ displayText(msg.content, chatKey('c', msg, idx), CONTENT_LIMIT) }}
          </div>
          <button
            v-if="overLimit(msg.content, CONTENT_LIMIT)"
            class="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-[10px] font-mono text-zinc-500 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700 cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors w-fit"
            @click="toggleExpand(chatKey('c', msg, idx))"
          >
            {{ expandedKeys.has(chatKey('c', msg, idx)) ? '▲ 收起正文' : `▼ 展开正文（共 ${(msg.content || '').length} 字符）` }}
          </button>

          <!-- Tool Calls -->
          <div
            v-if="msg.toolCalls?.length"
            class="pt-2"
          >
            <div class="text-[10px] font-mono uppercase text-zinc-400 mb-1.5 flex items-center gap-1">
              <UIcon
                name="i-lucide-wrench"
                class="w-3.5 h-3.5"
              /> 工具执行记录 ({{ msg.toolCalls.length }})
            </div>
            <div class="space-y-1.5">
              <div
                v-for="(tool, tIdx) in msg.toolCalls"
                :key="tIdx"
                class="bg-zinc-100 dark:bg-zinc-800/80 px-3 py-1.5 rounded-md text-[11px] font-mono text-zinc-600 dark:text-zinc-400 break-all"
              >
                <span class="font-bold text-zinc-800 dark:text-zinc-200">{{ tool.name || tool.type || 'Tool' }}</span>:
                {{ toolArgsText(tool) }}
              </div>
            </div>
          </div>
        </div>

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

    <!-- Tool Invocations Detail Table Modal -->
    <UModal
      v-model:open="isToolModalOpen"
      :ui="{ content: 'max-w-5xl max-h-[88vh]' }"
    >
      <template #content>
        <div class="flex flex-col h-[82vh]">
          <!-- Modal Header -->
          <div class="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
            <div class="flex items-center gap-2.5">
              <div class="w-8 h-8 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center border border-purple-500/20">
                <UIcon
                  name="i-lucide-wrench"
                  class="w-4 h-4"
                />
              </div>
              <div>
                <h3 class="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                  <span class="font-mono">{{ selectedToolName }}</span>
                  <span class="text-xs font-normal text-zinc-400">调用详情记录</span>
                </h3>
                <p class="text-xs text-zinc-400 font-mono mt-0.5">
                  在当前会话中累计被调用 {{ selectedToolCalls.length }} 次
                </p>
              </div>
            </div>

            <UButton
              size="sm"
              variant="ghost"
              color="neutral"
              icon="i-lucide-x"
              @click="isToolModalOpen = false"
            />
          </div>

          <!-- Table Content Container -->
          <div class="flex-1 overflow-y-auto p-4">
            <div class="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">
              <table class="w-full text-left text-xs">
                <thead class="bg-zinc-100/80 dark:bg-zinc-800/80 text-zinc-600 dark:text-zinc-400 font-medium border-b border-zinc-200 dark:border-zinc-800 font-mono">
                  <tr>
                    <th class="py-2.5 px-3 w-12 text-center">
                      #
                    </th>
                    <th class="py-2.5 px-3 w-36 whitespace-nowrap">
                      时间
                    </th>
                    <th class="py-2.5 px-3 w-1/2">
                      核心参数与推导动机
                    </th>
                    <th class="py-2.5 px-3 w-1/2">
                      完整调用参数 (Arguments JSON)
                    </th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-zinc-200/70 dark:divide-zinc-800/70 font-sans">
                  <tr
                    v-for="call in selectedToolCalls"
                    :key="call.index"
                    class="hover:bg-zinc-50/70 dark:hover:bg-zinc-800/50 transition-colors align-top"
                  >
                    <!-- Index -->
                    <td class="py-3 px-3 text-center font-mono font-bold text-zinc-400">
                      {{ call.index }}
                    </td>

                    <!-- Timestamp -->
                    <td class="py-3 px-3 font-mono text-[11px] text-zinc-400 whitespace-nowrap">
                      {{ formatTime(call.timestamp) }}
                    </td>

                    <!-- Summary & Thought Context -->
                    <td class="py-3 px-3 space-y-1.5 w-1/2">
                      <div class="font-medium text-zinc-800 dark:text-zinc-200 font-mono text-[11px] break-all">
                        {{ call.summary }}
                      </div>
                      <div
                        v-if="call.associatedThought"
                        class="p-2 rounded-md bg-amber-500/5 dark:bg-amber-500/10 border border-amber-500/20 text-[11px] text-zinc-700 dark:text-zinc-300 leading-relaxed font-sans max-h-40 overflow-y-auto whitespace-pre-wrap break-words"
                      >
                        <div class="font-semibold text-amber-600 dark:text-amber-400 mb-1 flex items-center gap-1">
                          <UIcon
                            name="i-lucide-sparkles"
                            class="w-3.5 h-3.5"
                          />
                          <span>推导动机 / 思维链:</span>
                        </div>
                        <div class="text-[10.5px] leading-relaxed">
                          {{ call.associatedThought }}
                        </div>
                      </div>
                    </td>

                    <!-- Full Arguments JSON -->
                    <td class="py-3 px-3">
                      <pre class="p-2 rounded bg-zinc-50 dark:bg-zinc-950 border border-zinc-200/80 dark:border-zinc-800 font-mono text-[10px] text-zinc-700 dark:text-zinc-300 max-h-36 overflow-y-auto whitespace-pre-wrap break-all">{{ typeof call.arguments === 'object' ? JSON.stringify(call.arguments, null, 2) : call.arguments }}</pre>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- Footer -->
          <div class="p-3 bg-zinc-50 dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between text-xs text-zinc-400 font-mono">
            <span>工具: {{ selectedToolName }}</span>
            <UButton
              size="xs"
              variant="outline"
              color="neutral"
              @click="isToolModalOpen = false"
            >
              关闭
            </UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- Session Efficiency Diagnosis & Root-Cause Modal -->
    <UModal
      v-model:open="isEfficiencyModalOpen"
      :ui="{ content: 'max-w-4xl max-h-[88vh]' }"
    >
      <template #content>
        <div class="flex flex-col h-[82vh]">
          <!-- Modal Header -->
          <div class="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
            <div class="flex items-center gap-2.5">
              <div class="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center border border-blue-500/20">
                <UIcon
                  name="i-lucide-gauge"
                  class="w-4 h-4"
                />
              </div>
              <div>
                <h3 class="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                  <span>会话效能诊断报告与扣分归因</span>
                  <span
                    :class="[
                      'px-1.5 py-0.2 rounded font-mono font-bold text-xs',
                      efficiencyAnalysis.grade === 'S' ? 'bg-emerald-500 text-white'
                      : efficiencyAnalysis.grade === 'A' ? 'bg-blue-500 text-white'
                        : efficiencyAnalysis.grade === 'B' ? 'bg-amber-500 text-white'
                          : 'bg-red-500 text-white'
                    ]"
                  >
                    {{ efficiencyAnalysis.grade }} 级 ({{ efficiencyAnalysis.score }}分)
                  </span>
                </h3>
                <p class="text-xs text-zinc-400 mt-0.5">
                  基于路径探索、决策摩擦、思考链颠簸与交互轮次多维量化评估
                </p>
              </div>
            </div>

            <div class="flex items-center gap-2">
              <UButton
                size="sm"
                color="neutral"
                class="bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                icon="i-lucide-sparkles"
                :loading="isDiagnosing"
                @click="runAIDiagnosis"
              >
                {{ aiDiagnosisResult ? '重新让 AI 诊断' : '✨ 启动 AI 深度诊断' }}
              </UButton>
              <UButton
                size="sm"
                variant="ghost"
                color="neutral"
                icon="i-lucide-x"
                @click="isEfficiencyModalOpen = false"
              />
            </div>
          </div>

          <!-- AI Judge Banner (if evaluated) -->
          <div
            v-if="aiDiagnosisResult"
            class="bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-emerald-500/10 border-b border-zinc-200 dark:border-zinc-800 px-5 py-3 flex items-center justify-between"
          >
            <div class="flex items-center gap-2">
              <UIcon
                name="i-lucide-bot"
                class="w-4 h-4 text-purple-600 dark:text-purple-400"
              />
              <span class="text-xs font-bold text-zinc-900 dark:text-zinc-100">AI 效能审计完成:</span>
              <span class="text-xs text-zinc-600 dark:text-zinc-300">{{ aiDiagnosisResult.taskSummary }}</span>
            </div>
            <span class="text-[10px] font-mono text-zinc-400">
              完成度: <strong class="text-emerald-600 dark:text-emerald-400">{{ aiDiagnosisResult.taskCompletionStatus }}</strong>
            </span>
          </div>

          <!-- Modal Body Content -->
          <div class="flex-1 overflow-y-auto p-5 space-y-5 bg-zinc-50/40 dark:bg-zinc-950/40">
            <!-- Streaming Diagnosis Progress Banner / Typewriter Box -->
            <div
              v-if="isDiagnosing"
              class="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 space-y-3 shadow-sm animate-fade-in"
            >
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <UIcon
                    name="i-lucide-loader-2"
                    class="w-4 h-4 animate-spin text-purple-600 dark:text-purple-400"
                  />
                  <span class="text-xs font-bold text-zinc-900 dark:text-zinc-100">AI 效能推理诊断中</span>
                </div>
                <span class="px-2 py-0.5 rounded text-[10px] font-mono bg-purple-50 text-purple-600 dark:bg-purple-950/40 dark:text-purple-400 border border-purple-200 dark:border-purple-800 flex items-center gap-1">
                  <UIcon
                    name="i-lucide-sparkles"
                    class="w-3 h-3"
                  />
                  流式分析中
                </span>
              </div>
              <div class="p-2.5 bg-zinc-50 dark:bg-zinc-800/60 rounded border border-zinc-200/70 dark:border-zinc-700/60 text-xs text-zinc-700 dark:text-zinc-300 flex items-center gap-2">
                <span class="relative flex h-2 w-2">
                  <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75" />
                  <span class="relative inline-flex rounded-full h-2 w-2 bg-purple-500" />
                </span>
                <span class="font-medium font-mono text-[11px]">{{ diagnoseStatus || '正在分析会话行为轨迹与决策思考链...' }}</span>
              </div>
              <div
                v-if="diagnoseStreamText"
                class="p-3.5 bg-zinc-50/90 dark:bg-zinc-800/50 text-zinc-700 dark:text-zinc-200 font-mono text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 max-h-[200px] overflow-y-auto whitespace-pre-wrap leading-relaxed shadow-xs"
              >
                {{ diagnoseStreamText }}<span class="inline-block w-1.5 h-3.5 bg-purple-600 dark:bg-purple-400 ml-0.5 animate-pulse align-middle" />
              </div>
            </div>

            <!-- 1. Dimension Score Breakdown Grid -->
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <!-- Directness -->
              <div class="bg-white dark:bg-zinc-900 p-3.5 rounded-lg border border-zinc-200 dark:border-zinc-800 space-y-1 shadow-2xs">
                <div class="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                  <span class="flex items-center gap-1 font-medium">
                    <UIcon
                      name="i-lucide-target"
                      class="w-3.5 h-3.5 text-blue-500"
                    />
                    路径精准度 (35%)
                  </span>
                  <span class="font-mono font-bold text-zinc-900 dark:text-zinc-100">{{ efficiencyAnalysis.subScores.directness }}分</span>
                </div>
                <div class="text-[11px] text-zinc-400 pt-1">
                  读改比: {{ efficiencyAnalysis.searchToEditRatio }}:1 (探索 {{ efficiencyAnalysis.searchCount }} / 修改 {{ efficiencyAnalysis.editCount }})
                </div>
              </div>

              <!-- Friction -->
              <div class="bg-white dark:bg-zinc-900 p-3.5 rounded-lg border border-zinc-200 dark:border-zinc-800 space-y-1 shadow-2xs">
                <div class="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                  <span class="flex items-center gap-1 font-medium">
                    <UIcon
                      name="i-lucide-shield-alert"
                      class="w-3.5 h-3.5 text-amber-500"
                    />
                    决策顺畅度 (30%)
                  </span>
                  <span class="font-mono font-bold text-zinc-900 dark:text-zinc-100">{{ efficiencyAnalysis.subScores.friction }}分</span>
                </div>
                <div class="text-[11px] text-zinc-400 pt-1">
                  思路颠簸修正: {{ efficiencyAnalysis.backtrackCount }} 次
                </div>
              </div>

              <!-- Turns -->
              <div class="bg-white dark:bg-zinc-900 p-3.5 rounded-lg border border-zinc-200 dark:border-zinc-800 space-y-1 shadow-2xs">
                <div class="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                  <span class="flex items-center gap-1 font-medium">
                    <UIcon
                      name="i-lucide-messages-square"
                      class="w-3.5 h-3.5 text-emerald-500"
                    />
                    交互周转率 (20%)
                  </span>
                  <span class="font-mono font-bold text-zinc-900 dark:text-zinc-100">{{ efficiencyAnalysis.subScores.turn }}分</span>
                </div>
                <div class="text-[11px] text-zinc-400 pt-1">
                  总轮次: {{ efficiencyAnalysis.userTurns }} 问 / {{ efficiencyAnalysis.assistantTurns }} 答
                </div>
              </div>

              <!-- Action Density -->
              <div class="bg-white dark:bg-zinc-900 p-3.5 rounded-lg border border-zinc-200 dark:border-zinc-800 space-y-1 shadow-2xs">
                <div class="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                  <span class="flex items-center gap-1 font-medium">
                    <UIcon
                      name="i-lucide-cpu"
                      class="w-3.5 h-3.5 text-purple-500"
                    />
                    行动有效性 (15%)
                  </span>
                  <span class="font-mono font-bold text-zinc-900 dark:text-zinc-100">{{ efficiencyAnalysis.subScores.action }}分</span>
                </div>
                <div class="text-[11px] text-zinc-400 pt-1">
                  有效代码修改: {{ efficiencyAnalysis.editCount }} 处
                </div>
              </div>
            </div>

            <!-- 2. Root Cause & Friction Incidents -->
            <div class="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 space-y-3">
              <div class="flex items-center justify-between">
                <h4 class="text-xs font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                  <UIcon
                    name="i-lucide-alert-triangle"
                    class="w-4 h-4 text-amber-500"
                  />
                  扣分与摩擦事件深度归因 (Friction Incidents)
                </h4>
                <span class="text-[11px] text-zinc-400 font-mono">
                  共记录 {{ efficiencyAnalysis.frictionEvents.length }} 处效能阻碍
                </span>
              </div>

              <div
                v-if="!efficiencyAnalysis.frictionEvents.length"
                class="py-6 text-center text-zinc-400 text-xs"
              >
                ✨ 未检测到明显的思路返工或决策摩擦，整体执行非常流畅！
              </div>

              <div
                v-else
                class="space-y-3"
              >
                <div
                  v-for="(evt, eIdx) in efficiencyAnalysis.frictionEvents"
                  :key="eIdx"
                  :class="[
                    'p-3.5 rounded-lg border text-xs space-y-2 font-sans transition-all',
                    evt.type === 'backtrack' ? 'border-amber-500/30 bg-amber-500/5 dark:bg-amber-500/10'
                    : evt.type === 'search_heavy' ? 'border-blue-500/30 bg-blue-500/5 dark:bg-blue-500/10'
                      : 'border-purple-500/30 bg-purple-500/5 dark:bg-purple-500/10'
                  ]"
                >
                  <!-- Card Header -->
                  <div class="flex items-center justify-between gap-2 pb-1.5 border-b border-zinc-200/50 dark:border-zinc-800/50">
                    <span class="font-semibold text-xs flex items-center gap-1.5 text-zinc-900 dark:text-zinc-100">
                      <UIcon
                        :name="
                          evt.type === 'backtrack' ? 'i-lucide-refresh-cw'
                          : evt.type === 'search_heavy' ? 'i-lucide-search'
                            : 'i-lucide-clock'
                        "
                        :class="[
                          'w-4 h-4',
                          evt.type === 'backtrack' ? 'text-amber-500'
                          : evt.type === 'search_heavy' ? 'text-blue-500'
                            : 'text-purple-500'
                        ]"
                      />
                      第 {{ evt.turn }} 轮交互: {{ evt.title }}
                    </span>
                    <span class="px-2 py-0.5 rounded text-[10px] font-mono bg-red-100 dark:bg-red-950/80 text-red-600 dark:text-red-400 font-bold border border-red-200 dark:border-red-900">
                      {{ evt.impact }}
                    </span>
                  </div>

                  <!-- Detailed Description & Context Block -->
                  <div class="space-y-1.5 text-zinc-700 dark:text-zinc-300">
                    <p class="text-xs leading-relaxed">
                      {{ evt.detail }}
                    </p>

                    <!-- Tool Snippet Pill (if search heavy) -->
                    <div
                      v-if="evt.toolSnippet"
                      class="pt-1"
                    >
                      <span class="text-[10px] font-mono text-zinc-400 block mb-1">触发的工具序列:</span>
                      <div class="p-2 rounded bg-zinc-100 dark:bg-zinc-800 font-mono text-[11px] text-zinc-700 dark:text-zinc-300 break-all border border-zinc-200/60 dark:border-zinc-800">
                        {{ evt.toolSnippet }}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 3. Actionable Recommendations -->
            <div class="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 space-y-3">
              <div class="flex items-center justify-between gap-2">
                <h4 class="text-xs font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                  <UIcon
                    name="i-lucide-sparkles"
                    class="w-4 h-4 text-emerald-500"
                  />
                  效能优化建议 (Actionable Insights)
                </h4>
              </div>

              <ul class="space-y-2 text-xs text-zinc-700 dark:text-zinc-300">
                <li
                  v-for="(rec, rIdx) in efficiencyAnalysis.recommendations"
                  :key="rIdx"
                  class="flex items-center justify-between gap-3 p-2.5 rounded-md bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200/60 dark:border-zinc-800/80 group transition-colors"
                >
                  <div class="flex items-start gap-2 min-w-0">
                    <span class="text-emerald-500 font-bold shrink-0 mt-0.5">💡</span>
                    <span class="leading-relaxed break-words">{{ rec }}</span>
                  </div>
                </li>
              </ul>
            </div>
          </div>

          <!-- Footer -->
          <div class="p-3 bg-zinc-50 dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-end text-xs text-zinc-400">
            <UButton
              size="xs"
              color="neutral"
              class="bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              @click="isEfficiencyModalOpen = false"
            >
              我知道了
            </UButton>
          </div>
        </div>
      </template>
    </UModal>

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
