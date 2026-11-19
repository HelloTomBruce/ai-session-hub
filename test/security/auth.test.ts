import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  COOKIE_NAME,
  MISSING_TOKEN_HINT,
  createAuthGuard,
  devBindHost,
  isLoopbackAddress,
  isLoopbackHostname,
  maskToken,
  normalizePath,
  pickQueryString,
  readCookieValue,
  readHubToken,
  readTokenFromHeaders,
  resolveRemoteAddress,
  stripTokenParam,
  tokensEqual,
  trustUnknownPeerInDev,
  type AuthGuardContext
} from '../../server/middleware/02.auth'

// 判定逻辑（createAuthGuard）是纯函数：只吃 ctx、吐 verdict，不碰 h3 event，
// 因此这里不需要起 Nitro / 连数据库，直接跑 `node --import tsx --test`。

const LAN_IP = '192.168.3.227'
const SECRET = 'hub-token-7c1f9a2e5b6d4c8f'

function makeCtx(overrides: Partial<AuthGuardContext> = {}): AuthGuardContext {
  return {
    remoteAddress: LAN_IP,
    path: '/api/sessions',
    headers: {},
    query: {},
    method: 'GET',
    ...overrides
  }
}

function guardWith(token: string | null) {
  return createAuthGuard(() => token)
}

test('回环地址识别：IPv4 / IPv6 / IPv4-mapped / 127.0.0.0/8', () => {
  for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '127.0.0.53', 'LOCALHOST', ' 127.0.0.1 ']) {
    assert.equal(isLoopbackAddress(address), true, `应判定为回环: ${address}`)
  }
  for (const address of [LAN_IP, '10.0.0.7', '::ffff:192.168.3.227', '', undefined]) {
    assert.equal(isLoopbackAddress(address), false, `不应判定为回环: ${String(address)}`)
  }
})

test('回环请求直接放行（未配置 token 也放行）', () => {
  const guard = guardWith(null)
  for (const remoteAddress of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    assert.deepEqual(guard(makeCtx({ remoteAddress })), { action: 'allow' }, `回环应放行: ${remoteAddress}`)
  }
})

test('非回环 + 未配置 token：一律拒绝，并提示配置 HUB_TOKEN', () => {
  const verdict = guardWith(null)(makeCtx())
  assert.equal(verdict.action, 'deny')
  assert.equal(verdict.action === 'deny' ? verdict.error : '', MISSING_TOKEN_HINT)
  assert.match(verdict.action === 'deny' ? verdict.error : '', /仅允许本机访问/)
  assert.match(verdict.action === 'deny' ? verdict.error : '', /HUB_TOKEN/)
})

test('非回环 + 已配置 token 但请求没带：拒绝', () => {
  const verdict = guardWith(SECRET)(makeCtx())
  assert.equal(verdict.action, 'deny')
  assert.match(verdict.action === 'deny' ? verdict.error : '', /未授权/)
})

test('正确 Bearer token 放行', () => {
  const guard = guardWith(SECRET)
  const verdict = guard(makeCtx({ headers: { authorization: `Bearer ${SECRET}` } }))
  assert.deepEqual(verdict, { action: 'allow' })
  // 大小写不敏感 + 多余空格容错
  assert.deepEqual(
    guard(makeCtx({ headers: { authorization: `  bearer   ${SECRET}  ` } })),
    { action: 'allow' }
  )
})

test('x-hub-token 头放行', () => {
  const verdict = guardWith(SECRET)(makeCtx({ headers: { 'x-hub-token': SECRET } }))
  assert.deepEqual(verdict, { action: 'allow' })
})

test('Cookie hub_token 载体放行', () => {
  const guard = guardWith(SECRET)
  const verdict = guard(makeCtx({
    headers: { cookie: `theme=dark; hub_token=${SECRET}; lang=zh` }
  }))
  assert.deepEqual(verdict, { action: 'allow' })
})

test('错误 token 拒绝，且错误信息不回显完整 token', () => {
  const wrong = 'wrong-token-abcdefgh'
  const verdict = guardWith(SECRET)(makeCtx({ headers: { authorization: `Bearer ${wrong}` } }))
  assert.equal(verdict.action, 'deny')
  const error = verdict.action === 'deny' ? verdict.error : ''
  assert.match(error, /不匹配/)
  assert.equal(error.includes(wrong), false, '不得回显完整 token')
  assert.equal(error.includes(SECRET), false, '不得回显正确 token')
  assert.equal(error.includes(wrong.slice(0, 4)), true, '可显示前 4 位便于排查')
})

test('长度不等的 token 比不抛错（timingSafeEqual 已被长度归一）', () => {
  assert.doesNotThrow(() => tokensEqual('short', SECRET))
  assert.equal(tokensEqual('short', SECRET), false)
  assert.equal(tokensEqual(SECRET, SECRET), true)
  assert.equal(tokensEqual('', SECRET), false)
  assert.equal(tokensEqual(undefined, SECRET), false)
  assert.equal(tokensEqual(SECRET, null), false)
})

