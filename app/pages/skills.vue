<script setup lang="ts">
interface UnifiedSkill {
  id: string
  name: string
  description: string
  platform: string
  platformName: string
  category: 'universal' | 'system' | 'custom' | 'symlink' | 'plugin'
  rawLocation: string
  skillDir: string
  isSymlink: boolean
  symlinkTarget?: string
  isBuiltin?: boolean
  version?: string
  sourceUrl?: string
  tags?: string[]
  enabledIn?: string[]
}

interface SkillDetailData {
  skill: UnifiedSkill
  readmeContent: string
  files: string[]
}

const currentTab = ref('all')
const searchQuery = ref('')
const selectedTag = ref('all')

const { data: skillsData, pending, refresh } = await useFetch<{
  success: boolean
  total: number
  stats: Record<string, number>
  data: UnifiedSkill[]
}>(() => `/api/skills?platform=${currentTab.value}&q=${encodeURIComponent(searchQuery.value)}`)

const skills = computed(() => {
  let list = skillsData.value?.data || []
  if (selectedTag.value !== 'all') {
    list = list.filter(s => s.tags?.includes(selectedTag.value))
  }
  return list
})

const stats = computed(() => skillsData.value?.stats || {})
const totalCount = computed(() => skillsData.value?.total || 0)

// All available tags from returned data
const allTags = computed(() => {
  const set = new Set<string>()
  const rawList = skillsData.value?.data || []
  for (const s of rawList) {
    if (s.tags) {
      for (const t of s.tags) set.add(t)
    }
  }
  return Array.from(set)
})

const platformMeta: Record<string, { name: string, icon: string, color: string, badgeBg: string }> = {
  all: {
    name: '全部技能',
    icon: 'i-lucide-grid',
    color: 'text-zinc-600 dark:text-zinc-300',
    badgeBg: 'bg-zinc-100 dark:bg-zinc-800'
  },
  agents: {
    name: '全局 (~/.agents)',
    icon: 'i-lucide-globe',
    color: 'text-emerald-600 dark:text-emerald-400',
    badgeBg: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
  },
  pi: {
    name: 'Pi CLI',
    icon: 'i-lucide-terminal',
    color: 'text-indigo-600 dark:text-indigo-400',
    badgeBg: 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800'
  },
  codex: {
    name: 'Codex App',
    icon: 'i-lucide-cpu',
    color: 'text-purple-600 dark:text-purple-400',
    badgeBg: 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800'
  },
  agy: {
    name: 'AGY CLI',
    icon: 'i-lucide-sparkles',
    color: 'text-amber-600 dark:text-amber-400',
    badgeBg: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'
  },
  workbuddy: {
    name: 'WorkBuddy',
    icon: 'i-lucide-briefcase',
    color: 'text-blue-600 dark:text-blue-400',
    badgeBg: 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800'
  },
  reasonix: {
    name: 'Reasonix',
    icon: 'i-lucide-brain-circuit',
    color: 'text-cyan-600 dark:text-cyan-400',
    badgeBg: 'bg-cyan-50 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-300 border-cyan-200 dark:border-cyan-800'
  },
  opencode: {
    name: 'OpenCode',
    icon: 'i-lucide-code-2',
    color: 'text-green-600 dark:text-green-400',
    badgeBg: 'bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800'
  },
  claude: {
    name: 'Claude Code',
    icon: 'i-lucide-bot',
    color: 'text-orange-600 dark:text-orange-400',
    badgeBg: 'bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800'
  }
}

// Modal State
const isDetailOpen = ref(false)
const selectedSkill = ref<UnifiedSkill | null>(null)
const detailData = ref<SkillDetailData | null>(null)
const isLoadingDetail = ref(false)
const copied = ref(false)

const openSkillDetail = async (skill: UnifiedSkill) => {
  selectedSkill.value = skill
  isDetailOpen.value = true
  isLoadingDetail.value = true
  try {
    const res = await $fetch<{ success: boolean, data: SkillDetailData }>(`/api/skills/${skill.platform}/${skill.id}`)
    detailData.value = res.data
  } catch (e) {
    console.error(e)
  } finally {
    isLoadingDetail.value = false
  }
}

const copyPath = (path: string) => {
  navigator.clipboard.writeText(path)
  copied.value = true
  setTimeout(() => {
    copied.value = false
  }, 2000)
}
</script>

