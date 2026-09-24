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
    '/': { ssr: false }
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
      googleicons: false
    }
  }
})