test('URL 带正确 ?token= 且为页面导航：下发 Cookie + 302 去掉 token 参数', () => {
  const verdict = guardWith(SECRET)(makeCtx({
    path: '/sessions',
    query: { token: SECRET, tab: 'recent' }
  }))
  assert.equal(verdict.action, 'allow-set-cookie')
  if (verdict.action === 'allow-set-cookie') {
    assert.equal(verdict.token, SECRET)
    assert.equal(verdict.redirectUrl, '/sessions?tab=recent')
  }
})

test('URL 带正确 ?token= 的 API 请求：下发 Cookie 但直接放行、不做 302', () => {
  const verdict = guardWith(SECRET)(makeCtx({ query: { token: SECRET } }))
  assert.equal(verdict.action, 'allow-set-cookie')
  if (verdict.action === 'allow-set-cookie') {
    assert.equal(verdict.redirectUrl, undefined)
  }
})

test('URL 带错误 ?token=：非回环 API 请求拒绝', () => {
  const verdict = guardWith(SECRET)(makeCtx({ query: { token: 'nope' } }))
  assert.equal(verdict.action, 'deny')
})

test('放行清单：OPTIONS 预检、非 /api 页面、换票端点', () => {
  const guard = guardWith(SECRET)
  assert.deepEqual(guard(makeCtx({ method: 'OPTIONS' })), { action: 'allow' })
  assert.deepEqual(guard(makeCtx({ path: '/', headers: { accept: 'text/html' } })), { action: 'allow' })
  assert.deepEqual(guard(makeCtx({ path: '/_nuxt/app.js' })), { action: 'allow' })
  // 换票端点必须能在「还没有 Cookie」时被调用，校验由路由自己做
  assert.deepEqual(guard(makeCtx({ path: '/api/auth/token', method: 'POST' })), { action: 'allow' })
})

test('路径归一：event.path 带 query 也能识别 /api', () => {
  assert.equal(normalizePath('/api/sessions?limit=1'), '/api/sessions')
  assert.equal(normalizePath('/api'), '/api')
  assert.equal(normalizePath(''), '/')
  assert.equal(guardWith(SECRET)(makeCtx({ path: '/api/sessions?token=bad' })).action, 'deny')
})

test('辅助函数：cookie 解析、query 取值、参数剥离、掩码', () => {
  assert.equal(readCookieValue(`a=1; ${COOKIE_NAME}=abc%20def`, COOKIE_NAME), 'abc def')
  assert.equal(readCookieValue('a=1', COOKIE_NAME), null)
  assert.equal(readCookieValue(undefined, COOKIE_NAME), null)

  assert.equal(pickQueryString({ token: ' x ' }, 'token'), 'x')
  assert.equal(pickQueryString({ token: ['x', 'y'] }, 'token'), null, '重复参数不接受')
  assert.equal(pickQueryString({}, 'token'), null)

  assert.equal(stripTokenParam('/sessions', { token: 'x', tab: 'a' }), '/sessions?tab=a')
  assert.equal(stripTokenParam('/sessions', { token: 'x' }), '/sessions')

  assert.equal(maskToken('abcdefghijkl').startsWith('abcd'), true)
  assert.equal(maskToken('abcdefghijkl').includes('efghijkl'), false)
  assert.equal(maskToken(''), '<未提供>')
})

test('readTokenFromHeaders 载体优先级：Bearer > x-hub-token > Cookie', () => {
  assert.equal(
    readTokenFromHeaders({
      'authorization': 'Bearer from-header',
      'x-hub-token': 'from-x-header',
      'cookie': `${COOKIE_NAME}=from-cookie`
    }),
    'from-header'
  )
  assert.equal(
    readTokenFromHeaders({ 'x-hub-token': 'from-x-header', 'cookie': `${COOKIE_NAME}=from-cookie` }),
    'from-x-header'
  )
  assert.equal(readTokenFromHeaders({ cookie: `${COOKIE_NAME}=from-cookie` }), 'from-cookie')
  assert.equal(readTokenFromHeaders({}), null)
})

test('readHubToken：HUB_TOKEN 优先，其次 $HUB_HOME/hub-token 文件', () => {
  const previousHome = process.env.HUB_HOME
  const previousToken = process.env.HUB_TOKEN
  const dir = mkdtempSync(join(tmpdir(), 'hub-auth-test-'))

  try {
    writeFileSync(join(dir, 'hub-token'), `${SECRET}\n`, 'utf8')
    process.env.HUB_HOME = dir
    delete process.env.HUB_TOKEN
    assert.equal(readHubToken(), SECRET, '应读取 HUB_HOME 下的 hub-token 并 trim')

    process.env.HUB_TOKEN = 'env-wins'
    assert.equal(readHubToken(), 'env-wins', 'HUB_TOKEN 应优先于文件')

    delete process.env.HUB_TOKEN
    rmSync(join(dir, 'hub-token'))
    assert.equal(readHubToken(), null, '文件不存在时应视为未配置')
  } finally {
    rmSync(dir, { recursive: true, force: true })
    if (previousHome === undefined) delete process.env.HUB_HOME
    else process.env.HUB_HOME = previousHome
    if (previousToken === undefined) delete process.env.HUB_TOKEN
    else process.env.HUB_TOKEN = previousToken
  }
})