<template>
  <div class="space-y-6">
    <!-- Top Header -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-200/80 dark:border-zinc-800/80">
      <div>
        <h1 class="text-xl font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
          <UIcon
            name="i-lucide-puzzle"
            class="w-6 h-6 text-zinc-800 dark:text-zinc-200"
          />
          技能管理中心 (Skill Hub)
        </h1>
        <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
          全景聚合检索与管理全局通用技能（~/.agents）及各 CLI / App 已启用的 Agent Skills 与插件
        </p>
      </div>

      <!-- Quick Metrics -->
      <div class="flex items-center gap-2">
        <div class="px-3 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm flex items-center gap-2 text-xs">
          <UIcon
            name="i-lucide-globe"
            class="w-4 h-4 text-emerald-500"
          />
          <span class="text-zinc-500">全局技能:</span>
          <span class="font-mono font-bold text-zinc-900 dark:text-zinc-100">{{ stats.agents || 0 }}</span>
        </div>
        <div class="px-3 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm flex items-center gap-2 text-xs">
          <UIcon
            name="i-lucide-boxes"
            class="w-4 h-4 text-indigo-500"
          />
          <span class="text-zinc-500">总技能实例:</span>
          <span class="font-mono font-bold text-zinc-900 dark:text-zinc-100">{{ totalCount }}</span>
        </div>
        <UButton
          icon="i-lucide-refresh-cw"
          variant="outline"
          color="neutral"
          size="sm"
          :loading="pending"
          @click="refresh()"
        >
          刷新
        </UButton>
      </div>
    </div>

    <!-- Platform Selection Tabs -->
    <div class="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none border-b border-zinc-100 dark:border-zinc-800/50">
      <button
        v-for="(meta, key) in platformMeta"
        :key="key"
        :class="[
          'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap cursor-pointer select-none',
          currentTab === key
            ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 shadow-sm'
            : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800/60'
        ]"
        @click="currentTab = key; selectedTag = 'all'"
      >
        <UIcon
          :name="meta.icon"
          class="w-3.5 h-3.5"
        />
        <span>{{ meta.name }}</span>
        <span
          :class="[
            'text-[10px] font-mono px-1.5 py-0.2 rounded-full',
            currentTab === key
              ? 'bg-white/20 text-white dark:bg-zinc-900/20 dark:text-zinc-900'
              : 'bg-zinc-200/70 dark:bg-zinc-800 text-zinc-500'
          ]"
        >
          {{ stats[key] !== undefined ? stats[key] : (key === 'all' ? totalCount : 0) }}
        </span>
      </button>
    </div>

    <!-- Filter Bar: Search + Tag Filters -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <!-- Search Input -->
      <div class="relative max-w-md w-full">
        <UInput
          v-model="searchQuery"
          icon="i-lucide-search"
          size="sm"
          placeholder="搜索技能名称、描述、触发场景 (如 apifox, test, docx)..."
          class="w-full"
        />
        <button
          v-if="searchQuery"
          class="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 text-xs"
          @click="searchQuery = ''"
        >
          <UIcon
            name="i-lucide-x"
            class="w-3.5 h-3.5"
          />
        </button>
      </div>

      <!-- Tag Filters -->
      <div class="flex items-center gap-1.5 flex-wrap">
        <button
          :class="[
            'px-2.5 py-1 rounded text-xs transition-colors cursor-pointer',
            selectedTag === 'all'
              ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 font-semibold'
              : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
          ]"
          @click="selectedTag = 'all'"
        >
          全部标签
        </button>
        <button
          v-for="tag in allTags"
          :key="tag"
          :class="[
            'px-2.5 py-1 rounded text-xs transition-colors cursor-pointer',
            selectedTag === tag
              ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 font-semibold'
              : 'bg-zinc-100 dark:bg-zinc-800/80 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
          ]"
          @click="selectedTag = tag"
        >
          {{ tag }}
        </button>
      </div>
    </div>

    <!-- Loading State -->
    <div
      v-if="pending"
      class="py-16 text-center text-zinc-400"
    >
      <UIcon
        name="i-lucide-loader-2"
        class="w-6 h-6 animate-spin mx-auto mb-2 text-zinc-500"
      />
      <p class="text-xs">
        扫描并加载技能数据中...
      </p>
    </div>

    <!-- Empty State -->
    <div
      v-else-if="skills.length === 0"
      class="py-16 text-center bg-white dark:bg-zinc-900 rounded-lg border border-dashed border-zinc-200 dark:border-zinc-800"
    >
      <div class="w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mx-auto mb-2.5 text-zinc-400">
        <UIcon
          name="i-lucide-puzzle"
          class="w-5 h-5"
        />
      </div>
      <h3 class="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
        未找到匹配的技能
      </h3>
      <p class="text-xs text-zinc-400 mt-0.5">
        请尝试切换平台分类或清除搜索条件
      </p>
    </div>

    <!-- Skills Grid -->
    <div
      v-else
      class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5"
    >
      <div
        v-for="item in skills"
        :key="`${item.platform}-${item.id}`"
        class="group bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 hover:shadow-sm transition-all flex flex-col justify-between p-4 cursor-pointer relative overflow-hidden"
        @click="openSkillDetail(item)"
      >
        <div class="space-y-2.5">
          <!-- Card Header Badges -->
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-1.5 flex-wrap">
              <!-- Platform Badge -->
              <span :class="['px-2 py-0.5 rounded text-[11px] font-medium border flex items-center gap-1', platformMeta[item.platform]?.badgeBg || 'bg-zinc-100 text-zinc-700']">
                <UIcon
                  :name="platformMeta[item.platform]?.icon || 'i-lucide-puzzle'"
                  class="w-3 h-3"
                />
                {{ platformMeta[item.platform]?.name || item.platformName }}
              </span>

              <!-- Category Badge -->
              <span
                v-if="item.category === 'universal'"
                class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-100/70 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
              >
                🌐 全局通用
              </span>
              <span
                v-else-if="item.isSymlink"
                class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-100/70 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300"
                title="软链接指向全局 ~/.agents/skills"
              >
                🔗 软链引用
              </span>
              <span
                v-else-if="item.isBuiltin"
                class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100/70 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
              >
                ⚙️ 系统内置
              </span>
              <span
                v-else-if="item.category === 'plugin'"
                class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-100/70 text-orange-800 dark:bg-orange-950/60 dark:text-orange-300"
              >
                🧩 插件
              </span>
            </div>

            <UIcon
              name="i-lucide-chevron-right"
              class="w-4 h-4 text-zinc-300 group-hover:text-zinc-600 dark:group-hover:text-zinc-200 group-hover:translate-x-0.5 transition-all"
            />
          </div>

          <!-- Skill Name -->
          <div>
            <h3 class="text-sm font-bold text-zinc-900 dark:text-white group-hover:text-zinc-700 dark:group-hover:text-zinc-200 transition-colors flex items-center gap-1.5">
              {{ item.name }}
            </h3>
            <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-1 line-clamp-2 leading-relaxed">
              {{ item.description }}
            </p>
          </div>
        </div>

        <!-- Card Footer -->
        <div class="mt-3.5 pt-2.5 border-t border-zinc-100 dark:border-zinc-800/80 space-y-2">
          <!-- Tags -->
          <div class="flex items-center gap-1 flex-wrap">
            <span
              v-for="tag in (item.tags || []).slice(0, 3)"
              :key="tag"
              class="px-1.5 py-0.2 rounded text-[10px] bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 font-mono"
            >
              #{{ tag }}
            </span>
          </div>

          <!-- Enabled In summary for global skills -->
          <div
            v-if="item.platform === 'agents' && item.enabledIn && item.enabledIn.length > 0"
            class="text-[11px] text-zinc-500 flex items-center gap-1"
          >
            <span class="text-emerald-600 dark:text-emerald-400 font-medium">已启用在:</span>
            <span class="font-mono uppercase text-[10px] text-zinc-700 dark:text-zinc-300">{{ item.enabledIn.join(", ") }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Skill Detail Drawer / Modal -->
    <UModal
      v-model:open="isDetailOpen"
      :ui="{ content: 'max-w-3xl' }"
    >
      <template #content>
        <div class="p-6 space-y-5 max-h-[85vh] overflow-y-auto">
          <!-- Header -->
          <div class="flex items-start justify-between gap-4 pb-4 border-b border-zinc-100 dark:border-zinc-800">
            <div class="space-y-1.5">
              <div class="flex items-center gap-2 flex-wrap">
                <span :class="['px-2 py-0.5 rounded text-xs font-medium border flex items-center gap-1', platformMeta[selectedSkill?.platform || '']?.badgeBg || 'bg-zinc-100']">
                  <UIcon
                    :name="platformMeta[selectedSkill?.platform || '']?.icon || 'i-lucide-puzzle'"
                    class="w-3.5 h-3.5"
                  />
                  {{ platformMeta[selectedSkill?.platform || '']?.name || selectedSkill?.platformName }}
                </span>
                <span
                  v-if="selectedSkill?.isSymlink"
                  class="px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300"
                >
                  🔗 软链到全局
                </span>
                <span
                  v-if="selectedSkill?.version"
                  class="px-2 py-0.5 rounded text-xs font-mono bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
                >
                  v{{ selectedSkill.version }}
                </span>
              </div>
              <h2 class="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                {{ selectedSkill?.name }}
              </h2>
            </div>

            <UButton
              variant="ghost"
              color="neutral"
              size="sm"
              icon="i-lucide-x"
              @click="isDetailOpen = false"
            />
          </div>

          <!-- Location Bar -->
          <div class="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800 text-xs flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 overflow-hidden">
              <UIcon
                name="i-lucide-folder"
                class="w-4 h-4 text-zinc-400 shrink-0"
              />
              <span class="font-mono text-zinc-600 dark:text-zinc-300 truncate">{{ selectedSkill?.skillDir }}</span>
            </div>
            <UButton
              variant="ghost"
              color="neutral"
              size="xs"
              :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
              @click="copyPath(selectedSkill?.skillDir || '')"
            >
              {{ copied ? "已复制" : "复制路径" }}
            </UButton>
          </div>

          <!-- Associated Tools (for Global Skills) -->
          <div
            v-if="selectedSkill?.platform === 'agents'"
            class="p-3 rounded-lg bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200/60 dark:border-emerald-800/40 text-xs"
          >
            <div class="flex items-center gap-1.5 font-semibold text-emerald-800 dark:text-emerald-300 mb-1">
              <UIcon
                name="i-lucide-link"
                class="w-3.5 h-3.5"
              />
              跨工具分发状态
            </div>
            <div
              v-if="selectedSkill.enabledIn && selectedSkill.enabledIn.length > 0"
              class="text-zinc-600 dark:text-zinc-300"
            >
              该全局技能已在以下平台启用/软链：
              <span class="font-bold text-zinc-800 dark:text-zinc-100">{{ selectedSkill.enabledIn.map(p => platformMeta[p]?.name || p).join("、") }}</span>
            </div>
            <div
              v-else
              class="text-zinc-500"
            >
              当前仅保存在全局中心 (~/.agents/skills)，尚未在其他 CLI 建立软链。
            </div>
          </div>

          <!-- Symlink Details -->
          <div
            v-else-if="selectedSkill?.isSymlink && selectedSkill?.symlinkTarget"
            class="p-3 rounded-lg bg-indigo-50/60 dark:bg-indigo-950/20 border border-indigo-200/60 dark:border-indigo-800/40 text-xs"
          >
            <div class="flex items-center gap-1.5 font-semibold text-indigo-800 dark:text-indigo-300 mb-1">
              <UIcon
                name="i-lucide-external-link"
                class="w-3.5 h-3.5"
              />
              软链接目标源
            </div>
            <p class="font-mono text-zinc-600 dark:text-zinc-300">
              {{ selectedSkill.symlinkTarget }}
            </p>
          </div>

          <!-- Files in Skill Directory -->
          <div
            v-if="detailData?.files && detailData.files.length > 0"
            class="space-y-1.5"
          >
            <h4 class="text-xs font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
              <UIcon
                name="i-lucide-file-code"
                class="w-3.5 h-3.5"
              />
              目录文件 ({{ detailData.files.length }})
            </h4>
            <div class="flex items-center gap-1.5 flex-wrap">
              <span
                v-for="f in detailData.files"
                :key="f"
                class="px-2 py-0.5 rounded text-xs font-mono bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200/60 dark:border-zinc-700/60"
              >
                {{ f }}
              </span>
            </div>
          </div>

          <!-- Markdown Content (SKILL.md) -->
          <div class="space-y-2">
            <h4 class="text-xs font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
              <UIcon
                name="i-lucide-book-open"
                class="w-3.5 h-3.5"
              />
              SKILL.md 文档规范
            </h4>
            <div
              v-if="isLoadingDetail"
              class="py-8 text-center text-zinc-400 text-xs"
            >
              <UIcon
                name="i-lucide-loader-2"
                class="w-5 h-5 animate-spin mx-auto mb-1 text-zinc-500"
              />
              正在读取文档...
            </div>
            <div
              v-else
              class="p-4 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 text-xs font-mono leading-relaxed whitespace-pre-wrap text-zinc-800 dark:text-zinc-200 max-h-[400px] overflow-y-auto"
            >
              {{ detailData?.readmeContent || "暂无文档内容" }}
            </div>
          </div>

          <!-- Footer Action -->
          <div class="flex justify-end pt-3 border-t border-zinc-100 dark:border-zinc-800">
            <UButton
              color="neutral"
              size="sm"
              @click="isDetailOpen = false"
            >
              关闭
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
