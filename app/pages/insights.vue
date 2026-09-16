<script setup lang="ts">
interface ToolCategoryStats {
  category: 'edit' | 'search_read' | 'command' | 'subagent' | 'mcp' | 'other'
  label: string
  icon: string
  color: string
  count: number
  percentage: number
}

interface PlatformStatItem {
  platform: string
  name: string
  count: number
  percentage: number
  messageCount: number
}

interface HotspotTagItem {
  tag: string
  count: number
  typeBreakdown: {
    adr: number
    gotcha: number
    pattern: number
    milestone: number
  }
}

interface HighValueSessionItem {
  id: string
  platform: string
  title: string
  cwd: string
  updatedAt: number
  score: number
  grade: 'S' | 'A' | 'B' | 'C'
  signals: string[]
  isVaultWorthy: boolean
}

interface InsightsData {
  summary: {
    totalSessions: number
    totalMessages: number
    totalThoughtCount: number
    totalThoughtChars: number
    avgThoughtsPerSession: string
    totalVaultItems: number
    vaultBreakdown: {
      total: number
      adr: number
      gotcha: number
      pattern: number
      milestone: number
    }
  }
  platforms: PlatformStatItem[]
  toolCategories: ToolCategoryStats[]
  totalToolCalls: number
  hotspotTags: HotspotTagItem[]
  highValueSessions: HighValueSessionItem[]
}

const isRefreshing = ref(false)

const { data: insightsRes, pending, refresh } = await useFetch<{
  success: boolean
  data: InsightsData
}>('/api/insights')

const insights = computed(() => insightsRes.value?.data)

const handleRefresh = async () => {
  isRefreshing.value = true
  await refresh()
  isRefreshing.value = false
}

const formatNumber = (num?: number) => {
  if (num === undefined || num === null) return '0'
  return new Intl.NumberFormat('zh-CN').format(num)
}

