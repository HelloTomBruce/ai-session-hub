import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { AIEvaluationResult, ReportStore } from '@session-hub/analyzer'

// 类型契约已归属 @session-hub/analyzer；此处 re-export 保持既有 import 兼容
export type { AIEvaluationResult }

// AI 深度诊断报告的统一存储目录（与 diagnose 相关接口保持一致）
export const DIAGNOSIS_DIR = path.join(os.homedir(), '.session-hub', 'diagnoses')

/**
 * 返回已完成 AI 深度诊断（即存在本地诊断报告文件）的会话 ID 集合。
 * 诊断报告以 `~/.session-hub/diagnoses/{sessionId}.json` 形式落盘，
 * 这里以文件作为「是否诊断过」的唯一事实来源，保证与详情页读取逻辑一致。
 */
export function getDiagnosedSessionIds(): Set<string> {
  try {
    if (!fs.existsSync(DIAGNOSIS_DIR)) return new Set()
    return new Set(
      fs.readdirSync(DIAGNOSIS_DIR)
        .filter(name => name.endsWith('.json'))
        .map(name => name.slice(0, -'.json'.length))
    )
  } catch {
    return new Set()
  }
}

/** 为会话列表标注 extra.aiDiagnosed 标记（原地修改） */
export function markDiagnosedSessions(sessions: Array<{ id: string, extra?: Record<string, unknown> }>): void {
  const diagnosedIds = getDiagnosedSessionIds()
  for (const session of sessions) {
    if (!session.extra) session.extra = {}
    session.extra.aiDiagnosed = diagnosedIds.has(session.id)
  }
}

/**
 * 宿主的文件持久化 ReportStore 实现（@session-hub/analyzer 诊断管线注入用）。
 */
export const fileReportStore: ReportStore = {
  save(sessionId, report) {
    try {
      if (!fs.existsSync(DIAGNOSIS_DIR)) fs.mkdirSync(DIAGNOSIS_DIR, { recursive: true })
      fs.writeFileSync(path.join(DIAGNOSIS_DIR, `${sessionId}.json`), JSON.stringify(report, null, 2), 'utf-8')
    } catch (err) {
      console.warn('[DiagnosisService] Failed to persist diagnosis report:', err)
    }
  },
  load(sessionId) {
    try {
      const filePath = path.join(DIAGNOSIS_DIR, `${sessionId}.json`)
      if (!fs.existsSync(filePath)) return null
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as AIEvaluationResult
    } catch {
      return null
    }
  }
}
