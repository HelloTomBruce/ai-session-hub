/**
 * 会话轮次导航（从 app/pages/sessions/[id].vue 抽出）。
 *
 * 「轮次」= 一条非空的真实用户输入 + 其后的回复。平台 CLI 会把环境上下文写进 user 消息，
 * 因此必须先用 shared/utils/session-text 的 `stripInjectedContent` 剥掉注入块再判断。
 *
 * 这里同时承载三件事（它们在原页面里强耦合，拆开会留下双向依赖）：
 *  1. `turns`：轮次列表（消息下标 + 思维链 intent 步下标），驱动吸顶导航条；
 *  2. scroll-spy：滚动时计算当前轮次并横向居中对应 chip（点击跳转期间暂停，避免中间态覆盖）；
 *  3. 跳转：按当前视图（对话 / 时间线）把目标纳入分块渲染窗口，再平滑滚动 + 短暂高亮。
 *
 * 分块窗口由调用方通过 `ensureChatRendered` / `ensureTimelineRendered` 注入，
 * 本组合式不直接持有渲染窗口状态。
 */
import type { Ref } from 'vue'
import type { SessionMessage } from '../../server/utils/types'
// 客户端构建必须走 #shared 别名：直接用相对路径会被 Rollup 当成 chunk 相对路径而解析失败
import { stripInjectedContent } from '#shared/utils/session-text'
import type { ThinkingTimelineItem } from './useThinkingTimeline'

export interface TurnInfo {
  /** 该轮用户消息在 messages 中的原始下标 */
  msgIdx: number
  /** 该轮用户消息的 DOM id（用于定位与 scroll-spy） */
  msgId: string
  /** 导航条上的一行摘要 */
  preview: string
  /** 完整用户输入 */
  full: string
  timestamp?: number
  /** 思维链里对应的 intent 步下标（没有则为 null） */
  timelineIdx: number | null
}

export interface SessionTurnsOptions {
  messages: Ref<SessionMessage[]>
  timeline: Ref<ThinkingTimelineItem[]>
  detailMode: Ref<'chat' | 'thinking'>
  /** 目标消息 id（来自 ?msgId=，由页面解析后传入） */
  targetMsgId: Ref<string>
  /** 把消息下标纳入对话渲染窗口 */
  ensureChatRendered: (idx: number) => void
  /** 把时间线下标纳入渲染窗口 */
  ensureTimelineRendered: (idx: number) => void
}

export function useSessionTurns(options: SessionTurnsOptions) {
  const { messages, timeline, detailMode, targetMsgId } = options

  const turns = computed<TurnInfo[]>(() => {
    const intentIndexes: number[] = []
    timeline.value.forEach((s, i) => {
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
  let suppressSpyUntil = 0

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

  const onTurnScroll = () => {
    // 点击跳转的平滑滚动期间不重算，避免中间态覆盖用户选择的轮次
    if (performance.now() < suppressSpyUntil) return
    if (turnScrollRaf) return
    turnScrollRaf = requestAnimationFrame(() => {
      turnScrollRaf = 0
      updateActiveTurn()
    })
  }

  const activeHighlightedMsgId = ref('')

  /** 消息 id → 原始下标映射：分块渲染下定位跳转需先把目标纳入渲染窗口 */
  const msgIndexById = computed(() => {
    const map = new Map<string, number>()
    messages.value.forEach((msg, idx) => {
      if (msg.id) map.set(msg.id, idx)
      map.set(String(idx), idx)
    })
    return map
  })

  /** 跳转到指定消息：目标在分块窗口外时先扩窗，再平滑滚动并短暂高亮 */
  const jumpToChatMessage = (msgIdx: number | undefined, idCandidates: string[], highlightId: string) => {
    if (msgIdx !== undefined) options.ensureChatRendered(msgIdx)
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

  /** 响应 ?msgId= 深链：滚到目标消息 */
  const scrollToTargetMessage = () => {
    if (!targetMsgId.value) return
    const targetIdx = msgIndexById.value.get(targetMsgId.value)
    if (targetIdx === undefined) return
    jumpToChatMessage(targetIdx, [targetMsgId.value], targetMsgId.value)
  }

  const jumpToTurn = (ti: number) => {
    const turn = turns.value[ti]
    if (!turn) return
    suppressSpyUntil = performance.now() + 1200
    activeTurnIdx.value = ti
    if (detailMode.value === 'chat') {
      jumpToChatMessage(turn.msgIdx, [turn.msgId], turn.msgId)
      return
    }
    if (turn.timelineIdx === null) return
    options.ensureTimelineRendered(turn.timelineIdx)
    nextTick(() => {
      setTimeout(() => {
        document.getElementById('tl-step-' + turn.timelineIdx)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 250)
    })
  }

  onMounted(() => {
    scrollToTargetMessage()
    window.addEventListener('scroll', onTurnScroll, { passive: true })
  })

  onBeforeUnmount(() => {
    window.removeEventListener('scroll', onTurnScroll)
    if (turnScrollRaf) cancelAnimationFrame(turnScrollRaf)
  })

  watch(() => messages.value, () => {
    scrollToTargetMessage()
    nextTick(updateActiveTurn)
  })

  return {
    turns,
    activeTurnIdx,
    turnStripRef,
    activeHighlightedMsgId,
    jumpToTurn,
    updateActiveTurn,
    scrollToTargetMessage
  }
}