// ---------------------------------------------------------------------------
// dev worker 代理场景：拿不到 remoteAddress 时不许无条件信任
//
// 实测：Nuxt dev 的 Nitro worker 监听 unix socket，外层代理把客户端自带的
// x-forwarded-for 原样透传（局域网机器传 `X-Forwarded-For: 127.0.0.1` 能抵达），
// 所以「无 peer + XFF 回环」绝不能作为放行依据。
// ---------------------------------------------------------------------------

test('未知对端 + 默认配置：不因回环 Host 放行', () => {
  const verdict = guardWith(null)(makeCtx({ remoteAddress: undefined, headers: { host: '127.0.0.1:3877' } }))
  assert.equal(verdict.action, 'deny', '未知来源默认必须走 token 校验')
})

test('未知对端 + dev 回环绑定 + 回环 Host：按本机放行', () => {
  const guard = createAuthGuard(() => null, { trustUnknownPeer: () => true })
  assert.deepEqual(
    guard(makeCtx({ remoteAddress: undefined, headers: { host: '127.0.0.1:3877' } })),
    { action: 'allow' }
  )
  assert.deepEqual(
    guard(makeCtx({ remoteAddress: undefined, headers: { host: '[::1]:3877' } })),
    { action: 'allow' }
  )
  // 但 Host 是局域网地址（说明请求确实来自网卡）时仍然拒绝
  assert.equal(
    guard(makeCtx({ remoteAddress: undefined, headers: { host: `${LAN_IP}:3877` } })).action,
    'deny'
  )
})

test('伪造 x-forwarded-for: 127.0.0.1 不能绕过（默认不信任 XFF）', () => {
  const guard = guardWith(SECRET)
  const verdict = guard(makeCtx({
    remoteAddress: resolveRemoteAddress(undefined, { 'x-forwarded-for': '127.0.0.1' }),
    headers: { 'host': `${LAN_IP}:3877`, 'x-forwarded-for': '127.0.0.1' }
  }))
  assert.equal(verdict.action, 'deny', 'XFF 可伪造，默认不得作为来源依据')
})

test('resolveRemoteAddress：socket 优先，XFF 仅在 HUB_TRUST_PROXY=1 时降级启用', () => {
  assert.equal(resolveRemoteAddress('127.0.0.1', {}, {}), '127.0.0.1')
  assert.equal(resolveRemoteAddress(undefined, { 'x-forwarded-for': '127.0.0.1' }, {}), undefined)
  assert.equal(
    resolveRemoteAddress(undefined, { 'x-forwarded-for': '10.0.0.9, 10.0.0.10' }, { HUB_TRUST_PROXY: '1' }),
    '10.0.0.9'
  )
  assert.equal(resolveRemoteAddress(undefined, {}, { HUB_TRUST_PROXY: '1' }), undefined)
})

test('trustUnknownPeerInDev：仅 dev + 回环绑定成立', () => {
  assert.equal(trustUnknownPeerInDev({ NODE_ENV: 'development' }), true)
  assert.equal(trustUnknownPeerInDev({ NODE_ENV: 'development', HUB_HOST: '127.0.0.1' }), true)
  assert.equal(trustUnknownPeerInDev({ NODE_ENV: 'development', HUB_HOST: 'localhost' }), true)
  assert.equal(trustUnknownPeerInDev({ NODE_ENV: 'development', HUB_HOST: '[::1]' }), true)
  assert.equal(trustUnknownPeerInDev({ NODE_ENV: 'development', HUB_HOST: '::ffff:127.0.0.1' }), true)
  // 显式开放（双栈通配 / 网卡地址）→ 未知来源不可信
  assert.equal(trustUnknownPeerInDev({ NODE_ENV: 'development', HUB_HOST: '::' }), false)
  assert.equal(trustUnknownPeerInDev({ NODE_ENV: 'development', HUB_HOST: '0.0.0.0' }), false)
  assert.equal(trustUnknownPeerInDev({ NODE_ENV: 'development', HUB_HOST: LAN_IP }), false)
  // 生产永远不可信
  assert.equal(trustUnknownPeerInDev({ NODE_ENV: 'production' }), false)
  assert.equal(devBindHost({}), '127.0.0.1')
  assert.equal(devBindHost({ HUB_HOST: '::' }), '::')
})

test('isLoopbackHostname：Host 头解析', () => {
  for (const host of ['127.0.0.1:3877', 'localhost:3877', '[::1]:3877', '127.0.0.1', 'LOCALHOST']) {
    assert.equal(isLoopbackHostname(host), true, `应识别为回环 Host: ${host}`)
  }
  for (const host of [`${LAN_IP}:3877`, 'example.com', '10.0.0.1', '', undefined]) {
    assert.equal(isLoopbackHostname(host), false, `不应识别为回环 Host: ${String(host)}`)
  }
})
