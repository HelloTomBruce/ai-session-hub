import type { EvaluationContext, IEvaluatorStrategy, StrategyScoreResult } from '../types'
import type { LLMProviderSettings } from '../../llm-provider-config'

/**
 * Optional Deep G-Eval LLM Judge Strategy (activates when LLM Provider is available)
 */
export class LlmJudgeEvaluator implements IEvaluatorStrategy {
  readonly name = 'llm-judge'
  readonly defaultWeight = 0.40

  constructor(private provider?: LLMProviderSettings) {}

  isAvailable(): boolean {
    return Boolean(this.provider && this.provider.enabled && this.provider.apiKey)
  }

  async evaluate(ctx: EvaluationContext): Promise<StrategyScoreResult> {
    if (!this.isAvailable() || !this.provider) {
      return {
        strategyName: this.name,
        rawScore: 0,
        weight: 0,
        confidence: 0,
        signals: ['LLM Provider 未启用，跳过深度 AI 裁判'],
        details: { skipped: true }
      }
    }

    try {
      const baseUrl = (this.provider.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')
      const model = this.provider.model || 'gpt-4o-mini'

      const firstMsgs = ctx.messages.slice(0, 5)
      const lastMsgs = ctx.messages.length > 5 ? ctx.messages.slice(-5) : []
      const contextMsgs = [...firstMsgs, ...(lastMsgs.length > 0 ? [{ role: 'system', content: '... [中间省略若干轮交互] ...' }] : []), ...lastMsgs]

      const prompt = `You are a Principal Software Architect and AI Knowledge Evaluator.
Analyze the following coding session trajectory and evaluate its long-term engineering knowledge value (0-100 score).

Strict Evaluation Guidelines:
1. Check Task Resolution: If the task stalled, failed on tool execution, ended in an error loop, or was left unresolved with no actionable code, mark "isTaskResolved": false, "isHighValue": false, and give a low score (< 40).
2. Check ADR & Gotcha Value: Does it contain deliberate architectural decisions (ADR) or successfully solved non-trivial root-cause gotchas?
3. Penalize: Repetitive search loops, massive rambling thoughts with no outcome, or trivial typo fixes.

Session Title: ${ctx.title}
Platform: ${ctx.platform}
Messages Summary:
${contextMsgs.map(m => `[${m.role.toUpperCase()}]: ${m.content.slice(0, 300)}`).join('\n')}

Output MUST be a JSON object:
{
  "score": number, // 0 - 100
  "isTaskResolved": boolean,
  "isHighValue": boolean,
  "valueCategory": "ADR" | "Gotcha" | "Pattern" | "Trivial",
  "reason": "string (Concise evaluation rationale in Chinese)"
}`

      const res = await $fetch<any>(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.provider.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: {
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          response_format: { type: 'json_object' }
        }
      })

      const raw = res.choices?.[0]?.message?.content || '{}'
      const parsed = JSON.parse(raw)
      const score = typeof parsed.score === 'number' ? Math.min(100, Math.max(0, parsed.score)) : 50

      return {
        strategyName: this.name,
        rawScore: score,
        weight: this.defaultWeight,
        confidence: 0.95,
        signals: [parsed.reason || `AI Judge 评分: ${score} 分 (${parsed.valueCategory || 'Evaluated'})`],
        details: parsed
      }
    } catch (e: any) {
      return {
        strategyName: this.name,
        rawScore: 50,
        weight: this.defaultWeight,
        confidence: 0.5,
        signals: [`AI Judge 调用失败: ${e.message}`],
        details: { error: e.message }
      }
    }
  }
}
