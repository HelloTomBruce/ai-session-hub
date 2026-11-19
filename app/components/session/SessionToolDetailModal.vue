<script setup lang="ts">
/**
 * 工具调用明细弹窗（从 app/pages/sessions/[id].vue 抽出）。
 *
 * 直接把 useToolAnalytics 的返回对象透传进来，避免 5 个 ref 逐个 defineProps：
 * 组合式返回的都是稳定 ref，解构后在模板里仍是响应式的。
 */
import type { useToolAnalytics } from '../../composables/useToolAnalytics'

const props = defineProps<{
  tool: ReturnType<typeof useToolAnalytics>
  formatTime: (ts?: number) => string
}>()

const { isToolModalOpen, selectedToolName, selectedToolCalls } = props.tool
</script>

<template>
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
</template>
