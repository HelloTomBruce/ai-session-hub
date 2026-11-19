<script setup lang="ts">
/**
 * 单条会话消息卡（从 app/pages/sessions/[id].vue 抽出）。
 *
 * 根节点保留 `id="msg-<id>"`：轮次导航的 scroll-spy 与深链跳转都依赖这个 DOM 契约，
 * 因此 id 由父组件算好后以 `msgId` 传入，而不是在这里重新推导（避免两处口径漂移）。
 */
import type { SessionMessage, SessionToolCall } from '../../../server/utils/types'

const props = defineProps<{
  msg: SessionMessage
  idx: number
  /** msg.id || String(idx)，直接作为 DOM id 后缀 */
  msgId: string
  highlighted: boolean
  /** useLongTextCollapse() 的返回对象（展开态在页面级共享） */
  collapse: ReturnType<typeof useLongTextCollapse>
  contentLimit: number
  thoughtLimit: number
  toolArgsLimit: number
  formatTime: (ts?: number) => string
}>()

const { expandedKeys, toggleExpand, overLimit, displayText } = props.collapse

const chatKey = (prefix: string) => `${prefix}:${props.msg.id || String(props.idx)}`

const toolArgsText = (tool: SessionToolCall) => {
  const raw = typeof tool.arguments === 'string'
    ? tool.arguments
    : JSON.stringify(tool.arguments || tool.args || tool.input || {})
  if (raw.length > props.toolArgsLimit) {
    return `${raw.slice(0, props.toolArgsLimit)} …（已截断，完整 JSON 见工具明细弹窗）`
  }
  return raw
}
</script>

<template>
  <div
    :id="'msg-' + msgId"
    :class="[
      'p-4 rounded-xl text-xs space-y-2 border transition-all duration-300',
      msg.role === 'user'
        ? 'bg-zinc-100/90 dark:bg-zinc-800/80 border-zinc-200 dark:border-zinc-700/70 ml-8 lg:ml-20'
        : 'bg-white dark:bg-zinc-900 border-zinc-200/90 dark:border-zinc-800 mr-8 lg:mr-20 shadow-xs',
      highlighted
        ? 'ring-2 ring-amber-500 shadow-lg scale-[1.01]'
        : ''
    ]"
  >
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
      {{ displayText(msg.thought, chatKey('t'), thoughtLimit) }}
      <button
        v-if="overLimit(msg.thought, thoughtLimit)"
        class="mt-1.5 px-2 py-0.5 rounded bg-amber-500/10 dark:bg-amber-500/20 text-[10px] font-mono text-amber-600 dark:text-amber-400 border border-amber-500/30 cursor-pointer hover:bg-amber-500/20 transition-colors"
        @click="toggleExpand(chatKey('t'))"
      >
        {{ expandedKeys.has(chatKey('t')) ? '▲ 收起思考过程' : `▼ 展开思考过程（共 ${(msg.thought || '').length} 字符）` }}
      </button>
    </div>

    <!-- Content text -->
    <div class="whitespace-pre-wrap leading-relaxed text-zinc-800 dark:text-zinc-200 font-sans text-xs break-words">
      {{ displayText(msg.content, chatKey('c'), contentLimit) }}
    </div>
    <button
      v-if="overLimit(msg.content, contentLimit)"
      class="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-[10px] font-mono text-zinc-500 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700 cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors w-fit"
      @click="toggleExpand(chatKey('c'))"
    >
      {{ expandedKeys.has(chatKey('c')) ? '▲ 收起正文' : `▼ 展开正文（共 ${(msg.content || '').length} 字符）` }}
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
</template>
