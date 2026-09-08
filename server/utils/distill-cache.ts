import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const CACHE_DIR = path.join(os.homedir(), '.session-hub', 'cache', 'distill')

export interface SingleSessionSummary {
  sessionId: string
  platform: string
  title: string
  cwd: string
  updatedAt: number
  actions: string[]
  decisions: Array<{
    title: string
    context: string
    decision: string
    consequence?: string
  }>
  learnings: string[]
  todos: string[]
  tools: string[]
}

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true })
  }
}

function getCacheKey(platform: string, id: string, updatedAt: number): string {
  // Sanitize id for filename
  const cleanId = id.replace(/[^a-zA-Z0-9_-]/g, '_')
  return `${platform}_${cleanId}_${updatedAt}.json`
}

export function getCachedSessionSummary(platform: string, id: string, updatedAt: number): SingleSessionSummary | null {
  try {
    ensureCacheDir()
    const filePath = path.join(CACHE_DIR, getCacheKey(platform, id, updatedAt))
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      return data as SingleSessionSummary
    }
  } catch (e) {
    console.error('[DistillCache] Error reading cache:', e)
  }
  return null
}

export function saveCachedSessionSummary(summary: SingleSessionSummary): void {
  try {
    ensureCacheDir()
    const filePath = path.join(CACHE_DIR, getCacheKey(summary.platform, summary.sessionId, summary.updatedAt))
    fs.writeFileSync(filePath, JSON.stringify(summary, null, 2), 'utf-8')
  } catch (e) {
    console.error('[DistillCache] Error writing cache:', e)
  }
}
