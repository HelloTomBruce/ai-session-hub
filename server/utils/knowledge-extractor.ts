/**
 * 评估引导的知识抽取（Rubric v2 / P3）：
 * worth-saving 评估通过后，由 LLM 做真实的决策/经验抽取，
 * 产出标准 MemoryGraphItem 草稿写入 Grafeo。复用 memory-extractor 的
 * 流式管线，但 system prompt 按评估分类（ADR/Gotcha/...）引导。
 */
import { getLLMProviderSettings } from './llm-provider-config'
import { streamLLMCompletion, type StreamChunkCallback } from '@session-hub/analyzer'
import type { MemoryGraphItem } from './memory-types'
import type { UnifiedSession, SessionMessage } from './types'
import type { QuantitativeEvaluationReport } from '@session-hub/analyzer'

const CATEGORY_GUIDANCE: Record<string, string> = {
  ADR: '- 分类为 ADR：content 必须包含「### 决策背景」「### 决策内容」「### 后果与权衡」三段，写清选型对比与放弃的备选。',
  Gotcha: '- 分类为 Gotcha：content 必须包含「### 症状」「### 根因」「### 修复方案」「### 适用边界」四段。',
  Pattern: '- 分类为 Pattern：content 必须包含「### 场景」「### 范式做法」「### 示例要点」，提炼可复用的代码/设计模式。',
  Milestone: '- 分类为 Milestone：content 概述落地范围、模块划分与验证方式，突出可复用的实施经验。'
}

const SYSTEM_PROMPT = `
你是顶尖的软件架构与工程经验提炼专家。下面是一段已通过量化质量门（评分/评级/分类）的 AI 编码会话，
请把其中【真正可复用的工程知识】抽取为一条知识资产，而不是复述评分结果或对话过程。

### 硬性要求：
1. 解耦会话：用通用工程口吻表述，禁止"用户说/助手说"等对话残留，不写评分分数作为决策内容。
2. 内容必须来自会话中的真实技术决策、排障过程或代码改动；证据不足的字段留空，禁止编造。
3. 优先使用预设类型：ADR / Gotcha / BestPractice / Pattern / Workflow / Config / Performance / Security / ApiSpec。
4. 必须识别图谱实体：projects（name/cwd）、techConcepts（name/category）、problems（title/symptom/errorCode）、
   snippets（title/code/language/rules，只放真正关键的片段）。
5. 仅输出一个标准 JSON 对象，不要 markdown 代码块，不要任何额外文字。

JSON 结构：
{
  "title": "简洁准确的知识标题（不要直接照抄会话标题）",
  "type": "ADR",
  "summary": "一两句话概括，便于检索召回",
  "content": "Markdown 正文，按分类引导分段",
  "confidence": 0-100 的数字,
  "tags": ["小写英文或中文关键词"],
  "projects": [{ "name": "项目名", "cwd": "/path" }],
  "techConcepts": [{ "name": "技术名", "category": "framework|library|language|tool|db|infra|other" }],
  "problems": [{ "title": "问题标题", "symptom": "现象", "errorCode": "错误码（可空）" }],
  "snippets": [{ "title": "片段标题", "code": "代码", "language": "语言", "rules": "适用规则" }]
}
`.trim()

export interface KnowledgeExtractInput {
  session: UnifiedSession
  messages: SessionMessage[]
  report: QuantitativeEvaluationReport
  userInstructions?: string
}

const MAX_CONTEXT = 15000

export function buildMessagesContent(messages: SessionMessage[]): string {
  const parts: string[] = []
  let total = 0
  for (const m of messages) {
    const seg = [`[${m.role.toUpperCase()}]`]
    if (m.thought) seg.push(`(thinking) ${m.thought}`)
    if (m.content) seg.push(m.content)
    if (m.toolCalls?.length) {
      for (const tc of m.toolCalls) {
        const name = tc.name || tc.type || 'tool'
        const args = typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments ?? tc.args ?? {})
        seg.push(`(tool:${name}) ${String(args).slice(0, 800)}`)
      }
    }
    const block = seg.join('\n')
    if (total + block.length > MAX_CONTEXT) break
    parts.push(block)
    total += block.length
  }
  return parts.join('\n\n')
}

function stripFence(raw: string): string {
  let s = raw.trim()
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  }
  return s
}

/**
 * 执行抽取，返回 MemoryGraphItem 草稿（未落库）。未配置 LLM 时抛错，
 * 由调用方决定 candidate 态。
 */
export async function extractKnowledgeFromEvaluation(
  input: KnowledgeExtractInput,
  onProgress?: StreamChunkCallback
): Promise<Partial<MemoryGraphItem>> {
  const provider = getLLMProviderSettings()
  if (!provider.enabled || !provider.apiKey) {
    throw new Error('LLM Provider 未配置或未启用')
  }

  const { session, messages, report } = input
  const guidance = CATEGORY_GUIDANCE[report.category] || '- 按最贴切的工程知识类型组织 content，背景/做法/边界清晰分段。'

  const userPrompt = `
【量化评估结论（作为抽取重点的引导，不是要复述的内容）】
- 分类：${report.category}；评级：${report.grade}；总分：${report.overallScore}
- 评估信号：${report.signals.slice(0, 6).join('；')}
${guidance}

【会话上下文】
项目目录：${session.cwd || 'N/A'}
来源平台：${session.cli}
会话标题：${session.title}
${input.userInstructions ? `用户补充要求：${input.userInstructions}` : ''}

【会话记录】
${buildMessagesContent(messages)}
`.trim()

  let raw: string
  try {
    raw = await streamLLMCompletion(provider, SYSTEM_PROMPT, userPrompt, chunk => onProgress?.(chunk), 0.2)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`知识抽取 LLM 请求失败: ${message}`, { cause: err })
  }

  try {
    const parsed = JSON.parse(stripFence(raw)) as Record<string, unknown>
    const str = (v: unknown): string => (typeof v === 'string' ? v : '')
    const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? v as T[] : [])
    return {
      title: str(parsed.title) || session.title,
      type: str(parsed.type) || report.category || 'BestPractice',
      summary: str(parsed.summary),
      content: str(parsed.content),
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : Math.max(60, report.overallScore),
      tags: arr<string>(parsed.tags).filter(t => typeof t === 'string'),
      projects: arr<{ name?: string, cwd?: string }>(parsed.projects)
        .filter(p => p?.name)
        .map(p => ({ name: String(p.name), cwd: p.cwd || session.cwd || '' })),
      techConcepts: arr<{ name?: string, category?: string }>(parsed.techConcepts)
        .filter(t => t?.name)
        .map(t => ({ name: String(t.name), category: t.category || 'other' })),
      problems: arr<{ title?: string, symptom?: string, errorCode?: string }>(parsed.problems)
        .filter(p => p?.title)
        .map(p => ({ title: String(p.title), symptom: p.symptom || '', errorCode: p.errorCode || '' })),
      snippets: arr<{ title?: string, code?: string, language?: string, rules?: string }>(parsed.snippets)
        .filter(sn => sn?.code)
        .map(sn => ({
          title: sn.title || '',
          code: String(sn.code),
          language: sn.language || '',
          rules: sn.rules || ''
        }))
    }
  } catch (err) {
    console.error('[Knowledge Extractor] Failed to parse JSON:', raw.slice(0, 500))
    throw new Error('LLM 返回的知识数据格式不合法，未能解析为标准 JSON。', { cause: err })
  }
}
