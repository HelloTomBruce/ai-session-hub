<script setup lang="ts">
useHead({
  title: 'AI Session Hub - 智能会话管理平台',
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1' },
    { name: 'description', content: 'AI Session Hub - 聚合管理 Pi、OpenCode、AGY、Claude Code、Codex、WorkBuddy、Reasonix 等终端与应用会话' }
  ],
  link: [
    { rel: 'icon', href: '/favicon.ico' }
  ]
})
</script>

<template>
  <UApp>
    <div class="min-h-screen bg-slate-50 dark:bg-neutral-950 flex flex-col font-sans">
      <!-- Navbar -->
      <header class="sticky top-0 z-50 bg-white/85 dark:bg-neutral-900/85 backdrop-blur border-b border-slate-200 dark:border-neutral-800">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 font-bold text-lg">
              <UIcon name="i-lucide-layers" class="w-5 h-5" />
            </div>
            <div>
              <div class="font-bold text-base tracking-tight flex items-center gap-2">
                <span>AI Session Hub</span>
                <UBadge variant="subtle" color="primary" size="xs" class="font-mono">v1.0</UBadge>
              </div>
              <p class="text-xs text-slate-500 dark:text-neutral-400">一站式 AI CLI & Desktop Apps 会话管理中枢</p>
            </div>
          </div>

          <div class="flex items-center gap-3">
            <UColorModeButton />
          </div>
        </div>
      </header>

      <!-- Main Content Area -->
      <main class="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <NuxtPage />
      </main>

      <!-- Footer -->
      <footer class="border-t border-slate-200 dark:border-neutral-800 py-4 text-center text-xs text-slate-400 dark:text-neutral-500">
        AI Session Hub • 聚合管理本地所有 AI 终端与桌面应用会话
      </footer>
    </div>
  </UApp>
</template>