const formatTime = (ts?: number) => {
  if (!ts) return '-'
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const platformIcons: Record<string, string> = {
  pi: 'i-lucide-terminal',
  opencode: 'i-lucide-code-2',
  agy: 'i-lucide-sparkles',
  claude: 'i-lucide-bot',
  codex: 'i-lucide-cpu',
  workbuddy: 'i-lucide-briefcase',
  reasonix: 'i-lucide-brain-circuit',
  kimi: 'i-lucide-bot',
  trae: 'i-lucide-pen-tool',
  cursor: 'i-lucide-cursor-arrow',
  mimo: 'i-lucide-smartphone'
}

const colorClassMap: Record<string, { bar: string, text: string, bg: string }> = {
  blue: { bar: 'bg-blue-500', text: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-950/30' },
  emerald: { bar: 'bg-emerald-500', text: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-950/30' },
  purple: { bar: 'bg-purple-500', text: 'text-purple-500', bg: 'bg-purple-50 dark:bg-purple-950/30' },
  amber: { bar: 'bg-amber-500', text: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-950/30' },
  cyan: { bar: 'bg-cyan-500', text: 'text-cyan-500', bg: 'bg-cyan-50 dark:bg-cyan-950/30' },
  zinc: { bar: 'bg-zinc-500', text: 'text-zinc-500', bg: 'bg-zinc-50 dark:bg-zinc-800/30' }
}
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h1 class="text-xl font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
          <UIcon
            name="i-lucide-line-chart"
            class="w-6 h-6 text-blue-500"
          />
          会话洞察与效能大盘 (Session Insights)
        </h1>
        <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
          全方位量化分析 AI 辅助研发行为分布、工具使用画像、高频踩坑热点与高价值沉淀榜单
        </p>
      </div>

      <div class="flex items-center gap-2">
        <UButton
          size="xs"
          variant="outline"
          color="neutral"
          icon="i-lucide-refresh-cw"
          :loading="isRefreshing"
          @click="handleRefresh"
        >
          刷新数据
        </UButton>
      </div>
    </div>

    <!-- Loading State -->
    <div
      v-if="pending"
      class="py-20 text-center text-zinc-400"
    >
      <UIcon
        name="i-lucide-loader-2"
        class="w-8 h-8 animate-spin mx-auto mb-3 text-blue-500"
      />
      <p class="text-xs font-medium">
        正在聚合全局会话指标与知识资产...
      </p>
    </div>

    <!-- Main Content -->
    <div
      v-else-if="insights"
      class="space-y-6"
    >
      <!-- 1. KPI Top Summary Grid -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <!-- Sessions Count -->
        <div class="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 shadow-xs">
          <div class="flex items-center justify-between text-zinc-400 mb-2">
            <span class="text-xs font-medium">管理会话总数</span>
            <UIcon
              name="i-lucide-messages-square"
              class="w-4 h-4 text-blue-500"
            />
          </div>
          <div class="text-2xl font-bold font-mono text-zinc-900 dark:text-zinc-100">
            {{ formatNumber(insights.summary.totalSessions) }}
          </div>
          <p class="text-[11px] text-zinc-400 mt-1">
            覆盖 {{ insights.platforms.length }} 个主流 CLI 与智能体
          </p>
        </div>

        <!-- Total Messages -->
        <div class="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 shadow-xs">
          <div class="flex items-center justify-between text-zinc-400 mb-2">
            <span class="text-xs font-medium">累计交互消息</span>
            <UIcon
              name="i-lucide-message-circle"
              class="w-4 h-4 text-purple-500"
            />
          </div>
          <div class="text-2xl font-bold font-mono text-zinc-900 dark:text-zinc-100">
            {{ formatNumber(insights.summary.totalMessages) }}
          </div>
          <p class="text-[11px] text-zinc-400 mt-1">
            平均每会话 {{ insights.summary.totalSessions > 0 ? Math.round(insights.summary.totalMessages / insights.summary.totalSessions) : 0 }} 轮多轮交互
          </p>
        </div>

        <!-- Thought Decisions -->
        <div class="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 shadow-xs">
          <div class="flex items-center justify-between text-zinc-400 mb-2">
            <span class="text-xs font-medium">深度思考决策点</span>
            <UIcon
              name="i-lucide-brain"
              class="w-4 h-4 text-amber-500"
            />
          </div>
          <div class="text-2xl font-bold font-mono text-zinc-900 dark:text-zinc-100">
            {{ formatNumber(insights.summary.totalThoughtCount) }}
          </div>
          <p class="text-[11px] text-zinc-400 mt-1">
            累计 {{ formatNumber(Math.round(insights.summary.totalThoughtChars / 1000)) }}k 字符推理链路
          </p>
        </div>

        <!-- Vault Items -->
        <div class="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 shadow-xs">
          <div class="flex items-center justify-between text-zinc-400 mb-2">
            <span class="text-xs font-medium">知识金库资产</span>
            <UIcon
              name="i-lucide-gem"
              class="w-4 h-4 text-emerald-500"
            />
          </div>
          <div class="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
            {{ formatNumber(insights.summary.totalVaultItems) }}
          </div>
          <p class="text-[11px] text-zinc-400 mt-1">
            {{ insights.summary.vaultBreakdown.adr }} ADR · {{ insights.summary.vaultBreakdown.gotcha }} 避坑 · {{ insights.summary.vaultBreakdown.pattern }} 模式
          </p>
        </div>
      </div>

      <!-- 2. Two-Column Analytics: Tools Breakdown & Platform Distribution -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <!-- Tool Usage Breakdown (7 cols) -->
        <div class="lg:col-span-7 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between pb-3 border-b border-zinc-100 dark:border-zinc-800/80 mb-4">
              <div class="flex items-center gap-2">
                <div class="w-7 h-7 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                  <UIcon
                    name="i-lucide-wrench"
                    class="w-4 h-4"
                  />
                </div>
                <div>
                  <h2 class="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                    AI 研发工具使用画像 (Tool Invocation Radar)
                  </h2>
                  <p class="text-[11px] text-zinc-400">
                    基于活跃会话的工具调用分类与执行频率分布
                  </p>
                </div>
              </div>
              <span class="text-xs font-mono text-zinc-400">
                总计 {{ formatNumber(insights.totalToolCalls) }} 次调用
              </span>
            </div>

            <!-- Categories Progress List -->
            <div class="space-y-3.5">
              <div
                v-for="cat in insights.toolCategories"
                :key="cat.category"
                class="space-y-1.5"
              >
                <div class="flex items-center justify-between text-xs">
                  <span class="font-medium text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">
                    <UIcon
                      :name="cat.icon"
                      class="w-3.5 h-3.5"
                      :class="colorClassMap[cat.color]?.text || 'text-zinc-400'"
                    />
                    {{ cat.label }}
                  </span>
                  <span class="font-mono text-zinc-500 dark:text-zinc-400 text-[11px]">
                    {{ formatNumber(cat.count) }} 次 ({{ cat.percentage }}%)
                  </span>
                </div>
                <!-- Progress Bar -->
                <div class="w-full bg-zinc-100 dark:bg-zinc-800 h-2 rounded-full overflow-hidden">
                  <div
                    class="h-full rounded-full transition-all duration-500"
                    :class="colorClassMap[cat.color]?.bar || 'bg-blue-500'"
                    :style="{ width: `${cat.percentage}%` }"
                  />
                </div>
              </div>
            </div>
          </div>

          <div class="mt-5 pt-3 border-t border-zinc-100 dark:border-zinc-800/60 text-[11px] text-zinc-400 flex items-center justify-between">
            <span>💡 观察：检索排障与代码修改构成了 AI 研发的核心双循环</span>
            <NuxtLink
              to="/search"
              class="text-blue-500 hover:underline flex items-center gap-1"
            >
              探索全文检索 <UIcon
                name="i-lucide-arrow-right"
                class="w-3 h-3"
              />
            </NuxtLink>
          </div>
        </div>

        <!-- Platform Distribution (5 cols) -->
        <div class="lg:col-span-5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between pb-3 border-b border-zinc-100 dark:border-zinc-800/80 mb-4">
              <div class="flex items-center gap-2">
                <div class="w-7 h-7 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center">
                  <UIcon
                    name="i-lucide-layout-grid"
                    class="w-4 h-4"
                  />
                </div>
                <div>
                  <h2 class="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                    平台接入矩阵 (Platform Matrix)
                  </h2>
                  <p class="text-[11px] text-zinc-400">
                    各客户端会话沉淀与活跃分布
                  </p>
                </div>
              </div>
            </div>

            <div class="space-y-2.5">
              <div
                v-for="item in insights.platforms.slice(0, 6)"
                :key="item.platform"
                class="flex items-center justify-between p-2 rounded-lg bg-zinc-50 dark:bg-zinc-850/60 border border-zinc-100 dark:border-zinc-800/60"
              >
                <div class="flex items-center gap-2">
                  <UIcon
                    :name="platformIcons[item.platform] || 'i-lucide-box'"
                    class="w-4 h-4 text-zinc-500"
                  />
                  <span class="text-xs font-medium text-zinc-800 dark:text-zinc-200">{{ item.name }}</span>
                </div>
                <div class="flex items-center gap-3">
                  <span class="text-[11px] font-mono text-zinc-400">{{ item.messageCount }} msgs</span>
                  <span class="text-xs font-mono font-bold text-zinc-700 dark:text-zinc-300">{{ item.count }} 篇</span>
                  <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-200/60 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300">
                    {{ item.percentage }}%
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div class="mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800/60 flex items-center justify-between text-[11px] text-zinc-400">
            <span>支持 11+ 种 AI 编程工具与 CLI</span>
            <NuxtLink
              to="/mcp"
              class="text-purple-500 hover:underline flex items-center gap-1"
            >
              配置 MCP 集成 <UIcon
                name="i-lucide-arrow-right"
                class="w-3 h-3"
              />
            </NuxtLink>
          </div>
        </div>
      </div>

      <!-- 3. Gotchas & Problem Hotspots (避坑与排障热点云) -->
      <div class="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-xs">
        <div class="flex items-center justify-between pb-3 border-b border-zinc-100 dark:border-zinc-800/80 mb-4">
          <div class="flex items-center gap-2">
            <div class="w-7 h-7 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <UIcon
                name="i-lucide-flame"
                class="w-4 h-4"
              />
            </div>
            <div>
              <h2 class="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                技术避坑与高频热点 (Gotcha & Topic Hotspots)
              </h2>
              <p class="text-[11px] text-zinc-400">
                从知识金库与历史会话中提炼的高频踩坑与核心架构领域标签
              </p>
            </div>
          </div>
          <NuxtLink
            to="/knowledge"
            class="text-xs text-amber-600 dark:text-amber-400 hover:underline flex items-center gap-1"
          >
            查看知识金库 <UIcon
              name="i-lucide-arrow-right"
              class="w-3 h-3"
            />
          </NuxtLink>
        </div>

        <div
          v-if="insights.hotspotTags.length"
          class="flex flex-wrap gap-2.5"
        >
          <div
            v-for="item in insights.hotspotTags"
            :key="item.tag"
            class="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-850/60 hover:border-amber-500/40 transition-all text-xs"
          >
            <span class="font-mono font-medium text-zinc-800 dark:text-zinc-200">#{{ item.tag }}</span>
            <span class="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold">
              {{ item.count }}
            </span>
            <div class="flex items-center gap-1 text-[9px] text-zinc-400 font-mono">
              <span v-if="item.typeBreakdown.adr">A:{{ item.typeBreakdown.adr }}</span>
              <span v-if="item.typeBreakdown.gotcha">G:{{ item.typeBreakdown.gotcha }}</span>
              <span v-if="item.typeBreakdown.pattern">P:{{ item.typeBreakdown.pattern }}</span>
            </div>
          </div>
        </div>
        <div
          v-else
          class="py-8 text-center text-xs text-zinc-400"
        >
          暂无标签沉淀，前往会话详情页一键「沉淀资产」即可在此生成技术热点分析
        </div>
      </div>

      <!-- 4. High-Value Sessions Leaderboard (高价值会话精选榜) -->
      <div class="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-xs">
        <div class="flex items-center justify-between pb-3 border-b border-zinc-100 dark:border-zinc-800/80 mb-4">
          <div class="flex items-center gap-2">
            <div class="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <UIcon
                name="i-lucide-trophy"
                class="w-4 h-4"
              />
            </div>
            <div>
              <h2 class="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                高价值会话精选榜 (High-Value Sessions)
              </h2>
              <p class="text-[11px] text-zinc-400">
                经 ValueScoringEngine 量化打分达到入库标准（≥70分）的优质开发会话
              </p>
            </div>
          </div>
          <NuxtLink
            to="/distill"
            class="text-xs text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1"
          >
            前往批量提炼 <UIcon
              name="i-lucide-arrow-right"
              class="w-3 h-3"
            />
          </NuxtLink>
        </div>

        <div
          v-if="insights.highValueSessions.length"
          class="divide-y divide-zinc-100 dark:divide-zinc-800/70"
        >
          <div
            v-for="s in insights.highValueSessions"
            :key="s.id"
            class="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-zinc-50/50 dark:hover:bg-zinc-850/30 transition-all rounded-lg px-2 -mx-2"
          >
            <div class="space-y-1">
              <div class="flex items-center gap-2">
                <span
                  :class="[
                    'px-2 py-0.5 rounded font-mono font-bold text-xs',
                    s.grade === 'S' ? 'bg-emerald-500 text-white'
                    : s.grade === 'A' ? 'bg-blue-500 text-white'
                      : 'bg-amber-500 text-white'
                  ]"
                >
                  {{ s.grade }} ({{ s.score }}分)
                </span>
                <span class="text-xs font-semibold text-zinc-900 dark:text-zinc-100">{{ s.title }}</span>
              </div>
              <div class="flex items-center gap-3 text-[11px] text-zinc-400 font-mono">
                <span class="flex items-center gap-1">
                  <UIcon
                    :name="platformIcons[s.platform] || 'i-lucide-box'"
                    class="w-3.5 h-3.5"
                  />
                  {{ s.platform }}
                </span>
                <span>{{ formatTime(s.updatedAt) }}</span>
                <span class="truncate max-w-xs">{{ s.cwd }}</span>
              </div>
            </div>

            <div class="flex items-center gap-2">
              <NuxtLink
                :to="`/sessions/${s.id}?cli=${s.platform}`"
                class="px-2.5 py-1 text-xs font-medium rounded-md bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 transition-all flex items-center gap-1"
              >
                查看会话 <UIcon
                  name="i-lucide-external-link"
                  class="w-3 h-3"
                />
              </NuxtLink>
            </div>
          </div>
        </div>
        <div
          v-else
          class="py-8 text-center text-xs text-zinc-400"
        >
          暂无已评估的高分会话。在会话详情页点击「沉淀资产」或进行效能评估后，高分会话将自动收录于此。
        </div>
      </div>
    </div>
  </div>
</template>
