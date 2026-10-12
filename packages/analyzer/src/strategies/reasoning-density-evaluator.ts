/**
 * reasoning-density：推理信息密度。thought + assistant 正文双通道，
 * thought 是加分项而非门票；thrashing/重复率基于结构化条件，减少中文误伤。
 */
import type { EvaluationContext, IEvaluatorStrategy, Signal, StrategyFlags, StrategyScoreResult } from '../types.js'
import type { EvaluationEvidence } from '../evidence/normalize.js'

const CODE_OR_STACK_RE = /```[\s\S]*?```|^\s{2,}at\s.+$/gm

const TRADEOFF_RE = /(trade[- ]?off|权衡|方案对比|之所以选|相比(于|较)?|优缺点|二者取|备选方案)/i
const ROOT_CAUSE_RE = /(根因|根本原因|root cause|本质原因|真正原因)/i
const ERROR_CONTEXT_RE = /(报错|错误|异常|失败|timeout|超时|broken|为什么.*失败|泄漏|不生效|无法|重复(?:请求|扣款|执行|连接|提交|下单))/i
// 根因陈述必须伴随因果解释，避免裸关键词触发
const CAUSAL_EXPLAIN_RE = /(因为|由于|导致|引发|引起|触发|没有|未|缺少|漏在|在于)/
const GOTCHA_RE = /(注意点|陷阱|避坑|坑点|边界(?:条件|情况|场景|case)|前提条件|不能直接|don'?t|must not)/i
const GOTCHA_CONTEXT_RE = /(否则|不然|会导致|否则会|注意：|注意,)/i
const CAUSAL_HEADINGS_RE = /^#{1,4}\s|^\s*[-*]\s|因此|所以|因为|原因是|由于|分析|排查过程|结论[是为：]/m

export class ReasoningDensityEvaluator implements IEvaluatorStrategy {
  readonly name = 'reasoning-density'

  isAvailable(): boolean {
    return true
  }

  async evaluate(_ctx: EvaluationContext, ev: EvaluationEvidence): Promise<StrategyScoreResult> {
    const signals: Signal[] = []
    const flags: StrategyFlags = {}
    let score = 30
    const turnCount = ev.metrics.turnCount

    if (ev.turns.filter(t => t.userText.trim()).length === 0) {
      return {
        strategyName: this.name,
        rawScore: 10,
        confidence: 0.95,
        signals: [{ code: 'EMPTY_SESSION', polarity: 'neutral', message: '空会话或无效交互' }],
        details: { turnCount: 0 }
      }
    }

    // 1. 轮次（1 轮不再加"迭代深度"分）
    if (turnCount >= 2 && turnCount <= 8) {
      score += 12
      signals.push({ code: 'HEALTHY_TURNS', polarity: 'positive', message: `交互轮次健康（${turnCount} 轮），有迭代闭环` })
    } else if (turnCount >= 9 && turnCount <= 12) {
      score += 6
    } else if (turnCount > 15) {
      score -= 8
      signals.push({ code: 'TOO_MANY_TURNS', polarity: 'negative', message: `轮次过多（${turnCount} 轮），可能存在拉扯` })
    }

    // 2. 推理密度：thought 优先，但 assistant 正文结构化推理可拿 80%
    const thoughtChars = ev.thoughtText.length
    const charsPerTurn = Math.round((thoughtChars + (thoughtChars === 0 ? ev.assistantText.length : 0)) / Math.max(1, turnCount))
    const hasThought = thoughtChars > 50
    const reasonText = hasThought ? ev.thoughtText : ev.assistantText
    const reasonCap = hasThought ? 1.0 : 0.8

    if (thoughtChars === 0) {
      signals.push({ code: 'NO_THOUGHT_CHANNEL', polarity: 'neutral', message: '该平台/会话无 thinking 数据，按回复正文结构化程度评分' })
    }

    // 无 thought 通道时回复正文天然更短，健康区下限放宽到 120 字/轮
    const densityMin = hasThought ? 300 : 120
    if (charsPerTurn >= densityMin && charsPerTurn <= 4000) {
      score += Math.round(20 * reasonCap)
      signals.push({
        code: 'HEALTHY_DENSITY',
        polarity: 'positive',
        message: hasThought ? `推理密度健康（约 ${charsPerTurn} 字/轮）` : `回复结构化推理充分（约 ${charsPerTurn} 字/轮）`
      })
    } else if (charsPerTurn > 4000) {
      score += Math.round(8 * reasonCap)
    } else {
      score -= 5
    }

    // 3. 权衡/根因/避坑（收窄词典 + 上下文证据要求；每类最多一次）
    if (TRADEOFF_RE.test(reasonText)) {
      score += 12
      signals.push({ code: 'TRADEOFF_ANALYSIS', polarity: 'positive', message: '识别到技术方案权衡分析' })
    }
    const hasRootCause = ROOT_CAUSE_RE.test(reasonText)
      && (ERROR_CONTEXT_RE.test(reasonText) || CAUSAL_EXPLAIN_RE.test(reasonText))
    if (hasRootCause) {
      score += 15
      signals.push({
        code: 'ROOT_CAUSE',
        polarity: 'positive',
        message: '包含带错误上下文的根因剖析（Gotcha 候选证据）',
        evidence: reasonText.match(new RegExp(`.{0,30}(?:${ROOT_CAUSE_RE.source}).{0,50}`, 'i'))?.[0]?.slice(-80)
      })
    }
    const hasGotcha = GOTCHA_RE.test(reasonText) && (GOTCHA_CONTEXT_RE.test(reasonText) || ERROR_CONTEXT_RE.test(reasonText))
    if (hasGotcha) {
      score += 8
      signals.push({
        code: 'GOTCHA_WARNING',
        polarity: 'positive',
        message: '沉淀了带上下文的避坑点/边界条件（Gotcha 候选证据）',
        evidence: reasonText.match(new RegExp(`.{0,20}(?:${GOTCHA_RE.source}).{0,40}`, 'i'))?.[0]?.slice(-60)
      })
    }

    // 4. Thrashing 双条件：字/轮 > 8000 且段落重复率 > 35%
    if (thoughtChars > 0 && charsPerTurn > 8000) {
      const dupRatio = paragraphDuplication(ev.thoughtText)
      if (dupRatio > 0.35) {
        flags.thrashing = true
        score -= 25
        signals.push({
          code: 'THRASHING',
          polarity: 'negative',
          message: `思维链空转（${charsPerTurn} 字/轮，段落重复率 ${Math.round(dupRatio * 100)}%）`,
          evidence: `dupRatio=${dupRatio.toFixed(2)}`
        })
      }
    }

    // 5. 重复率：先剥离代码块/堆栈帧再算逐行重复
    const stripped = reasonText.replace(CODE_OR_STACK_RE, '')
    const dupLineRatio = lineDuplication(stripped)
    if (dupLineRatio > 0.6) {
      score -= 15
      signals.push({ code: 'HIGH_DUPLICATION', polarity: 'negative', message: `同质化文本重复率高（${Math.round(dupLineRatio * 100)}%，已剥离代码/堆栈）` })
    }

    // 6. 无 thought 补偿：正文有结构化因果表达
    if (!hasThought) {
      if (CAUSAL_HEADINGS_RE.test(ev.assistantText)) {
        score += 6
        signals.push({ code: 'STRUCTURED_REASONING_IN_REPLY', polarity: 'positive', message: '回复正文含标题/列表/因果结构化分析' })
      }
    }

    return {
      strategyName: this.name,
      rawScore: Math.min(100, Math.max(10, score)),
      confidence: hasThought ? 0.88 : 0.7,
      signals,
      flags,
      details: { turnCount, thoughtChars, charsPerTurn, hasRootCause, hasGotcha, hasThought }
    }
  }
}

/** 段落级重复率（按换行切段，长度 >= 15 的重复段占比） */
function paragraphDuplication(text: string): number {
  const paras = text.split(/\n+/).map(s => s.trim()).filter(s => s.length >= 15)
  if (paras.length < 4) return 0
  const seen = new Set<string>()
  let dup = 0
  for (const p of paras) {
    const key = p.slice(0, 60)
    if (seen.has(key)) dup++
    else seen.add(key)
  }
  return dup / paras.length
}

/** 逐行重复率（长度 > 5 的行） */
function lineDuplication(text: string): number {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 5)
  if (lines.length === 0) return 0
  const uniq = new Set(lines)
  return (lines.length - uniq.size) / lines.length
}
