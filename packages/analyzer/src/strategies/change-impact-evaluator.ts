/**
 * change-impact：基于归一化证据（真实补丁文本 + 改动文件路径）评估
 * 代码结构与契约影响。不再对会话正文里出现的技术关键词计分。
 */
import type { EvaluationContext, IEvaluatorStrategy, Signal, StrategyScoreResult } from '../types.js'
import type { EvaluationEvidence } from '../evidence/normalize.js'

const CONTRACT_RE = /(export\s+)?(interface|type|enum)\s+[A-Z]|(export\s+)?(abstract\s+)?class\s+[A-Z]|defineEventHandler|router\.(get|post|put|delete|patch)\b|createTable\b|alterTable\b|CREATE\s+TABLE|ALTER\s+TABLE|\bmigration\b/i
const ERROR_HANDLING_RE = /try\s*\{|catch\s*[({]|throw\s+new\s+\w*Error|retry|timeout|abort|transaction/i
const ROOT_CONFIG_RE = /(^|\/)(nuxt\.config|package\.json|tsconfig(\..*)?|pnpm-workspace\.yaml|eslint\.config|vitest\.config|vite\.config|Dockerfile|docker-compose|pipeline|ci\.ya?ml)/i
const STYLE_ONLY_RE = /^\s*(\/\*|\/\/|\*|[-+]?\s*(color|background|padding|margin|border-radius|font-size)\s*:|[-+]?\s*$)/

export class ChangeImpactEvaluator implements IEvaluatorStrategy {
  readonly name = 'change-impact'

  isAvailable(): boolean {
    return true
  }

  async evaluate(_ctx: EvaluationContext, ev: EvaluationEvidence): Promise<StrategyScoreResult> {
    const signals: Signal[] = []
    const files = ev.changedFiles
    const fileCount = files.length

    if (fileCount === 0) {
      return {
        strategyName: this.name,
        rawScore: 15,
        confidence: 0.95,
        signals: [{
          code: 'NO_CODE_CHANGE',
          polarity: 'neutral',
          message: '未检测到实质性文件代码改动（纯对话或查询）'
        }],
        details: { fileCount: 0, hasPatchContent: false }
      }
    }

    // 有真实改动即 30 基线（外科手术式小修复不该被文件数惩罚到 20 出头）
    let score = 30
    // 1. 改动面
    if (fileCount >= 3) {
      score += 15
      signals.push({ code: 'MULTI_FILE_CHANGE', polarity: 'positive', message: `涉及跨 ${fileCount} 个文件协同修改` })
    } else if (fileCount === 2) {
      score += 8
      signals.push({ code: 'MULTI_FILE_CHANGE', polarity: 'positive', message: `涉及 ${fileCount} 个文件修改` })
    }

    // 2. 契约信号（仅在真实补丁文本上判定，命中任一一组 +30 不叠加）
    const hasContractChange = CONTRACT_RE.test(ev.patchText)
    if (hasContractChange) {
      score += 35
      signals.push({
        code: 'CONTRACT_CHANGE',
        polarity: 'positive',
        message: '补丁包含类型契约、接口定义、路由/数据表结构等架构变动',
        evidence: ev.patchText.match(CONTRACT_RE)?.[0]
      })
    }

    // 3. 容错/并发逻辑 +12
    if (ERROR_HANDLING_RE.test(ev.patchText)) {
      score += 12
      signals.push({ code: 'ERROR_HANDLING', polarity: 'positive', message: '包含异常保护、重试超时或事务逻辑' })
    }

    // 4. 根配置文件被修改（按路径，而非聊天提及）+10
    const configFiles = files.filter(f => ROOT_CONFIG_RE.test(f.path)).map(f => f.path)
    if (configFiles.length > 0) {
      score += 10
      signals.push({ code: 'ROOT_CONFIG_CHANGE', polarity: 'positive', message: `修改工程根配置：${configFiles.join(', ')}` })
    }

    // 5. 平凡改动回调：有效行少且仅注释/样式/文案 → 封顶 35
    const effectiveLines = files.flatMap(f => f.effectiveLines)
    const nonEmpty = effectiveLines.filter(l => l.length > 0)
    const onlyStyle = nonEmpty.length > 0 && nonEmpty.every(l => STYLE_ONLY_RE.test(l))
    if (nonEmpty.length < 20 && onlyStyle && score > 35) {
      score = 35
      signals.push({ code: 'TRIVIAL_STYLE_CHANGE', polarity: 'negative', message: '改动以局部样式/注释/文案为主，结构权重回调' })
    }

    // 有补丁内容 → 高置信；仅能从工具名推断 → 诚实降权
    const hasPatchContent = ev.patchText.trim().length > 0
    if (!hasPatchContent) {
      signals.push({ code: 'PATCH_CONTENT_MISSING', polarity: 'neutral', message: '仅能从工具名推断改动，缺少补丁内容，置信度降权' })
    }

    return {
      strategyName: this.name,
      rawScore: Math.min(100, Math.max(10, score)),
      confidence: hasPatchContent ? 0.9 : 0.6,
      signals,
      details: {
        fileCount,
        files: files.map(f => f.path),
        hasContractChange,
        hasPatchContent
      }
    }
  }
}
