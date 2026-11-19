import { createHash, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { H3Event } from 'h3'

/**
 * 访问面收敛中间件（安全边界）
 *
 * 背景：本机数据库是 263MB+ 的全量 AI 会话（可能含私钥、公司代码、内部链接），
 * 一旦服务监听在通配地址且无鉴权，同一局域网内任何设备都能直接拉走。
 *
 * 安全模型（默认拒绝，最小放行）：
 *   1. 服务默认只监听回环（nuxt.config.ts devServer.host / 生产 HOST 环境变量）；
 *   2. 本中间件对 /api/** 做第二道闸：确认是「本机来源」才放行，否则必须持有 token；
 *   3. token 来自 process.env.HUB_TOKEN（优先）或 $HUB_HOME/hub-token 文件；
 *   4. 未配置 token 时，非本机请求一律 401 —— 拒绝「无凭证静默暴露」这种默认。
 *
 * 来源判定为什么不是「看 X-Forwarded-For」：
 *   Nuxt dev 的 Nitro worker 监听在 unix socket 上（临时目录 nitro-worker-*.sock），
 *   外层 dev 代理转发时会把 x-forwarded-for 透传/复用客户端自带的值 —— 实测在局域网
 *   机器上传 `X-Forwarded-For: 127.0.0.1` 可以原样抵达，若据此放行就是一行 curl 绕过。
 *   所以默认只信 TCP socket 的 remoteAddress；XFF 仅在显式 HUB_TRUST_PROXY=1 时启用，
 *   且未知来源是否可信由 trustUnknownPeer() 严格收紧（见下）。
 *
 * 判定逻辑全部收敛在 createAuthGuard() 这个纯函数里（不依赖 h3 event、不碰文件系统），
 * 便于 node:test 直接单测；文件末尾再把 ctx 映射与副作用接上 h3。
 */

export const COOKIE_NAME = 'hub_token'
/** 30 天，避免局域网用户反复贴 token */
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 30
/** 换票端点自行校验 body 里的 token，必须绕过本中间件（否则「先有鸡还是先有蛋」） */
export const TOKEN_EXCHANGE_PATH = '/api/auth/token'
/** 与 nuxt.config.ts 保持一致的默认绑定地址 */
export const DEFAULT_HOST = '127.0.0.1'

const API_ROOT = '/api'
const API_PREFIX = '/api/'
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost'])
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1'])

export const MISSING_TOKEN_HINT
  = '服务默认仅允许本机访问；如需局域网访问请设置 HUB_TOKEN（或写入 ~/.session-hub/hub-token 后重启）。'

export type QueryValue = string | string[] | undefined

export interface AuthGuardContext {
  /** event.node.req.socket.remoteAddress；未知时由 resolveRemoteAddress() 决定是否降级 */
  remoteAddress?: string
  /** 不含 query 的路径，如 /api/sessions */
  path: string
  /** 已小写化的请求头（数组值用 ", " 连接） */
  headers: Record<string, string | undefined>
  /** 解析后的 query（数组值保留为数组） */
  query: Record<string, QueryValue>
  method: string
}

export interface AuthCookieVerdict {
  action: 'allow-set-cookie'
  /** 要写入 Cookie 的 token（即服务端配置的正确 token） */
  token: string
  /** 需要 302 去掉 ?token= 时的目标地址；为空表示直接放行不重定向 */
  redirectUrl?: string
}

export type AuthVerdict
  = | { action: 'allow' }
    | { action: 'deny', error: string }
    | AuthCookieVerdict

export interface AuthGuardOptions {
  /**
   * 当拿不到对端地址（dev worker 代理场景）时，是否允许按「本机」放行。
   * 默认 false（安全侧）：未知来源必须有 token。中间件在 dev 且绑定回环时注入 true。
   */
  trustUnknownPeer?: () => boolean
}

// ---------------------------------------------------------------------------
// 纯工具函数
// ---------------------------------------------------------------------------

/** 回环地址判定：兼容 IPv4 / IPv6 / IPv4-mapped，以及 127.0.0.0/8 整段 */
export function isLoopbackAddress(address?: string | null): boolean {
  if (!address) return false
  const normalized = address.trim().toLowerCase()
  if (!normalized) return false
  if (LOOPBACK_ADDRESSES.has(normalized)) return true
  // ::ffff:127.0.0.1 这类 IPv4-mapped IPv6
  if (normalized.startsWith('::ffff:127.')) return true
  // 整个 127.0.0.0/8 都是回环
  return normalized.startsWith('127.')
}

/** Host 头（去掉端口与方括号后）是否为回环主机名 */
export function isLoopbackHostname(host?: string | null): boolean {
  if (!host) return false
  let hostname = host.trim().toLowerCase()
  if (hostname.startsWith('[')) {
    // [::1]:3877
    const end = hostname.indexOf(']')
    if (end === -1) return false
    hostname = hostname.slice(1, end)
  } else if (hostname.includes(':')) {
    // 127.0.0.1:3877 / localhost:3877
    hostname = hostname.slice(0, hostname.indexOf(':'))
  }
  return LOOPBACK_HOSTNAMES.has(hostname) || hostname.startsWith('127.')
}

/**
 * 恒时比较。先各自 sha256 归一，长度不同也不会让 timingSafeEqual 抛错
 * （直接比较原始 buffer 会在长度不等时 throw，反过来也泄漏长度信息）。
 */
export function tokensEqual(provided?: string | null, expected?: string | null): boolean {
  if (!provided || !expected) return false
  const a = createHash('sha256').update(provided, 'utf8').digest()
  const b = createHash('sha256').update(expected, 'utf8').digest()
  return timingSafeEqual(a, b)
}

/** 错误信息里只允许出现前 4 位 + 掩码，绝不回显完整 token */
export function maskToken(token?: string | null): string {
  if (!token) return '<未提供>'
  const head = token.slice(0, 4)
  const rest = Math.min(28, Math.max(3, token.length - head.length))
  return `${head}${'*'.repeat(rest)}`
}

/** 数据目录：与 HUB_HOME 语义保持一致（见 .env.example / AGENTS.md） */
export function hubHome(): string {
  const fromEnv = process.env.HUB_HOME?.trim()
  return fromEnv || join(homedir(), '.session-hub')
}

export function hubTokenFile(): string {
  return join(hubHome(), 'hub-token')
}

/** token 来源优先级：HUB_TOKEN 环境变量 > $HUB_HOME/hub-token 文件（trim） */
export function readHubToken(): string | null {
  const fromEnv = process.env.HUB_TOKEN?.trim()
  if (fromEnv) return fromEnv
  try {
    const fromFile = readFileSync(hubTokenFile(), 'utf8').trim()
    return fromFile || null
  } catch {
    // 文件不存在 / 无读权限：视为「未配置 token」，由调用方按未配置处理
    return null
  }
}

/** 从 Cookie 头里取指定 cookie 值（不整段解析，避免额外依赖） */
export function readCookieValue(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=')
    if (separator === -1) continue
    if (part.slice(0, separator).trim() !== name) continue
    try {
      return decodeURIComponent(part.slice(separator + 1).trim())
    } catch {
      return part.slice(separator + 1).trim()
    }
  }
  return null
}

