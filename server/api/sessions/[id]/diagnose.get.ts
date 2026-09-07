import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { AIEvaluationResult } from '../../../utils/evaluator-rubric'

const DIAGNOSIS_DIR = path.join(os.homedir(), '.session-hub', 'diagnoses')

export default defineEventHandler((event) => {
  const sessionId = getRouterParam(event, 'id')
  if (!sessionId) {
    throw createError({ statusCode: 400, message: 'Session ID is required' })
  }

  const filePath = path.join(DIAGNOSIS_DIR, `${sessionId}.json`)
  if (!fs.existsSync(filePath)) {
    return {
      success: true,
      hasSavedReport: false,
      data: null
    }
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(content)
    return {
      success: true,
      hasSavedReport: true,
      data: parsed
    }
  } catch (err) {
    return {
      success: true,
      hasSavedReport: false,
      data: null
    }
  }
})
