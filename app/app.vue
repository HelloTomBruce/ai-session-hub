<script setup lang="ts">
useHead({
  title: 'AI Session Hub - 会话与知识管理',
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1' },
    { name: 'description', content: 'AI Session Hub - 聚合管理多平台 CLI 与 Desktop Apps 的会话与知识沉淀' }
  ],
  link: [
    { rel: 'icon', href: '/favicon.ico' }
  ]
})
</script>

<template>
  <UApp>
    <div class="min-h-screen bg-neutral-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 flex flex-col font-sans selection:bg-zinc-900 selection:text-white dark:selection:bg-zinc-100 dark:selection:text-zinc-900">
      <!-- Navbar -->
      <header class="sticky top-0 z-50 bg-white/90 dark:bg-zinc-900/90 backdrop-blur border-b border-zinc-200/80 dark:border-zinc-800/80">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          <div class="flex items-center gap-6">
            <NuxtLink to="/" class="flex items-center gap-2.5 group">
              <div class="w-7 h-7 rounded-lg bg-zinc-900 dark:bg-zinc-100 flex items-center justify-center text-white dark:text-zinc-900 font-bold text-sm shadow-sm transition-transform group-hover:scale-105">
                <UIcon name="i-lucide-layers" class="w-4 h-4" />
              </div>
              <div class="flex items-center gap-2">
                <span class="font-bold text-sm tracking-tight text-zinc-900 dark:text-zinc-100">AI Session Hub</span>
                <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 font-medium">v1.1</span>
              </div>
            </NuxtLink>

            <!-- Nav Links -->
            <nav class="hidden sm:flex items-center gap-1">
              <NuxtLink to="/">
                <UButton variant="ghost" color="neutral" size="sm" icon="i-lucide-list">会话清单</UButton>
              </NuxtLink>
              <NuxtLink to="/distill">
                <UButton variant="ghost" color="neutral" size="sm" icon="i-lucide-book-open">知识复盘与提炼</UButton>
              </NuxtLink>
            </nav>
          </div>

          <div class="flex items-center gap-2.5">
            <div class="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono bg-zinc-100 dark:bg-zinc-800/70 border border-zinc-200 dark:border-zinc-700/60 text-zinc-600 dark:text-zinc-300">
              <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
              <span>MCP SSE: /api/mcp/sse</span>
            </div>
            <UColorModeButton />
          </div>
        </div>
      </header>

      <!-- Main Content Area -->
      <main class="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <NuxtPage />
      </main>

      <!-- Footer -->
      <footer class="border-t border-zinc-200 dark:border-zinc-800/80 py-4 text-center text-xs text-zinc-400 dark:text-zinc-500">
        AI Session Hub • 极简、高效的多源会话与知识资产沉淀平台
      </footer>
    </div>
  </UApp>
</template>