/**
 * 按优先级取请求携带的 token，三种载体：
 *   Authorization: Bearer <token> > x-hub-token > Cookie hub_token
 */
export function readTokenFromHeaders(headers: Record<string, string | undefined>): string | null {
  const authorization = headers.authorization
  if (authorization) {
    const match = /^bearer\s+(\S+)\s*$/i.exec(authorization.trim())
    if (match?.[1]) return match[1]
  }
  const headerToken = headers['x-hub-token']?.trim()
  if (headerToken) return headerToken
  const cookieToken = readCookieValue(headers.cookie, COOKIE_NAME)
  return cookieToken || null
}

/** 只接受字符串型 query 值（?token=a&token=b 这种重复参数一律忽略） */
export function pickQueryString(query: Record<string, QueryValue>, key: string): string | null {
  const value = query?.[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

/** 生成去掉 token 参数后的同源地址，其它参数原样保留 */
export function stripTokenParam(path: string, query: Record<string, QueryValue>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query || {})) {
    if (key === 'token' || value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item)
    } else {
      params.append(key, value)
    }
  }
  const search = params.toString()
  return search ? `${path}?${search}` : path
}

/** 无论 event.path 是否带 query，都取到纯路径 */
export function normalizePath(rawPath?: string | null): string {
  const raw = (rawPath || '/').split('?')[0]?.split('#')[0] || ''
  if (!raw) return '/'
  return raw.startsWith('/') ? raw : `/${raw}`
}

