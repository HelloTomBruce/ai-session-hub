// https://nuxt.com/docs/api/configuration/nuxt-config

// 监听地址：默认只绑定回环，绝不默认对局域网开放。
// 本服务背后是 263MB+ 的全量 AI 会话库（可能含私钥、公司代码），
// 「监听通配地址 + 零鉴权」= 同一局域网任何设备都能直接拉走。
// 如需局域网访问，必须同时满足两个条件：
//   1) 显式设置 HUB_HOST 开放监听（如 HUB_HOST='::' 或 HUB_HOST=0.0.0.0）；
//   2) 设置 HUB_TOKEN（或 ~/.session-hub/hub-token），否则中间件
//      server/middleware/02.auth.ts 会对所有非本机 /api 请求返回 401。
const devHost = process.env.HUB_HOST?.trim() || '127.0.0.1'

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
    // 默认 '127.0.0.1'：只有本机能连，MCP 客户端与浏览器统一用
    // http://127.0.0.1:3877 访问（不要用 localhost，某些环境会先解析到 ::1）。
    // 历史值曾是 '::'（macOS 双栈通配 = 监听所有网卡），在零鉴权前提下是暴露面缺陷。
    // 需要局域网/双栈访问时显式设置 HUB_HOST：
    //   HUB_HOST='::'       macOS 双栈（同时接受 ::1 与 127.0.0.1 连接）
    //   HUB_HOST=0.0.0.0    仅 IPv4 通配
    // 无论哪种，都必须同时配置 HUB_TOKEN，否则非本机请求一律 401。
    host: devHost
  },

  // 生产启动同理（package.json 的 start 走 `node .output/server/index.mjs`）：
  // Nitro 的 node-server 只认 HOST / PORT 环境变量，不读 HUB_HOST；
  // 未显式设置 HOST 时监听地址由 Nitro 默认值决定，因此启动脚本必须显式
  // HOST=127.0.0.1（与 nuxt.config 的 devServer.host 语义保持一致）。
  // 仅在需要局域网访问时才改成 HOST=0.0.0.0，并同时设置 HUB_TOKEN。

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
