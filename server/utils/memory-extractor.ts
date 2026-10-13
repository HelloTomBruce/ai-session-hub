/**
 * 统一记忆抽取器（P1 质量管线单一事实源）。
 *
 * 两种进入姿态共用本抽取器：
 * - 手动提炼（/api/memory/extract）：guidance = 用户自由指引
 * - 评估引导沉淀（evaluate/stream → knowledge-extractor 薄壳）：guidance = 评估分类约束
 *
 * 质量机制（P1）：
 * - 证据锚定：要求 LLM 输出 evidenceQuotes（会话原句引用），
 *   由 verifyEvidenceQuotes 做真实性校验——「禁止编造」从 prompt 祈求变为机制
 */
import { getLLMProviderSettings } from './llm-provider-config'
import { streamLLMCompletion, extractJsonFromLLMText, type StreamChunkCallback } from '@session-hub/llm'
import type { MemoryGraphItem, MemoryExtractInput } from './memory-types'
import type { SessionMessage } from './types'

/**
 * 评估分类 → content 结构引导（评估引导沉淀路径注入）。
 */
export const CATEGORY_GUIDANCE: Record<string, string> = {
  ADR: '- 分类为 ADR：content 必须包含「### 决策背景」「### 决策内容」「### 后果与权衡」三段，写清选型对比与放弃的备选。',
  Gotcha: '- 分类为 Gotcha：content 必须包含「### 症状」「### 根因」「### 修复方案」「### 适用边界」四段。',
  Pattern: '- 分类为 Pattern：content 必须包含「### 场景」「### 范式做法」「### 示例要点」，提炼可复用的代码/设计模式。',
  Milestone: '- 分类为 Milestone：content 概述落地范围、模块划分与验证方式，突出可复用的实施经验。'
}

const SYSTEM_PROMPT = `
你是一个顶尖的软件架构与工程经验提炼专家。你的任务是从开发者与 AI 的编码会话记录中，提炼出具有【高复用价值】的知识资产与经验记忆。

### 硬性要求（质量门）：
1. **解耦会话与通用化 (Session-Agnostic)**：用通用工程口吻表述，禁止"用户说/助手说"等对话残留，不写评分分数，不含会话 ID；抽象为可指导未来同类开发场景的最佳实践。
2. **内容真实性**：内容必须来自会话中的真实技术决策、排障过程或代码改动；证据不足的字段留空，禁止编造。
3. **证据锚定**：必须提供 evidenceQuotes——直接摘自会话原文、能支撑本条知识核心结论的原句（2~5 条，每条尽量保留原文措辞，不要改写）。这些引文会被程序校验是否真实存在于会话中，编造会导致本条知识被降级。
4. **类型归类 (Extensible Type)**：优先使用预设类型：
   - 'ADR'（架构与技术选型决策）'Gotcha'（踩坑避坑、隐藏陷阱、版本不兼容、配置误区）
   - 'BestPractice'（最佳实践、高效写法）'Pattern'（设计模式、代码范式、规范模版）
   - 'Workflow'（运维/发布/排错工作流规范）'Config'（重要配置文件或环境搭建范式）
   - 'Performance'（性能调优与瓶颈解决）'Security'（安全规约与漏洞修复）
   也支持根据实际内容自定义更贴切的类型（如 'ApiSpec', 'BusinessRule'）。
5. **知识图谱实体识别**：
   - projects: 适用的项目名称与路径 (name, cwd)。
   - techConcepts: 涉及的具体技术、框架、库或工具 (name, category: 'framework'|'library'|'language'|'tool'|'db'|'infra'|'other')。
   - problems: 遇到的痛点、异常现象或报错信息 (title, symptom, errorCode)。
   - snippets: 提炼出的核心代码模式或配置片段 (title, code, language, rules)，只放真正关键的片段。

### 输出格式要求：
必须且仅输出标准的 JSON 格式对象，不要使用 markdown 代码块包裹，也不要有任何额外的文字说明。

JSON 结构：
{
  "title": "简洁准确的知识标题（不要直接照抄会话标题）",
  "type": "Gotcha",
  "summary": "一两句话概括，便于检索召回",
  "content": "Markdown 正文，按类型引导分段",
  "confidence": 0-100 的数字,
  "evidenceQuotes": ["会话原句引用1", "会话原句引用2"],
  "tags": ["小写英文或中文关键词"],
  "projects": [{ "name": "项目名", "cwd": "/path" }],
  "techConcepts": [{ "name": "技术名", "category": "framework|library|language|tool|db|infra|other" }],
  "problems": [{ "title": "问题标题", "symptom": "现象", "errorCode": "错误码（可空）" }],
  "snippets": [{ "title": "片段标题", "code": "代码", "language": "语言", "rules": "适用规则" }]
}
`.trim()

