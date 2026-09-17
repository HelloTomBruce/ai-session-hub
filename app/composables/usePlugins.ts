export interface PluginManifest {
  id: string
  name: string
  category: 'cli' | 'app'
  icon: string
  version?: string
  description?: string
  author?: string
  homepage?: string
  type?: 'builtin' | 'template-jsonl' | 'template-sqlite' | 'custom' | 'npm'
  defaultEnabled?: boolean
}

export interface PluginStatusInfo {
  manifest: PluginManifest
  isAvailable: boolean
  isEnabled: boolean
  sessionCount: number
  source: 'builtin' | 'user' | 'npm'
}

export function usePlugins() {
  const { data: pluginsRes, pending, refresh } = useFetch<{ success: boolean, data: PluginStatusInfo[] }>(
    '/api/plugins',
    { key: 'session-hub-plugins' }
  )

  const plugins = computed(() => pluginsRes.value?.data || [])

  const activePlugins = computed(() => {
    return plugins.value.filter(p => p.isEnabled)
  })

  const pluginMetaMap = computed<Record<string, { name: string, type: string, icon: string, description?: string }>>(() => {
    const map: Record<string, { name: string, type: string, icon: string, description?: string }> = {}
    for (const p of plugins.value) {
      map[p.manifest.id] = {
        name: p.manifest.name,
        type: (p.manifest.category || 'cli').toUpperCase(),
        icon: p.manifest.icon || 'i-lucide-terminal',
        description: p.manifest.description
      }
    }
    return map
  })

  const getPluginMeta = (id?: string) => {
    if (!id) {
      return {
        name: '未知',
        type: 'CLI',
        icon: 'i-lucide-terminal'
      }
    }
    return pluginMetaMap.value[id] || {
      name: id.toUpperCase(),
      type: 'CLI',
      icon: 'i-lucide-terminal'
    }
  }

  return {
    plugins,
    activePlugins,
    pluginMetaMap,
    getPluginMeta,
    pending,
    refresh
  }
}
