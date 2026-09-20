import { getLLMProviderSettings } from './llm-provider-config'
import { streamLLMCompletion, type StreamChunkCallback } from './llm-stream-client'
import type { MemoryGraphItem, MemoryExtractInput } from './memory-types'

const MEMORY_EXTRACTION_SYSTEM_PROMPT = `
你是一个顶尖的软件架构与工程经验提炼专家。你的任务是从开发者与 AI 的编码会话记录中，提炼出具有【高复用价值】的知识资产与经验记忆。

### 提取原则：
1. **解耦会话与通用化 (Session-Agnostic & Generalized)**：
   - 提取的经验应该是通用的工程经验、架构决策或排坑要点，不要保留具体的“用户说/助手说”等对话残留口吻。
   - 不要包含具体的会话 ID，将其抽象为可指导未来同类开发场景的最佳实践。
2. **灵活的类型归类 (Extensible Type)**：
   - 推荐优先使用预设类型：
     - 'ADR'（架构与技术选型决策）
     - 'Gotcha'（踩坑避坑、隐藏陷阱、版本不兼容、配置误区）
     - 'BestPractice'（最佳实践、高效写法）
     - 'Pattern'（设计模式、代码范式、规范模版）
     - 'Workflow'（运维/发布/排错工作流规范）
     - 'Config'（重要配置文件或环境搭建范式）
     - 'Performance'（性能调优与瓶颈解决）
     - 'Security'（安全规约与漏洞修复）
   - 也支持根据实际内容自定义更贴切的类型（如 'ApiSpec', 'BusinessRule'）。
3. **知识图谱实体识别 (Entity Extraction)**：
   - **projects**: 适用的项目名称与路径 (name, cwd)。
   - **techConcepts**: 涉及的具体技术、框架、库或工具 (name, category: 'framework'|'library'|'language'|'tool'|'db'|'infra'|'other')。
   - **problems**: 遇到的痛点、异常现象或报错信息 (title, symptom, errorCode)。
   - **snippets**: 提炼出的核心代码模式或配置片段 (title, code, language, rules)。

### 输出格式要求：
必须且仅输出标准的 JSON 格式对象，不要使用 markdown 代码块包裹，也不要有任何额外的文字说明。

JSON 结构示例：
{
  "title": "Nuxt 3 中原生 C++ 绑定的 Nitro 外部化配置",
  "type": "Gotcha",
  "summary": "在 Nuxt 3 中引入原生 C++ 绑定库时，Nitro SSR 打包可能会报错找不到 .node 文件，需在 nitro.externals 中将其声明为外部模块。",
  "content": "### 痛点背景\\n...\\n### 解决方案\\n...\\n### 注意事项\\n...",
  "confidence": 95,
  "tags": ["nuxt3", "nitro", "native-binding", "sqlite"],
  "projects": [
    { "name": "session-hub", "cwd": "/path/to/project" }
  ],
  "techConcepts": [
    { "name": "Nuxt", "category": "framework" },
    { "name": "Nitro", "category": "framework" },
    { "name": "better-sqlite3", "category": "library" }
  ],
  "problems": [
    {
      "title": "Cannot find module binary",
      "symptom": "运行 nuxt build 后执行报找不到动态链接库或 .node 模块",
      "errorCode": "MODULE_NOT_FOUND"
    }
  ],
  "snippets": [
    {
      "title": "nuxt.config.ts 外部化配置",
      "code": "export default defineNuxtConfig({\\n  nitro: {\\n    externals: {\\n      external: ['better-sqlite3']\\n    }\\n  }\\n})",
      "language": "typescript",
      "rules": "在添加任何 Rust / C++ 原生 npm 依赖时均需在此注册"
    }
  ]
}
`.trim()

export async function extractMemoryFromSession(
  input: MemoryExtractInput,
  onProgress?: StreamChunkCallback
): Promise<Partial<MemoryGraphItem>> {
  const provider = getLLMProviderSettings()
  if (!provider.enabled || !provider.apiKey) {
    throw new Error('LLM Provider 未配置或未启用，请先在右上角「设置」中配置 API Key。')
  }

  const userPrompt = `
【会话上下文】
项目目录 (CWD): ${input.cwd || 'N/A'}
会话来源: ${input.platform || 'N/A'}
会话标题: ${input.sessionTitle || '未命名会话'}
${input.userInstructions ? `用户特别补充要求: ${input.userInstructions}` : ''}

【会话交流与代码片段】
${input.messagesContent.slice(0, 15000)}

请根据上述内容，提炼出可复用的知识与经验记忆，以严格的 JSON 格式输出。
`.trim()

  let fullOutput: string
  try {
    fullOutput = await streamLLMCompletion(
      provider,
      MEMORY_EXTRACTION_SYSTEM_PROMPT,
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

  // 清洗 JSON 字符串
  let cleaned = fullOutput.trim()
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '')
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '')
  }

  try {
    const parsed = JSON.parse(cleaned)
    return {
      title: parsed.title || input.sessionTitle || '提炼记忆',
      type: parsed.type || 'BestPractice',
      summary: parsed.summary || '',
      content: parsed.content || '',
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 90,
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      projects: Array.isArray(parsed.projects) ? parsed.projects : (input.cwd ? [{ name: input.cwd.split('/').pop() || 'project', cwd: input.cwd }] : []),
      techConcepts: Array.isArray(parsed.techConcepts) ? parsed.techConcepts : [],
      problems: Array.isArray(parsed.problems) ? parsed.problems : [],
      snippets: Array.isArray(parsed.snippets) ? parsed.snippets : [],
      sourceMeta: {
        platform: input.platform,
        extractedAt: Date.now()
      }
    }
  } catch (err) {
    console.error('[Memory Extractor] Failed to parse JSON response:', fullOutput)
    throw new Error('LLM 返回的记忆数据格式不合法，未能解析为标准 JSON。', { cause: err })
  }
}