/** 只要不是 /api 及其子路径，就不属于本中间件的管辖范围（页面 / 静态资源 / _nuxt 等） */
export function isApiPath(path: string): boolean {
  return path === API_ROOT || path.startsWith(API_PREFIX)
}

/**
 * 解析对端地址。
 * - 有真实 TCP socket 地址时直接用（生产 `node .output/server/index.mjs` 就是这种情况）；
 * - dev worker 代理下 socket 是 unix socket 影子对象，拿不到地址，返回 undefined（不可信）；
 * - 仅当显式 HUB_TRUST_PROXY=1 时才退而取 x-forwarded-for 的第一跳（该头可被客户端伪造，
 *   必须在可信反向代理后面才开启）。
 */
export function resolveRemoteAddress(
  socketAddress: string | undefined,
  headers: Record<string, string | undefined>,
  env: Record<string, string | undefined> = process.env
): string | undefined {
  if (socketAddress) return socketAddress
  if (env.HUB_TRUST_PROXY?.trim() !== '1') return undefined
  const forwarded = headers['x-forwarded-for']?.split(',')[0]?.trim()
  return forwarded || undefined
}

/** dev 绑定地址语义：与 nuxt.config.ts 中 `process.env.HUB_HOST || '127.0.0.1'` 必须一致 */
export function devBindHost(env: Record<string, string | undefined> = process.env): string {
  return env.HUB_HOST?.trim() || DEFAULT_HOST
}

/**
 * 未知来源是否可按本机放行。
 *
 * 只在一个很窄的场景成立：dev 模式 + dev 绑定地址是回环。
 * 此时外层 dev 代理只可能由本机连入（回环绑定下 OS 不会接受非本机连接），
 * 因此「拿不到对端地址」等价于「本机」。一旦 HUB_HOST 显式开放为非回环地址，
 * 这里立刻返回 false，未知来源必须出示 token —— 不依赖任何可伪造的请求头。
 */
export function trustUnknownPeerInDev(
  env: Record<string, string | undefined> = process.env
): boolean {
  if (env.NODE_ENV !== 'development') return false
  const host = devBindHost(env).toLowerCase()
  return isLoopbackAddress(host) || isLoopbackHostname(host)
}

// ---------------------------------------------------------------------------
// 核心判定：纯函数，注入 token 提供者，方便单测
// ---------------------------------------------------------------------------

export function createAuthGuard(
  getToken: () => string | null = readHubToken,
  options: AuthGuardOptions = {}
) {
  const trustUnknownPeer = options.trustUnknownPeer ?? (() => false)

  return (ctx: AuthGuardContext): AuthVerdict => {
    const method = (ctx.method || 'GET').toUpperCase()
    const path = normalizePath(ctx.path)

    // OPTIONS 预检不带凭证，放行（真正的数据请求仍会被拦）
    if (method === 'OPTIONS') return { action: 'allow' }

    // 非 /api：页面导航 / 静态资源不拦截。
    // 唯一例外是 URL 里带了正确 token —— 顺势换 Cookie 并 302 掉 token，
    // 避免 token 长期留在地址栏、历史记录与 Referer 里。
    if (!isApiPath(path)) {
      const queryToken = pickQueryString(ctx.query, 'token')
      if (queryToken) {
        const expected = getToken()
        if (expected && tokensEqual(queryToken, expected)) {
          return {
            action: 'allow-set-cookie',
            token: expected,
            redirectUrl: stripTokenParam(path, ctx.query)
          }
        }
      }
      return { action: 'allow' }
    }

    // 换票端点自己校验 body 中的 token
    if (path === TOKEN_EXCHANGE_PATH) return { action: 'allow' }

    // 真实 socket 地址是回环：本机自己用，不需要 token（即便配置了 HUB_TOKEN）
    if (isLoopbackAddress(ctx.remoteAddress)) return { action: 'allow' }

    // 拿不到对端地址（dev worker 代理）：只有 dev + 回环绑定 + 回环 Host 才算本机。
    // Host 头可伪造，但这里只是「未知来源」分支的额外收紧，不构成唯一防线：
    // 真正的防线是默认回环绑定 + 开放时必须配置 token。
    if (!ctx.remoteAddress && trustUnknownPeer() && isLoopbackHostname(ctx.headers.host)) {
      return { action: 'allow' }
    }

    // 以下为非本机请求
    const expected = getToken()
    if (!expected) {
      return { action: 'deny', error: MISSING_TOKEN_HINT }
    }

    const provided = readTokenFromHeaders(ctx.headers)
    if (provided && tokensEqual(provided, expected)) return { action: 'allow' }

    // 兼容「浏览器直接访问接口」或命令行 curl 的 ?token= 用法：
    // token 正确就下发 Cookie 并放行（API 请求不做 302，避免把 curl 带进首页）
    const queryToken = pickQueryString(ctx.query, 'token')
    if (queryToken && tokensEqual(queryToken, expected)) {
      return { action: 'allow-set-cookie', token: expected }
    }

    if (!provided && !queryToken) {
      return {
        action: 'deny',
        error: '未授权：非本机请求需提供访问 token（Authorization: Bearer / x-hub-token / Cookie hub_token / ?token=）。'
      }
    }
    return {
      action: 'deny',
      error: `未授权：token 不匹配（收到 ${maskToken(provided || queryToken)}）。`
    }
  }
}

