<script setup lang="ts">
/**
 * 会话详情页头部（从 app/pages/sessions/[id].vue 抽出，约 250 行）。
 *
 * 只做展示与事件上抛：诊断/工具分析状态通过组合式返回对象透传（与两个弹窗一致，
 * 避免为十几个 ref 逐个 defineProps 并维护两套类型），写操作统一走 `on*` 回调。
 */
import type { UnifiedSession } from '../../../server/utils/types'

const props = defineProps<{
  session?: UnifiedSession | null
  sessionId: string
  platform: string
  backUrl: string
  diag: ReturnType<typeof useSessionDiagnosis>
  tool: ReturnType<typeof useToolAnalytics>
  getPluginMeta: ReturnType<typeof usePlugins>['getPluginMeta']
  formatTime: (ts?: number) => string
  isRefreshing: boolean
  onRefresh: () => void | Promise<void>
  onExtractMemory: () => void
  onHarvest: () => void
  onEditTitle: () => void
}>()

const { efficiencyAnalysis, isEfficiencyModalOpen } = props.diag
const { toolStats, openToolDetails } = props.tool
</script>

<template>
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
              @click="onEditTitle"
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
          @click="onRefresh"
        >
          刷新
        </UButton>
        <UButton
          color="neutral"
          variant="solid"
          icon="i-lucide-brain"
          size="sm"
          title="提取通用架构决策、排坑经验并存入 Grafeo 记忆图谱"
          @click="onExtractMemory"
        >
          提炼记忆
        </UButton>
        <UButton
          color="neutral"
          variant="solid"
          icon="i-lucide-sparkles"
          size="sm"
          title="启动多维量化评估并沉淀高价值知识"
          @click="onHarvest"
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
</template>
