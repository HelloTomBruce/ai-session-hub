<script setup lang="ts">
import type { MemoryGraphItem, GraphVisualizationData } from '../../server/utils/memory-types'

const viewMode = ref<'cards' | 'graph'>('cards')
const selectedType = ref('all')
const searchQuery = ref('')
const selectedProject = ref('all')

const isDetailOpen = ref(false)
const currentItem = ref<MemoryGraphItem | null>(null)
const isCreateOpen = ref(false)
const copySuccess = ref(false)

const toast = useToast()
const { confirm } = useConfirm()

// 获取记忆列表
const { data: memoryData, refresh: refreshList } = await useFetch('/api/memory', {
  query: computed(() => ({
    type: selectedType.value !== 'all' ? selectedType.value : undefined,
    project: selectedProject.value !== 'all' ? selectedProject.value : undefined,
    search: searchQuery.value.trim() || undefined
  }))
})

// 获取拓扑图谱数据
const { data: graphDataRes, refresh: refreshGraph } = await useFetch('/api/memory/graph', {
  query: computed(() => ({
    type: selectedType.value !== 'all' ? selectedType.value : undefined,
    project: selectedProject.value !== 'all' ? selectedProject.value : undefined
  }))
})

// 获取知识图谱元数据（动态类型与项目列表）
const { data: metaData, refresh: refreshMeta } = await useFetch('/api/memory/meta')

const memories = computed<MemoryGraphItem[]>(() => memoryData.value?.items || [])
const totalCount = computed(() => metaData.value?.data?.total ?? memoryData.value?.total ?? 0)
const graphData = computed<GraphVisualizationData>(() => graphDataRes.value?.data || { nodes: [], edges: [] })

// 统计计算
const adrCount = computed(() => metaData.value?.data?.types?.find(t => t.name === 'ADR')?.count || memories.value.filter(m => m.type === 'ADR').length)
const gotchaCount = computed(() => metaData.value?.data?.types?.find(t => t.name === 'Gotcha')?.count || memories.value.filter(m => m.type === 'Gotcha').length)
const bestPracticeCount = computed(() => metaData.value?.data?.types?.find(t => t.name === 'BestPractice')?.count || memories.value.filter(m => m.type === 'BestPractice').length)

// 提取所有项目
const allProjects = computed(() => {
  const metaProjects = metaData.value?.data?.projects || []
  if (metaProjects.length > 0) {
    return metaProjects.map(p => p.name)
  }
  const pSet = new Set<string>()
  for (const m of memories.value) {
    for (const p of m.projects || []) {
      if (p.name) pSet.add(p.name)
    }
  }
  return Array.from(pSet)
})

// 预设类型的展示图标与颜色映射
const presetMetaMap: Record<string, { label: string, icon: string, color: string }> = {
  ADR: { label: '架构决策 (ADR)', icon: 'i-lucide-shield-check', color: 'blue' },
  Gotcha: { label: '避坑指南 (Gotcha)', icon: 'i-lucide-alert-triangle', color: 'amber' },
  BestPractice: { label: '最佳实践 (BestPractice)', icon: 'i-lucide-award', color: 'emerald' },
  Pattern: { label: '设计范式 (Pattern)', icon: 'i-lucide-box', color: 'purple' },
  Workflow: { label: '工作流 (Workflow)', icon: 'i-lucide-git-merge', color: 'indigo' },
  Config: { label: '配置环境 (Config)', icon: 'i-lucide-settings', color: 'cyan' },
  Security: { label: '安全规约 (Security)', icon: 'i-lucide-lock', color: 'rose' },
  Performance: { label: '性能调优 (Performance)', icon: 'i-lucide-zap', color: 'pink' },
  ApiSpec: { label: '接口契约 (ApiSpec)', icon: 'i-lucide-code-2', color: 'indigo' }
}