// ---------------------------------------------------------------------------
// h3 适配层：只负责「把 event 映射成 ctx」+「执行副作用」
// ---------------------------------------------------------------------------

function normalizeHeaders(rawHeaders: Record<string, string | string[] | undefined>): Record<string, string | undefined> {
  const headers: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(rawHeaders || {})) {
    if (value === undefined) continue
    headers[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value
  }
  return headers
}

function isSecureRequest(event: H3Event): boolean {
  const raw = event.node.req
  if (raw.socket && 'encrypted' in raw.socket && raw.socket.encrypted) return true
  const forwardedProto = String(raw.headers['x-forwarded-proto'] || '').split(',')[0]?.trim().toLowerCase() || ''
  return forwardedProto === 'https'
}

function setAuthCookie(event: H3Event, token: string): void {
  setCookie(event, COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
    // 局域网多为 http：这里按实际协议给 secure，否则浏览器会直接丢弃 Cookie
    secure: isSecureRequest(event)
  })
}

function applyVerdict(event: H3Event, verdict: AuthVerdict): unknown {
  if (verdict.action === 'allow') return undefined

  if (verdict.action === 'allow-set-cookie') {
    setAuthCookie(event, verdict.token)
    if (verdict.redirectUrl) return sendRedirect(event, verdict.redirectUrl, 302)
    return undefined
  }

  setResponseStatus(event, 401)
  setHeader(event, 'cache-control', 'no-store')
  setHeader(event, 'www-authenticate', 'Bearer realm="session-hub"')
  // 固定结构，方便前端与 curl 判断；不含 token 原文
  return { success: false, error: verdict.error }
}

const guard = createAuthGuard(readHubToken, { trustUnknownPeer: trustUnknownPeerInDev })

const authMiddleware = (event: H3Event): unknown => {
  const headers = normalizeHeaders(event.node.req.headers as Record<string, string | string[] | undefined>)
  const ctx: AuthGuardContext = {
    remoteAddress: resolveRemoteAddress(event.node.req.socket?.remoteAddress, headers),
    path: normalizePath(event.path || event.node.req.url || '/'),
    headers,
    query: getQuery(event) as Record<string, QueryValue>,
    method: event.node.req.method || 'GET'
  }
  return applyVerdict(event, guard(ctx))
}

// Nuxt/Nitro 里 defineEventHandler 由自动导入注入；而在纯 node + tsx 环境下
// （如 test/security/auth.test.ts 直接 import 本模块）没有该全局。
// typeof 对未声明标识符是安全的，取不到时退化为普通 handler —— Nitro/h3 同样接受
// 普通函数作为中间件（h3 的 toEventHandler 是恒等函数），因此退回分支不会把这
// 道闸静默摘掉。
function wrapHandler(handler: (event: H3Event) => unknown) {
  if (typeof defineEventHandler === 'function') {
    return defineEventHandler(handler) as unknown as (event: H3Event) => unknown
  }
  return handler
}

export default wrapHandler(authMiddleware)
