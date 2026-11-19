<script setup lang="ts">
/**
 * 首页会话卡片（从 app/pages/index.vue 抽出）。
 *
 * 纯展示 + 事件上抛：标签、插件元信息由父级算好传入，卡片内不再调用页面级组合式，
 * 这样卡片可以被列表、搜索结果、未来的收藏页复用。
 */
import type { UnifiedSession } from '../../../server/utils/types'

defineProps<{
  item: UnifiedSession
  selected: boolean
  /** 已解析的标签（含用户手工标签） */
  tags: string[]
  /** 卡片上最多展示的标签数，超出折叠为 +N */
  limit: number
  pluginMeta: { name: string, icon: string }
  tagColors: Record<string, string>
  activeTagFilter: string
  formatTime: (ts?: number) => string
}>()

const emit = defineEmits<{
  select: []
  open: []
  edit: []
  remove: []
  tag: [tag: string]
}>()
</script>

<template>
  <div
    :class="[
      'group bg-white dark:bg-zinc-900 rounded-lg border transition-all flex flex-col justify-between overflow-hidden shadow-sm',
      selected
        ? 'border-zinc-900 dark:border-zinc-100 ring-2 ring-zinc-900/15 dark:ring-zinc-100/20 bg-zinc-50/50 dark:bg-zinc-800/30'
        : 'border-zinc-200 dark:border-zinc-800/90 hover:border-zinc-300 dark:hover:border-zinc-700'
    ]"
  >
    <div
      class="p-4 flex-1 cursor-pointer"
      @click="emit('open')"
    >
      <!-- Top Tag & Time -->
      <div class="flex items-center justify-between mb-2.5 gap-2">
        <div class="flex items-center gap-1.5">
          <div
            class="w-4 h-4 rounded border-2 flex items-center justify-center cursor-pointer transition-all shrink-0 hover:scale-110"
            :class="selected
              ? 'bg-zinc-900 dark:bg-zinc-100 border-zinc-900 dark:border-zinc-100 text-white dark:text-zinc-900 shadow-xs'
              : 'border-zinc-300 dark:border-zinc-600 hover:border-zinc-500 bg-white/70 dark:bg-zinc-800/70'"
            title="勾选此会话以进行批量操作"
            @click.stop="emit('select')"
          >
            <UIcon
              v-if="selected"
              name="i-lucide-check"
              class="w-3 h-3 stroke-[3]"
            />
          </div>
          <span class="px-2 py-0.5 rounded text-[11px] font-medium font-mono border border-zinc-200 dark:border-zinc-700/80 bg-zinc-50 dark:bg-zinc-800/60 text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
            <UIcon
              :name="pluginMeta.icon"
              class="w-3 h-3 text-zinc-500 dark:text-zinc-400"
            />
            {{ pluginMeta.name }}
          </span>
          <span
            v-if="item.extra?.aiDiagnosed"
            class="px-1.5 py-0.5 rounded text-[10px] font-medium border border-purple-200 dark:border-purple-500/30 bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center gap-1 shrink-0"
            title="该会话已完成 AI 深度诊断，进入详情页可查看诊断报告"
          >
            <UIcon
              name="i-lucide-sparkles"
              class="w-3 h-3"
            />
            AI 已诊断
          </span>
        </div>
        <span class="text-[11px] text-zinc-400 font-mono">
          {{ formatTime(item.updatedAt) }}
        </span>
      </div>

      <!-- Title -->
      <h3 class="font-medium text-zinc-900 dark:text-zinc-100 text-sm line-clamp-2 mb-1.5 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition-colors">
        {{ item.title }}
      </h3>

      <!-- Tags：卡片只展示前 4 个，其余折叠成 +N，避免标签多的会话把首屏撑爆 -->
      <div
        v-if="tags.length"
        class="flex flex-wrap gap-1 mb-2"
      >
        <span
          v-for="tag in tags.slice(0, limit)"
          :key="tag"
          :class="[
            'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium cursor-pointer select-none border transition-all',
            activeTagFilter === tag ? 'ring-2 ring-offset-1 dark:ring-offset-zinc-900' : 'hover:opacity-80'
          ]"
          :style="{
            backgroundColor: (tagColors[tag] || '#6366f1') + '20',
            color: tagColors[tag] || '#6366f1',
            borderColor: (tagColors[tag] || '#6366f1') + '40'
          }"
          @click.stop="emit('tag', tag)"
        >
          #{{ tag }}
        </span>
        <span
          v-if="tags.length > limit"
          class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
          :title="tags.join(' #')"
        >
          +{{ tags.length - limit }}
        </span>
      </div>

      <!-- Details & Path -->
      <div class="space-y-1 text-xs text-zinc-500 dark:text-zinc-400">
        <div class="flex items-center gap-1 truncate font-mono text-[11px]">
          <UIcon
            name="i-lucide-folder"
            class="w-3.5 h-3.5 shrink-0 text-zinc-400"
          />
          <span
            class="truncate"
            :title="item.cwd"
          >{{ item.cwd || '默认工作区' }}</span>
        </div>

        <div class="flex items-center gap-3 text-zinc-400 dark:text-zinc-500 pt-1 text-[11px]">
          <span
            v-if="item.messageCount !== undefined"
            class="flex items-center gap-1"
          >
            <UIcon
              name="i-lucide-message-square"
              class="w-3 h-3"
            />
            {{ item.messageCount }}
          </span>
          <span
            v-if="item.model"
            class="flex items-center gap-1 truncate max-w-[130px] font-mono"
          >
            <UIcon
              name="i-lucide-cpu"
              class="w-3 h-3"
            />
            {{ item.model }}
          </span>
          <span
            v-if="item.cost !== undefined && item.cost > 0"
            class="font-mono"
          >
            ${{ item.cost.toFixed(4) }}
          </span>
          <span
            v-if="item.status"
            class="px-1 py-0.2 rounded bg-zinc-100 dark:bg-zinc-800 text-[10px] uppercase font-mono"
          >
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
          @click="emit('open')"
        >
          查看
        </UButton>
      </div>

      <div class="flex items-center gap-0.5">
        <UButton
          size="xs"
          variant="ghost"
          color="neutral"
          icon="i-lucide-edit-3"
          title="重命名 / 编辑"
          @click="emit('edit')"
        />
        <UButton
          size="xs"
          variant="ghost"
          color="error"
          icon="i-lucide-trash-2"
          title="删除会话"
          @click="emit('remove')"
        />
      </div>
    </div>
  </div>
</template>