// 动态类型过滤列表（包含预设与数据库中已存在的所有自定义类型）
const typeFilters = computed(() => {
  const dbTypes = metaData.value?.data?.types || []
  const filterList = [
    { label: '全部记忆', value: 'all', icon: 'i-lucide-layers', count: totalCount.value }
  ]

  for (const t of dbTypes) {
    const meta = presetMetaMap[t.name]
    filterList.push({
      label: meta ? meta.label : t.name,
      value: t.name,
      icon: meta?.icon || 'i-lucide-tag',
      count: t.count
    })
  }

  return filterList
})

function getTypeBadgeColor(type: string) {
  switch (type) {
    case 'ADR': return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800'
    case 'Gotcha': return 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800'
    case 'BestPractice': return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800'
    case 'Pattern': return 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-200 dark:border-purple-800'
    case 'Workflow': return 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800'
    case 'Config': return 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-200 dark:border-cyan-800'
    default: return 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700'
  }
}

function openDetail(item: MemoryGraphItem) {
  currentItem.value = item
  isDetailOpen.value = true
}

async function deleteItem(id: string) {
  if (!await confirm({ title: '确定要从 Grafeo 图谱中永久删除此条记忆吗？', danger: true, confirmLabel: '删除' })) return
  try {
    await $fetch(`/api/memory/${id}`, { method: 'DELETE' })
    if (currentItem.value?.id === id) {
      isDetailOpen.value = false
    }
    toast.add({ title: '已从 Grafeo 图数据库删除该条记忆', color: 'success', icon: 'i-lucide-check-circle-2' })
    refreshList()
    refreshGraph()
    refreshMeta()
  } catch (err) {
    toast.add({ title: `删除失败: ${err instanceof Error ? err.message : String(err)}`, color: 'error', icon: 'i-lucide-alert-triangle' })
  }
}

async function copyMarkdown(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    copySuccess.value = true
    setTimeout(() => {
      copySuccess.value = false
    }, 2000)
  } catch {
    toast.add({ title: '复制失败', color: 'error' })
  }
}

// 简易手动创建记忆表单
const newMemoryForm = ref<Partial<MemoryGraphItem>>({
  title: '',
  type: 'BestPractice',
  summary: '',
  content: '',
  confidence: 90,
  tags: [],
  projects: [],
  techConcepts: []
})

