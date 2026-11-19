/**
 * 服务端统一日志出口。
 *
 * 背景：此前 89 处散落的 `console.log / warn / error` 没有级别、无法静音、格式各异。
 * 这里做一层薄封装：级别由 `HUB_LOG_LEVEL`（debug|info|warn|error，默认 info）控制，
 * 其余保持 `console` 的可变参数语义，避免一次性改变 89 处调用点的可读性。
 *
 * 约定：新增服务端日志一律用 logger，不要直接用 console（eslint 会对 server/ 报警）。
 */
type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

function currentLevel(): LogLevel {
  const raw = (process.env.HUB_LOG_LEVEL || 'info').toLowerCase()
  return (raw in ORDER ? raw : 'info') as LogLevel
}

function enabled(level: LogLevel): boolean {
  return ORDER[level] >= ORDER[currentLevel()]
}

function emit(level: LogLevel, args: unknown[]): void {
  if (!enabled(level)) return
  const fn = level === 'debug' ? console.debug : level === 'info' ? console.info : level === 'warn' ? console.warn : console.error
  fn(...args)
}

export const logger = {
  debug: (...args: unknown[]) => emit('debug', args),
  info: (...args: unknown[]) => emit('info', args),
  warn: (...args: unknown[]) => emit('warn', args),
  error: (...args: unknown[]) => emit('error', args)
}
