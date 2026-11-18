// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui'
  ],

  devtools: {
    enabled: true
  },

  css: ['~/assets/css/main.css'],

  routeRules: {
    // 列表与详情均为大数据量动态页：关闭 SSR 避免服务端全量渲染长会话
    // （实测 2279 条消息 SSR 渲染 8MB+ HTML、TTFB 7s+），改为客户端渲染 + 分块挂载
    '/': { ssr: false },
    '/sessions/**': { ssr: false }
  },

  devServer: {
    // 避开常见的 3000，减少与其他本地项目的端口冲突
    port: 3877,
    // '::' 在 macOS 上为双栈监听，同时接受 ::1 和 127.0.0.1 连接，
    // 避免某些 MCP 客户端解析 localhost 得到 127.0.0.1 后被拒绝
    host: '::'
  },

  compatibilityDate: '2026-06-30',

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  },

  fonts: {
    providers: {
      google: false,
      googleicons: false,
      // jsdelivr CDN 网络不可达，改用本地 @fontsource-variable/public-sans（见 main.css）
      fontsource: false
    }
  },

  icon: {
    clientBundle: {
      scan: true,
      icons: [
        'lucide:wrench',
        'lucide:user',
        'lucide:bot',
        'lucide:terminal',
        'lucide:message-square-quote',
        'lucide:file-code',
        'lucide:git-branch',
        'lucide:sparkles',
        'lucide:rotate-cw',
        'lucide:arrow-up-right'
      ]
    }
  }
})
