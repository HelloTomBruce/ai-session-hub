/**
 * 极简入参校验层（零依赖）。
 *
 * 背景：67 个 API 路由此前全靠 `query.x as string` 手写断言，非法入参要么静默变成
 * `undefined`，要么把 $ 数组/对象直接拼进 SQL 参数。这里提供一组小而明确的校验器：
 * 失败一律抛 400 `createError`，成功返回窄化后的类型。
 *
 * 约定：只做「形状与边界」校验，不做业务校验（业务校验留在各服务里）。
 *
 * 依赖 Nitro 自动导入的 `createError` / `readBody`（不做显式 import，
 * 因为 h3 不是本项目的直接依赖）。单测里可先把 `globalThis.createError`
 * stub 成普通 Error 工厂，再动态 import 本模块。
 */

export interface StringRule {
  field: string
  min?: number
  max?: number
  /** 是否 trim（默认 true） */
  trim?: boolean
  /** 允许的取值集合 */
  oneOf?: readonly string[]
}

export interface EntityRef {
  id: string
  cli: string
}

export interface IntRule {
  field: string
  min?: number
  max?: number
  fallback?: number
}

function fail(message: string): never {
  throw createError({ statusCode: 400, statusMessage: 'Bad Request', message })
}

/** 必填字符串 */
export function requireString(value: unknown, rule: StringRule): string {
  if (typeof value !== 'string') fail(`${rule.field} 必须是字符串`)
  const v = rule.trim === false ? value : value.trim()
  if (rule.min !== undefined && v.length < rule.min) fail(`${rule.field} 长度不能小于 ${rule.min}`)
  if (rule.max !== undefined && v.length > rule.max) fail(`${rule.field} 长度不能超过 ${rule.max}`)
  if (rule.oneOf && !rule.oneOf.includes(v)) fail(`${rule.field} 必须是 ${rule.oneOf.join(' / ')} 之一`)
  return v
}

/** 可选字符串：缺省/空串返回 undefined */
export function optionalString(value: unknown, rule: StringRule): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return requireString(value, rule)
}

/** 字符串数组（去重、去空） */
export function requireStringArray(value: unknown, rule: StringRule & { maxItems?: number }): string[] {
  if (!Array.isArray(value)) fail(`${rule.field} 必须是字符串数组`)
  if (rule.maxItems !== undefined && value.length > rule.maxItems) fail(`${rule.field} 最多 ${rule.maxItems} 项`)
  const out: string[] = []
  for (const item of value) {
    const v = requireString(item, rule)
    if (v && !out.includes(v)) out.push(v)
  }
  return out
}

/** 会话实体引用数组：[{ id, cli }]，用于批量操作路由 */
export function requireEntityRefs(value: unknown, rule: { field: string, maxItems?: number }): EntityRef[] {
  if (!Array.isArray(value)) fail(`${rule.field} 必须是数组`)
  if (rule.maxItems !== undefined && value.length > rule.maxItems) fail(`${rule.field} 最多 ${rule.maxItems} 项`)
  return value.map((item, index) => {
    if (item === null || typeof item !== 'object') fail(`${rule.field}[${index}] 必须是对象`)
    const record = item as Record<string, unknown>
    return {
      id: requireString(record.id, { field: `${rule.field}[${index}].id`, min: 1, max: 300 }),
      cli: requireString(record.cli, { field: `${rule.field}[${index}].cli`, min: 1, max: 60 })
    }
  })
}

/** 整数（query/body 里的字符串数字也接受） */
export function requireInt(value: unknown, rule: IntRule): number {
  const raw = typeof value === 'string' ? value.trim() : value
  if (raw === undefined || raw === null || raw === '') {
    if (rule.fallback !== undefined) return rule.fallback
    fail(`${rule.field} 必须是整数`)
  }
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n)) fail(`${rule.field} 必须是整数`)
  if (rule.min !== undefined && n < rule.min) fail(`${rule.field} 不能小于 ${rule.min}`)
  if (rule.max !== undefined && n > rule.max) fail(`${rule.field} 不能大于 ${rule.max}`)
  return n
}

/** 布尔（接受 true/false/'true'/'false'/1/0） */
export function optionalBool(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'boolean') return value
  if (value === 'true' || value === 1 || value === '1') return true
  if (value === 'false' || value === 0 || value === '0') return false
  fail(`${field} 必须是布尔值`)
}

/** 读取并校验 JSON body，body 非法时返回 400 而不是 500 */
export async function readJsonBody<T = Record<string, unknown>>(event: Parameters<typeof readBody>[0]): Promise<T> {
  try {
    const body = await readBody(event)
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      fail('请求体必须是 JSON 对象')
    }
    return body as T
  } catch (err) {
    // readBody 对畸形 JSON 抛的是 h3 的解析错误，统一收敛成 400
    if ((err as { statusCode?: number }).statusCode === 400) throw err
    fail('请求体不是合法 JSON')
  }
}
