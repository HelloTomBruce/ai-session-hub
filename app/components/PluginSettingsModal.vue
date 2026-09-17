<script setup lang="ts">
const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', val: boolean): void
}>()

const isOpen = computed({
  get: () => props.open,
  set: v => emit('update:open', v)
})

interface PluginStatusInfo {
  manifest: {
    id: string
    name: string
    category: 'cli' | 'app'
    icon: string
    version?: string
    description?: string
    author?: string
    type?: 'builtin' | 'template-jsonl' | 'template-sqlite' | 'custom' | 'npm'
    defaultEnabled?: boolean
  }
  isAvailable: boolean
  isEnabled: boolean
  sessionCount: number
  source: 'builtin' | 'user' | 'npm'
}

const plugins = ref<PluginStatusInfo[]>([])
const isLoading = ref(false)
const isReloading = ref(false)
const togglingId = ref<string | null>(null)

const loadPlugins = async () => {
  isLoading.value = true
  try {
    const res = await $fetch<{ success: boolean, data: PluginStatusInfo[] }>('/api/plugins')
    if (res?.data) {
      plugins.value = res.data
    }
  } catch (err: unknown) {
    console.error('Failed to load plugins:', err)
  } finally {
    isLoading.value = false
  }
}

const togglePlugin = async (plugin: PluginStatusInfo) => {
  togglingId.value = plugin.manifest.id
  try {
    const nextState = !plugin.isEnabled
    const res = await $fetch<{ success: boolean, data: { id: string, enabled: boolean } }>(
      `/api/plugins/${plugin.manifest.id}/toggle`,
      {
        method: 'POST',
        body: { enabled: nextState }
      }
    )
    if (res?.success) {
      plugin.isEnabled = res.data.enabled
      await refreshNuxtData()
    }
  } catch (err: unknown) {
    console.error('Failed to toggle plugin:', err)
  } finally {
    togglingId.value = null
  }
}

const reloadPlugins = async () => {
  isReloading.value = true
  try {
    const res = await $fetch<{ success: boolean, message: string, data: PluginStatusInfo[] }>('/api/plugins/reload', {
      method: 'POST'
    })
    if (res?.data) {
      plugins.value = res.data
      await refreshNuxtData()
    }
  } catch (err: unknown) {
    console.error('Failed to reload plugins:', err)
  } finally {
    isReloading.value = false
  }
}

watch(() => props.open, (open) => {
  if (open) {
    loadPlugins()
  } else {
    refreshNuxtData()
  }
})
</script>

<template>
  <UModal
    v-model:open="isOpen"
    :ui="{ content: 'sm:max-w-2xl' }"
  >
    <template #header>
      <div class="flex items-center justify-between w-full">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-lg bg-indigo-500/10 dark:bg-indigo-500/20 text-indigo-500 flex items-center justify-center">
            <UIcon
              name="i-lucide-blocks"
              class="w-5 h-5"
            />
          </div>
          <div>
            <h3 class="font-semibold text-base text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              插件中心 (Plugin Ecosystem)
            </h3>
            <p class="text-xs text-zinc-500 dark:text-zinc-400">
              管理适配器插件与零代码声明式扩展 (~/.session-hub/plugins/)
            </p>
          </div>
        </div>
        <UButton
          size="xs"
          variant="ghost"
          color="neutral"
          icon="i-lucide-rotate-cw"
          :loading="isReloading"
          @click="reloadPlugins"
        >
          重新扫描
        </UButton>
      </div>
    </template>

    <template #body>
      <div class="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
        <!-- Help Tip -->
        <div class="p-3 rounded-lg bg-zinc-100 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700/60 text-xs text-zinc-600 dark:text-zinc-300 flex items-start gap-2.5">
          <UIcon
            name="i-lucide-info"
            class="w-4 h-4 text-indigo-500 shrink-0 mt-0.5"
          />
          <div class="leading-relaxed">
            支持 11+ 款内置适配器热插拔。如需接入自定义工具，只需在 <code class="font-mono text-indigo-500 dark:text-indigo-400 bg-zinc-200 dark:bg-zinc-800 px-1 py-0.5 rounded">~/.session-hub/plugins/</code> 放入零代码声明式 JSON 配置（如 <code class="font-mono text-zinc-500">my-agent.json</code>）即可自动识别会话。
          </div>
        </div>

        <div
          v-if="isLoading"
          class="py-12 flex flex-col items-center justify-center gap-2 text-zinc-400"
        >
          <UIcon
            name="i-lucide-loader-2"
            class="w-6 h-6 animate-spin text-indigo-500"
          />
          <span class="text-xs">正在扫描本地插件环境...</span>
        </div>

        <div
          v-else
          class="divide-y divide-zinc-200 dark:divide-zinc-800 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden bg-white dark:bg-zinc-900/50"
        >
          <div
            v-for="p in plugins"
            :key="p.manifest.id"
            class="p-3.5 flex items-center justify-between gap-4 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/30"
          >
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-9 h-9 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-700 dark:text-zinc-300 shrink-0 border border-zinc-200 dark:border-zinc-700/60">
                <UIcon
                  :name="p.manifest.icon || 'i-lucide-plug'"
                  class="w-5 h-5"
                />
              </div>
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <span class="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{{ p.manifest.name }}</span>
                  <UBadge
                    :color="p.source === 'builtin' ? 'neutral' : (p.source === 'npm' ? 'info' : 'primary')"
                    variant="subtle"
                    size="xs"
                    class="font-mono text-[10px]"
                  >
                    {{ p.source === 'builtin' ? '内置' : (p.source === 'npm' || p.manifest.type === 'npm' ? 'npm 插件' : '用户扩展') }}
                  </UBadge>
                  <UBadge
                    v-if="p.isAvailable"
                    color="success"
                    variant="subtle"
                    size="xs"
                    class="text-[10px]"
                  >
                    已就绪 ({{ p.sessionCount }} 条)
                  </UBadge>
                  <UBadge
                    v-else
                    color="neutral"
                    variant="subtle"
                    size="xs"
                    class="text-[10px] text-zinc-400"
                  >
                    未检测到数据
                  </UBadge>
                </div>
                <p class="text-xs text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
                  {{ p.manifest.description || p.manifest.id }}
                </p>
              </div>
            </div>

            <!-- Toggle Switch -->
            <div class="flex items-center gap-3 shrink-0">
              <USwitch
                :model-value="p.isEnabled"
                :disabled="togglingId === p.manifest.id"
                @update:model-value="() => togglePlugin(p)"
              />
            </div>
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex items-center justify-between w-full">
        <span class="text-xs text-zinc-400 font-mono">共 {{ plugins.length }} 个适配器插件</span>
        <UButton
          color="neutral"
          variant="outline"
          size="sm"
          @click="isOpen = false"
        >
          完成
        </UButton>
      </div>
    </template>
  </UModal>
</template>
