import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const LOG_DIR = path.join(os.homedir(), '.session-hub', 'logs')
const LOG_PATH = path.join(LOG_DIR, 'plugins.log')
const MAX_LOG_BYTES = 2 * 1024 * 1024

/**
 * 插件体系持久化错误日志。
 * 解决"异常日志不满足要求"（全部 console 输出、无持久化）：
 * 关键失败除 console 外追加写入 ~/.session-hub/logs/plugins.log，便于离线排障。
 */
export function logPluginEvent(level: 'error' | 'warn' | 'info', pluginId: string, message: string, detail?: unknown): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    plugin: pluginId,
    message,
    detail: detail instanceof Error ? detail.message : (detail !== undefined ? String(detail) : undefined)
  })

  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true })
    }

    // 简单轮转：超过上限时截断旧内容
    try {
      const stat = fs.statSync(LOG_PATH)
      if (stat.size > MAX_LOG_BYTES) {
        const tail = fs.readFileSync(LOG_PATH, 'utf-8').slice(-MAX_LOG_BYTES / 2)
        fs.writeFileSync(LOG_PATH, tail, 'utf-8')
      }
    } catch {
      // 文件不存在等情况忽略
    }

    fs.appendFileSync(LOG_PATH, line + '\n', 'utf-8')
  } catch {
    // 日志写入失败不阻断主流程
  }

  if (level === 'error') {
    console.error(`[PluginLog:${pluginId}] ${message}`, detail ?? '')
  } else if (level === 'warn') {
    console.warn(`[PluginLog:${pluginId}] ${message}`, detail ?? '')
  } else {
    console.log(`[PluginLog:${pluginId}] ${message}`, detail ?? '')
  }
}