async function submitManualMemory() {
  if (!newMemoryForm.value.title || !newMemoryForm.value.content) {
    toast.add({ title: '标题与内容不能为空', color: 'error' })
    return
  }
  try {
    await $fetch('/api/memory', {
      method: 'POST',
      body: newMemoryForm.value
    })
    toast.add({ title: '记忆已保存至 Grafeo 图库', color: 'success' })
    isCreateOpen.value = false
    newMemoryForm.value = {
      title: '',
      type: 'BestPractice',
      summary: '',
      content: '',
      confidence: 90,
      tags: [],
      projects: [],
      techConcepts: []
    }
    refreshList()
    refreshGraph()
    refreshMeta()
  } catch (err) {
    toast.add({ title: `保存失败: ${err instanceof Error ? err.message : String(err)}`, color: 'error' })
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- Header Banner -->
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-zinc-900 p-6 rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 shadow-xs">
      <div>
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-violet-500/10 dark:bg-violet-500/20 text-violet-600 dark:text-violet-400 flex items-center justify-center">
            <UIcon
              name="i-lucide-brain"
              class="w-5 h-5"
            />
          </div>
          <div>
            <div class="flex items-center gap-2">
              <h1 class="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                记忆图谱中心 (Memory Hub)
              </h1>
              <span class="text-xs px-2 py-0.5 rounded-full font-mono font-medium bg-violet-100 dark:bg-violet-950/60 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800">
                Grafeo Graph DB
              </span>
            </div>
            <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              从日常会话中沉淀出的高复用架构决策、排坑避坑与技术拓扑，解耦会话独立存续并支持 MCP 智能召回
            </p>
          </div>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <div class="flex items-center bg-zinc-100 dark:bg-zinc-800 p-0.5 rounded-lg border border-zinc-200/80 dark:border-zinc-700/80">
          <button
            class="px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer"
            :class="viewMode === 'cards' ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'"
            @click="viewMode = 'cards'"
          >
            <UIcon
              name="i-lucide-layout-grid"
              class="w-3.5 h-3.5 inline-block mr-1"
            />
            卡片视图
          </button>
          <button
            class="px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer"
            :class="viewMode === 'graph' ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'"
            @click="viewMode = 'graph'"
          >
            <UIcon
              name="i-lucide-share-2"
              class="w-3.5 h-3.5 inline-block mr-1"
            />
            拓扑图谱
          </button>
        </div>

        <UButton
          color="primary"
          icon="i-lucide-plus"
          size="sm"
          @click="isCreateOpen = true"
        >
          手动新增
        </UButton>
      </div>
    </div>

    <!-- Stats Bar -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div class="bg-white dark:bg-zinc-900 p-4 rounded-xl border border-zinc-200/80 dark:border-zinc-800/80">
        <div class="text-xs text-zinc-500 dark:text-zinc-400 font-medium">
          总沉淀记忆
        </div>
        <div class="text-2xl font-bold font-mono text-zinc-900 dark:text-zinc-100 mt-1">
          {{ totalCount }}
        </div>
      </div>
      <div class="bg-white dark:bg-zinc-900 p-4 rounded-xl border border-zinc-200/80 dark:border-zinc-800/80">
        <div class="text-xs text-blue-500 font-medium flex items-center gap-1">
          <UIcon
            name="i-lucide-shield-check"
            class="w-3.5 h-3.5"
          />
          <span>架构决策 (ADR)</span>
        </div>
        <div class="text-2xl font-bold font-mono text-blue-600 dark:text-blue-400 mt-1">
          {{ adrCount }}
        </div>
      </div>
      <div class="bg-white dark:bg-zinc-900 p-4 rounded-xl border border-zinc-200/80 dark:border-zinc-800/80">
        <div class="text-xs text-amber-500 font-medium flex items-center gap-1">
          <UIcon
            name="i-lucide-alert-triangle"
            class="w-3.5 h-3.5"
          />
          <span>避坑指南 (Gotcha)</span>
        </div>
        <div class="text-2xl font-bold font-mono text-amber-600 dark:text-amber-400 mt-1">
          {{ gotchaCount }}
        </div>
      </div>
      <div class="bg-white dark:bg-zinc-900 p-4 rounded-xl border border-zinc-200/80 dark:border-zinc-800/80">
        <div class="text-xs text-emerald-500 font-medium flex items-center gap-1">
          <UIcon
            name="i-lucide-award"
            class="w-3.5 h-3.5"
          />
          <span>最佳实践 (BestPractice)</span>
        </div>
        <div class="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-1">
          {{ bestPracticeCount }}
        </div>
      </div>
    </div>

    <!-- Filters & Search Toolbar -->
    <div class="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-white dark:bg-zinc-900 p-3 rounded-xl border border-zinc-200/80 dark:border-zinc-800/80">
      <div class="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
        <button
          v-for="filter in typeFilters"
          :key="filter.value"
          class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer"
          :class="selectedType === filter.value ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 shadow-xs' : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'"
          @click="selectedType = filter.value"
        >
          <UIcon
            :name="filter.icon"
            class="w-3.5 h-3.5"
          />
          <span>{{ filter.label }}</span>
          <span
            v-if="typeof filter.count === 'number' && filter.count > 0"
            class="ml-0.5 px-1.5 py-0.2 rounded-full text-[10px] font-mono"
            :class="selectedType === filter.value ? 'bg-white/20 text-white dark:bg-zinc-900/40 dark:text-zinc-900' : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300'"
          >
            {{ filter.count }}
          </span>
        </button>
      </div>

      <div class="flex items-center gap-2">
        <!-- Project Filter Dropdown if projects exist -->
        <select
          v-if="allProjects.length > 0"
          v-model="selectedProject"
          class="text-xs px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-mono"
        >
          <option value="all">
            所有项目
          </option>
          <option
            v-for="p in allProjects"
            :key="p"
            :value="p"
          >
            {{ p }}
          </option>
        </select>

        <div class="relative w-full md:w-64">
          <UInput
            v-model="searchQuery"
            placeholder="搜索记忆、技术栈、问题..."
            icon="i-lucide-search"
            size="sm"
            class="w-full text-xs"
          />
        </div>
      </div>
    </div>

    <!-- Main View 1: Card List View -->
    <div v-if="viewMode === 'cards'">
      <div
        v-if="memories.length === 0"
        class="text-center py-16 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 space-y-3"
      >
        <div class="w-12 h-12 mx-auto rounded-2xl bg-zinc-100 dark:bg-zinc-800 text-zinc-400 flex items-center justify-center">
          <UIcon
            name="i-lucide-brain"
            class="w-6 h-6"
          />
        </div>
        <h3 class="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          暂无符合条件的记忆记录
        </h3>
        <p class="text-xs text-zinc-400 max-w-sm mx-auto">
          进入任意会话详情页，点击右上角「提炼记忆」，即可由 AI 自动泛化沉淀架构决策与避坑指南。
        </p>
      </div>

      <div
        v-else
        class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
      >
        <div
          v-for="item in memories"
          :key="item.id"
          class="group bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200/80 dark:border-zinc-800/80 p-4 hover:border-violet-400/80 dark:hover:border-violet-600/80 hover:shadow-md transition-all cursor-pointer flex flex-col justify-between space-y-3"
          @click="openDetail(item)"
        >
          <div class="space-y-2">
            <!-- Type & Meta Badges -->
            <div class="flex items-center justify-between gap-2">
              <span
                class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-medium border"
                :class="getTypeBadgeColor(item.type)"
              >
                <span>{{ item.type }}</span>
              </span>
              <span class="text-[10px] text-zinc-400 font-mono">
                {{ new Date(item.updatedAt).toLocaleDateString() }}
              </span>
            </div>

            <!-- Title -->
            <h3 class="text-sm font-bold text-zinc-900 dark:text-zinc-100 line-clamp-2 group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors">
              {{ item.title }}
            </h3>

            <!-- Summary -->
            <p class="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-3 leading-relaxed">
              {{ item.summary || item.content }}
            </p>
          </div>

          <!-- Entity Chips -->
          <div class="space-y-2 pt-2 border-t border-zinc-100 dark:border-zinc-800/60">
            <!-- Tech concepts -->
            <div
              v-if="item.techConcepts && item.techConcepts.length > 0"
              class="flex flex-wrap gap-1"
            >
              <span
                v-for="tech in item.techConcepts.slice(0, 3)"
                :key="tech.name"
                class="px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800/60"
              >
                {{ tech.name }}
              </span>
              <span
                v-if="item.techConcepts.length > 3"
                class="text-[10px] text-zinc-400 font-mono self-center"
              >
                +{{ item.techConcepts.length - 3 }}
              </span>
            </div>

            <!-- Projects -->
            <div
              v-if="item.projects && item.projects.length > 0"
              class="flex items-center gap-1 text-[11px] text-zinc-400 font-mono"
            >
              <UIcon
                name="i-lucide-folder"
                class="w-3 h-3 text-zinc-400 shrink-0"
              />
              <span class="truncate">{{ item.projects.map(p => p.name).join(', ') }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Main View 2: Graph Topology View -->
    <div
      v-else
      class="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 p-6 min-h-[500px] flex flex-col items-center justify-center"
    >
      <div class="w-full h-full space-y-4">
        <div class="flex items-center justify-between">
          <div class="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-3">
            <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-violet-500 inline-block" /> 记忆节点 (:Memory)</span>
            <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" /> 项目节点 (:Project)</span>
            <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> 技术概念 (:TechConcept)</span>
            <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block" /> 痛点异常 (:Problem)</span>
          </div>
          <span class="text-xs font-mono text-zinc-400">
            {{ graphData.nodes.length }} 节点 • {{ graphData.edges.length }} 拓扑关系
          </span>
        </div>

        <!-- Graph Canvas / Visual Representation -->
        <div class="relative w-full h-96 bg-zinc-50 dark:bg-zinc-950/60 rounded-xl border border-zinc-200/80 dark:border-zinc-800/80 overflow-hidden flex items-center justify-center p-4">
          <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 w-full h-full overflow-y-auto p-2">
            <div
              v-for="node in graphData.nodes"
              :key="node.id"
              class="p-3 rounded-lg border text-xs flex flex-col justify-between shadow-xs transition-transform hover:scale-102"
              :style="{ borderColor: (node.color || '#64748b') + '66', backgroundColor: (node.color || '#64748b') + '15' }"
            >
              <div class="flex items-center justify-between gap-1">
                <span
                  class="font-mono text-[10px] px-1.5 py-0.2 rounded font-semibold"
                  :style="{ color: node.color || '#64748b' }"
                >
                  {{ node.label }}
                </span>
                <span
                  v-if="node.type"
                  class="text-[10px] font-mono text-zinc-400"
                >{{ node.type }}</span>
              </div>
              <div class="font-bold text-zinc-900 dark:text-zinc-100 mt-1.5 line-clamp-2">
                {{ node.name }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Detail Drawer / Modal -->
    <UModal
      :open="isDetailOpen"
      class="max-w-3xl"
      :ui="{ content: 'max-w-3xl sm:max-w-3xl' }"
      @update:open="isDetailOpen = $event"
    >
      <template #content>
        <div
          v-if="currentItem"
          class="p-6 space-y-5"
        >
          <!-- Detail Header -->
          <div class="flex items-start justify-between gap-4 border-b border-zinc-200 dark:border-zinc-800 pb-4">
            <div class="space-y-1.5">
              <div class="flex items-center gap-2">
                <span
                  class="px-2.5 py-0.5 rounded-md text-xs font-mono font-semibold border"
                  :class="getTypeBadgeColor(currentItem.type)"
                >
                  {{ currentItem.type }}
                </span>
                <span class="text-xs text-zinc-400 font-mono">
                  更新于: {{ new Date(currentItem.updatedAt).toLocaleString() }}
                </span>
              </div>
              <h2 class="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                {{ currentItem.title }}
              </h2>
            </div>
            <UButton
              color="neutral"
              variant="ghost"
              icon="i-lucide-x"
              size="sm"
              @click="isDetailOpen = false"
            />
          </div>

          <!-- Summary -->
          <div class="p-3.5 rounded-xl bg-violet-50/50 dark:bg-violet-950/20 border border-violet-200/60 dark:border-violet-800/60 text-xs text-violet-900 dark:text-violet-200 leading-relaxed font-medium">
            {{ currentItem.summary }}
          </div>

          <!-- Topology Entities Badges -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <!-- Tech Concepts -->
            <div
              v-if="currentItem.techConcepts && currentItem.techConcepts.length > 0"
              class="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800/80 space-y-1.5"
            >
              <div class="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
                关联技术概念 (:TechConcept)
              </div>
              <div class="flex flex-wrap gap-1.5">
                <span
                  v-for="t in currentItem.techConcepts"
                  :key="t.name"
                  class="px-2 py-0.5 rounded text-xs font-mono bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                >
                  {{ t.name }}
                </span>
              </div>
            </div>

            <!-- Projects -->
            <div
              v-if="currentItem.projects && currentItem.projects.length > 0"
              class="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800/80 space-y-1.5"
            >
              <div class="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
                适用项目上下文 (:Project)
              </div>
              <div class="space-y-1">
                <div
                  v-for="p in currentItem.projects"
                  :key="p.name"
                  class="text-xs font-mono text-zinc-700 dark:text-zinc-300"
                >
                  <span class="font-bold text-blue-600 dark:text-blue-400">{{ p.name }}</span>
                  <span
                    v-if="p.cwd"
                    class="text-zinc-400 text-[11px] block truncate"
                  >{{ p.cwd }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Markdown Content -->
          <div class="space-y-1.5">
            <div class="flex items-center justify-between text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              <span>详细方案与规约 (Markdown)</span>
              <button
                class="text-xs text-violet-600 dark:text-violet-400 hover:underline cursor-pointer flex items-center gap-1"
                @click="copyMarkdown(currentItem.content)"
              >
                <UIcon
                  :name="copySuccess ? 'i-lucide-check' : 'i-lucide-copy'"
                  class="w-3.5 h-3.5"
                />
                <span>{{ copySuccess ? '已复制' : '复制全文' }}</span>
              </button>
            </div>
            <div class="p-4 rounded-xl bg-zinc-900 text-zinc-100 font-mono text-xs max-h-72 overflow-y-auto whitespace-pre-wrap leading-relaxed border border-zinc-800">
              {{ currentItem.content }}
            </div>
          </div>

          <!-- Footer Actions -->
          <div class="flex items-center justify-between pt-4 border-t border-zinc-200 dark:border-zinc-800">
            <UButton
              color="error"
              variant="ghost"
              icon="i-lucide-trash-2"
              size="sm"
              @click="deleteItem(currentItem.id)"
            >
              删除记忆
            </UButton>
            <UButton
              color="neutral"
              variant="outline"
              size="sm"
              @click="isDetailOpen = false"
            >
              关闭
            </UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- Manual Create Memory Modal -->
    <UModal
      :open="isCreateOpen"
      class="max-w-2xl"
      :ui="{ content: 'max-w-2xl sm:max-w-2xl' }"
      @update:open="isCreateOpen = $event"
    >
      <template #content>
        <div class="p-6 space-y-4">
          <div class="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-3">
            <h3 class="text-base font-bold text-zinc-900 dark:text-zinc-100">
              手动新增经验记忆 (Grafeo)
            </h3>
            <UButton
              color="neutral"
              variant="ghost"
              icon="i-lucide-x"
              size="sm"
              @click="isCreateOpen = false"
            />
          </div>

          <div class="space-y-3 text-xs">
            <div class="space-y-1">
              <label class="font-semibold text-zinc-700 dark:text-zinc-300">记忆标题</label>
              <UInput
                v-model="newMemoryForm.title"
                placeholder="例如：Nuxt 3 中 Grafeo 模块集成规范"
                class="w-full text-xs"
              />
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div class="space-y-1">
                <label class="font-semibold text-zinc-700 dark:text-zinc-300">类型 (Type)</label>
                <UInput
                  v-model="newMemoryForm.type"
                  placeholder="ADR / Gotcha / BestPractice"
                  class="w-full text-xs"
                />
              </div>
              <div class="space-y-1">
                <label class="font-semibold text-zinc-700 dark:text-zinc-300">一句话摘要</label>
                <UInput
                  v-model="newMemoryForm.summary"
                  placeholder="核心要点"
                  class="w-full text-xs"
                />
              </div>
            </div>

            <div class="space-y-1">
              <label class="font-semibold text-zinc-700 dark:text-zinc-300">详细内容 (Markdown)</label>
              <UTextarea
                v-model="newMemoryForm.content"
                :rows="5"
                placeholder="详细方案与经验..."
                class="w-full text-xs font-mono"
              />
            </div>
          </div>

          <div class="flex justify-end gap-2 pt-3 border-t border-zinc-200 dark:border-zinc-800">
            <UButton
              color="neutral"
              variant="outline"
              size="sm"
              @click="isCreateOpen = false"
            >
              取消
            </UButton>
            <UButton
              color="primary"
              size="sm"
              icon="i-lucide-save"
              @click="submitManualMemory"
            >
              存入图库
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
