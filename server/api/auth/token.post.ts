import type { H3Event } from 'h3'

import {
  COOKIE_MAX_AGE,
  COOKIE_NAME,
  maskToken,
  readHubToken,
  tokensEqual
} from '../../middleware/02.auth'

/**
 * POST /api/auth/token  body: { token: string }
 *
 * 用途：局域网内的浏览器/前端手工换票 —— 用一次 token POST 换 HttpOnly Cookie，
 * 之后同源请求自动携带 Cookie，不必把 token 写进 localStorage 或 URL。
 *
 * 注意：本路由在 server/middleware/02.auth.ts 的白名单里（TOKEN_EXCHANGE_PATH），
 * 因为它就是「没有凭证 → 拿到凭证」的入口，必须能在无 Cookie 状态下被调用。
 * 校验失败一律 401 + { success: false, error }，且不回显 token 原文。
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ token?: unknown }>(event).catch(() => ({} as { token?: unknown }))
  const provided = typeof body?.token === 'string' ? body.token.trim() : ''
  const expected = readHubToken()

  if (!expected) {
    setResponseStatus(event, 401)
    setHeader(event, 'cache-control', 'no-store')
    return {
      success: false,
      error: '服务未配置 HUB_TOKEN（或 ~/.session-hub/hub-token），非本机请求无法换票。'
    }
  }

  if (!provided || !tokensEqual(provided, expected)) {
    setResponseStatus(event, 401)
    setHeader(event, 'cache-control', 'no-store')
    return {
      success: false,
      error: `token 不匹配（收到 ${maskToken(provided)}）。`
    }
  }

  setCookie(event, COOKIE_NAME, expected, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
    // 局域网多为 http 明文：secure 置 true 会被浏览器直接丢弃，这里按实际协议判定
    secure: isSecureRequest(event)
  })

  return {
    success: true,
    data: {
      cookie: COOKIE_NAME,
      maxAge: COOKIE_MAX_AGE
    }
  }
})

function isSecureRequest(event: H3Event): boolean {
  const req = event.node.req
  if (req.socket && 'encrypted' in req.socket && req.socket.encrypted) return true
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0]?.trim().toLowerCase() || ''
  return forwardedProto === 'https'
}