export const MAX_CONTEXT = 15000

/**
 * 构建喂给 LLM 的会话正文（含思维链与工具调用摘要，带总量截断）。
 */
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

/**
 * 证据锚定校验：验证 LLM 声称的会话原句引用真实存在于会话正文中。
 * 匹配策略（容忍 LLM 引文的轻微改写/截断）：
 * 1. 空白归一化后全文包含
 * 2. 失败则取引文头部 40 字符归一化后包含（LLM 常截断长引文）
 */
export function verifyEvidenceQuotes(quotes: string[], sourceText: string): { passed: number, total: number } {
  const normalize = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()
  const haystack = normalize(sourceText)
  let passed = 0
  let total = 0
  for (const q of quotes) {
    const nq = normalize(q)
    if (!nq) continue
    total++
    if (haystack.includes(nq)) {
      passed++
      continue
    }
    const head = nq.slice(0, 40)
    if (head.length >= 20 && haystack.includes(head)) {
      passed++
    }
  }
  return { passed, total }
}

export interface ExtractedMemory extends Partial<MemoryGraphItem> {
  /** 管线校验后的证据结果（LLM 自报引文经真实性校验） */
  evidenceVerified: { passed: number, total: number }
}

export async function extractMemoryFromSession(
  input: MemoryExtractInput,
  onProgress?: StreamChunkCallback
): Promise<ExtractedMemory> {
  const provider = getLLMProviderSettings()
  if (!provider.enabled || !provider.apiKey) {
    throw new Error('LLM Provider 未配置或未启用，请先在右上角「设置」中配置 API Key。')
  }

  const userPrompt = `
${input.guidance ? `【抽取引导（定向约束，优先级高于默认原则）】\n${input.guidance}\n` : ''}
【会话上下文】
项目目录 (CWD): ${input.cwd || 'N/A'}
会话来源: ${input.platform || 'N/A'}
会话标题: ${input.sessionTitle || '未命名会话'}
${input.userInstructions ? `用户特别补充要求: ${input.userInstructions}` : ''}

【会话交流与代码片段】
${input.messagesContent.slice(0, MAX_CONTEXT)}

请根据上述内容，提炼出可复用的知识与经验记忆，以严格的 JSON 格式输出（含 evidenceQuotes 原句引用）。
`.trim()

  let fullOutput: string
  try {
    fullOutput = await streamLLMCompletion(
      provider,
      SYSTEM_PROMPT,
      userPrompt,
      (chunk) => {
        if (onProgress) onProgress(chunk)
      },
      0.1
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`LLM 记忆提炼请求失败: ${message}`, { cause: err })
  }

  try {
    const parsed = extractJsonFromLLMText(fullOutput) as Record<string, unknown>
    const str = (v: unknown): string => (typeof v === 'string' ? v : '')
    const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? v as T[] : [])

    const evidenceQuotes = arr<string>(parsed.evidenceQuotes)
      .filter(q => typeof q === 'string' && q.trim().length >= 8)
      .slice(0, 5)

    return {
      title: str(parsed.title) || input.sessionTitle || '提炼记忆',
      type: str(parsed.type) || 'BestPractice',
      summary: str(parsed.summary),
      content: str(parsed.content),
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 90,
      tags: arr<string>(parsed.tags).filter(t => typeof t === 'string'),
      projects: arr<{ name?: string, cwd?: string }>(parsed.projects)
        .filter(p => p?.name)
        .map(p => ({ name: String(p.name), cwd: p.cwd || input.cwd || '' })),
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
        })),
      sourceMeta: {
        platform: input.platform,
        extractedAt: Date.now(),
        evidenceQuotes,
        evidenceVerified: verifyEvidenceQuotes(evidenceQuotes, input.messagesContent)
      },
      // 管线校验结果（非 LLM 自报）：由调用方决定 confidence/status 处置
      evidenceVerified: verifyEvidenceQuotes(evidenceQuotes, input.messagesContent)
    }
  } catch (err) {
    console.error('[Memory Extractor] Failed to parse JSON response:', fullOutput.slice(0, 500))
    throw new Error('LLM 返回的记忆数据格式不合法，未能解析为标准 JSON。', { cause: err })
  }
}
