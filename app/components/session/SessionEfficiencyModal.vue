<script setup lang="ts">
/**
 * 会话效能诊断弹窗（从 app/pages/sessions/[id].vue 抽出，原 306 行模板）。
 *
 * 诊断状态全部由 useSessionDiagnosis 持有，这里只透传它的返回对象：
 * 弹窗内的流式文本、流式进度、维度得分、摩擦事件与「重新诊断」按钮都作用于同一份状态。
 */
import type { useSessionDiagnosis } from '../../composables/useSessionDiagnosis'

const props = defineProps<{
  diag: ReturnType<typeof useSessionDiagnosis>
}>()

const {
  isEfficiencyModalOpen,
  isDiagnosing,
  aiDiagnosisResult,
  diagnoseStatus,
  diagnoseStreamText,
  efficiencyAnalysis,
  runAIDiagnosis
} = props.diag
</script>

<template>
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
</template>
