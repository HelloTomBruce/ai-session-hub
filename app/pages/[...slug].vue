<script setup lang="ts">
/**
 * 兜底路由（catch-all）。
 *
 * 背景：`/api/mcp/sse` 这类地址是服务端端点，但一旦被「客户端路由跳转」到
 * （粘贴地址后点链接、DevTools 点开 server route、或页面内误跳），vue-router 找不到
 * 匹配记录会刷 R0004 警告：
 *   No match found for location with path "/api/mcp/sse"
 * 控制台被刷屏，页面还是空白。catch-all 正是 vue-router 官方建议的修法。
 *
 * 这里把兜底分成两种语义：
 * - /api/**  → 明确解释「这是接口端点，不是页面」，并给出端点与返回入口
 * - 其它     → 常规 404，回到会话列表或搜索
 */
const route = useRoute()

const isApiPath = computed(() => route.path.startsWith('/api/'))
const path = computed(() => route.path)

const toast = useToast()

const copyEndpoint = async (value: string) => {
  try {
    await navigator.clipboard.writeText(value)
    toast.add({ title: '端点地址已复制', color: 'success', icon: 'i-lucide-check' })
  } catch {
    toast.add({ title: '复制失败，请手动选择复制', color: 'error', icon: 'i-lucide-alert-triangle' })
  }
}

const mcpEndpoints = [
  { label: 'Streamable HTTP（推荐）', value: 'http://localhost:3877/api/mcp/streamable' },
  { label: 'SSE（旧版客户端，如 Pi）', value: 'http://localhost:3877/api/mcp/sse' }
]
</script>

<template>
  <div class="max-w-2xl mx-auto py-16">
    <div class="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-6 shadow-sm space-y-4">
      <div class="flex items-start gap-3">
        <div
          class="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 border"
          :class="isApiPath
            ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
            : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700'"
        >
          <UIcon
            :name="isApiPath ? 'i-lucide-plug' : 'i-lucide-compass'"
            class="w-5 h-5"
          />
        </div>
        <div class="min-w-0">
          <h1 class="text-sm font-bold text-zinc-900 dark:text-zinc-100">
            {{ isApiPath ? '这是一个接口端点，不是页面' : '页面不存在' }}
          </h1>
          <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-1 leading-relaxed">
            <template v-if="isApiPath">
              当前地址 <code class="font-mono text-[11px] px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">{{ path }}</code>
              由服务端提供（MCP / HTTP 接口），浏览器直接打开不会有页面内容。
              需要配置 MCP 客户端时，用下方地址；需要查看调用日志，点头部的「MCP」面板。
            </template>
            <template v-else>
              地址 <code class="font-mono text-[11px] px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">{{ path }}</code>
              没有对应的页面，可能是链接过期或手输有误。
            </template>
          </p>
        </div>
      </div>

      <!-- API 端点清单 -->
      <div
        v-if="isApiPath"
        class="space-y-2"
      >
        <div
          v-for="ep in mcpEndpoints"
          :key="ep.value"
          class="flex items-center justify-between gap-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded px-3 py-2"
        >
          <div class="min-w-0">
            <div class="text-[10px] uppercase tracking-wide text-zinc-400 font-mono">
              {{ ep.label }}
            </div>
            <div class="font-mono text-[11px] text-zinc-700 dark:text-zinc-300 truncate">
              {{ ep.value }}
            </div>
          </div>
          <UButton
            size="xs"
            variant="ghost"
            color="neutral"
            icon="i-lucide-copy"
            @click="copyEndpoint(ep.value)"
          >
            复制
          </UButton>
        </div>
      </div>

      <div class="flex items-center gap-2 pt-1">
        <UButton
          color="neutral"
          size="sm"
          class="bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
          icon="i-lucide-arrow-left"
          to="/"
        >
          返回会话列表
        </UButton>
        <UButton
          variant="ghost"
          color="neutral"
          size="sm"
          icon="i-lucide-search"
          to="/search"
        >
          去搜索
        </UButton>
      </div>
    </div>
  </div>
</template>
