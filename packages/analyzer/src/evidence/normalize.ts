/**
 * 证据归一化层：把各平台（Claude/Codex/Pi/...）原始工具调用与消息
 * 转换为平台无关的证据模型，所有策略只消费归一化证据。
 */
import type { EvaluationContext, Turn } from '../types.js'
import { classifyTool, getToolProfile, type ToolKind } from './tool-profiles.js'

export interface ChangedFile {
  path: string
  /** 是否拿到了实际补丁/新内容文本 */
  hasContent: boolean
  /** 该文件变更的有效行（新增/修改的文本行） */
  effectiveLines: string[]
}

export interface NormalizedToolUse {
  rawName: string
  kind: ToolKind
  /** edit 类：目标文件路径（如果能解析到） */
  path?: string
  /** edit 类：实际写入/patch 文本（截断后） */
  patch?: string
  /** shell 重定向写盘候选文件 */
  shellWrites?: string[]
}

export interface EvaluationEvidence {
  turns: Turn[]
  toolUses: NormalizedToolUse[]
  changedFiles: ChangedFile[]
  /** 合并后的补丁/新内容文本（已做截断保护） */
  patchText: string
  thoughtText: string
  /** assistant 最终回复正文（无 thought 平台的推理载体） */
  assistantText: string
  /** 会话是否完整闭环（末轮有交付信号或最后动作为编辑+验证） */
  closedLoop: boolean
  /** 末轮停在错误文本上（false 或错误文本片段） */
  endsWithError: false | string
  metrics: {
    turnCount: number
    toolCallCount: number
    realFileCount: number
    searchReadCount: number
    editWriteCount: number
    uniqueToolKinds: number
    thoughtChars: number
    assistantChars: number
  }
}

const PATCH_CAP_PER_FILE = 3000
const PATCH_CAP_TOTAL = 20000

const PATH_KEYS = [
  'path', 'filePath', 'file_path', 'targetFile', 'TargetFile', 'notebook_path',
  'file', 'filename', 'file_name', 'relPath', 'relativePath'
]
const CONTENT_KEYS = [
  'input', 'rawInput', 'patch', 'PATCH_INPUT', 'content', 'Content', 'CodeContent',
  'new_str', 'newStr', 'file_text', 'fileText', 'ReplacementContent', 'replacement',
  'code', 'text', 'contents'
]
const NOISE_FILE = /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb|.*\.lock|dist\/|build\/|\.output\/|\.nuxt\/|node_modules\/|.*\.snap$|.*\.snapshot$|.*\.min\.(js|css))/i

function toArgs(raw: unknown): Record<string, unknown> {
  if (!raw) return {}
  if (typeof raw === 'string') {
    const s = raw.trim()
    if (!s) return {}
    // apply_patch 的 patch 文本直接作为字符串参数
    if (/^\*\*\* (?:Begin Patch|Update File|Add File)/.test(s)) return { input: s }
    try {
      const parsed = JSON.parse(s)
      return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : { content: s }
    } catch {
      return { content: s }
    }
  }
  return typeof raw === 'object' ? raw as Record<string, unknown> : { content: String(raw) }
}

function stringifyArg(val: unknown): string {
  if (val == null) return ''
  if (typeof val === 'string') return val
  try {
    return JSON.stringify(val)
  } catch {
    return String(val)
  }
}

/** 解析 apply_patch 风格文本中的目标文件与补丁体 */
function parseApplyPatch(text: string): { files: string[], patch: string } {
  const files: string[] = []
  const re = /^\*\*\* (?:Update|Add|Delete|Rename) File: (.+)$/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const hit = m[1]
    if (hit) {
      const p = hit.trim()
      if (p && !files.includes(p)) files.push(p)
    }
  }
  return { files, patch: text }
}

// cat heredoc / tee / > 重定向写盘
const SHELL_WRITE_RE = /(?:^|[\s;&|])(?:cat\s*<<-?\s*\S*\s*>|tee\s+(?:-a\s+)?['"]?[^'"\s;&|]+['"]?|exec>\s*\S+|>>?\s*['"]?[^'"\s;&|<>]+['"]?)/g

function detectShellWrites(command: string): string[] {
  const paths = new Set<string>()
  // heredoc 正文里的 "> 引用行"（markdown 等）不是重定向；
  // 重定向目标只会出现在 heredoc 标记（<<）之前的命令头部。
  const heredocIdx = command.indexOf('<<')
  const scanRegion = heredocIdx >= 0 ? command.slice(0, heredocIdx) : command
  let m: RegExpExecArray | null
  SHELL_WRITE_RE.lastIndex = 0
  while ((m = SHELL_WRITE_RE.exec(scanRegion))) {
    const hit = m[0]
    if (!hit) continue
    const after = hit
      .replace(/^[\s;&|]*(?:cat\s*<<-?\s*\S*\s*>|tee\s+(?:-a\s+)?|exec>|>>?)/, '')
      .trim()
      .replace(/^['"]|['"]$/g, '')
    if (after && !after.startsWith('/dev/')) paths.add(after)
  }
  return [...paths]
}

export function normalizeEvidence(ctx: EvaluationContext): EvaluationEvidence {
  const profile = getToolProfile(ctx.platform)

  const turns: Turn[] = []
  let current: Turn | null = null
  const toolUses: NormalizedToolUse[] = []
  const fileMap = new Map<string, ChangedFile>()
  const patchChunks: string[] = []
  let patchTotal = 0

  const addFile = (pathRaw: unknown, patch?: string) => {
    const path = String(pathRaw || '').trim()
    if (!path || NOISE_FILE.test(path)) return
    const lines = (patch || '')
      .split('\n')
      .map(l => l.replace(/^[-+!*]/, '').trim())
      .filter(l => l.length > 0 && !l.startsWith('@@') && !/^\*\*\* End Patch/.test(l))
    const prev = fileMap.get(path)
    const effectiveLines = prev ? [...prev.effectiveLines, ...lines] : lines
    fileMap.set(path, {
      path,
      hasContent: Boolean(prev?.hasContent || patch),
      effectiveLines
    })
    if (patch && patchTotal < PATCH_CAP_TOTAL) {
      const chunk = patch.slice(0, PATCH_CAP_PER_FILE)
      patchChunks.push(chunk)
      patchTotal += chunk.length
    }
  }

  for (const msg of ctx.messages) {
    if (msg.role === 'user') {
      current = { index: turns.length, userText: msg.content || '', assistantTexts: [], hasToolUse: false }
      turns.push(current)
    } else if (msg.role === 'assistant') {
      if (!current) {
        current = { index: turns.length, userText: '', assistantTexts: [], hasToolUse: false }
        turns.push(current)
      }
      if (msg.content && msg.content.trim()) current.assistantTexts.push(msg.content)
    }

    if (msg.toolCalls) {
      if (current) current.hasToolUse = true
      for (const tcRaw of msg.toolCalls) {
        const rawName = tcRaw.name || tcRaw.type || 'unknown'
        const kind = classifyTool(rawName, profile)
        const args = toArgs(tcRaw.arguments ?? tcRaw.args ?? tcRaw.input)
        const tu: NormalizedToolUse = { rawName, kind }
        let editPatch: string | undefined

        if (kind === 'edit') {
          let patchCandidates = CONTENT_KEYS.map(k => args[k]).filter(Boolean)
          if (typeof tcRaw.input === 'string' && /^\*\*\* /.test(tcRaw.input)) {
            patchCandidates = [tcRaw.input, ...patchCandidates]
          }
          for (const val of patchCandidates) {
            const text = stringifyArg(val)
            if (!text) continue
            if (/^\*\*\* (?:Begin Patch|Update File|Add File)/.test(text)) {
              const parsed = parseApplyPatch(text)
              for (const f of parsed.files) addFile(f, parsed.patch)
              editPatch = text
              break
            }
          }
          const pathKey = PATH_KEYS.find(k => args[k])
          if (pathKey) {
            const contentPatch = editPatch || patchCandidates.map(stringifyArg).find(Boolean)
            addFile(args[pathKey], contentPatch)
            tu.path = String(args[pathKey])
          }
          if (editPatch) tu.patch = editPatch.slice(0, PATCH_CAP_PER_FILE)
        } else if (kind === 'shell') {
          const command = stringifyArg(args.command ?? args.cmd ?? args.input ?? '')
          const writes = command ? detectShellWrites(command) : []
          if (writes.length) {
            for (const w of writes) addFile(w)
            tu.shellWrites = writes
          }
        }

        toolUses.push(tu)
      }
    }
  }

  // 文本通道
  const thoughtText = ctx.messages
    .filter(m => m.role === 'assistant')
    .map(m => m.thought || '')
    .filter(Boolean)
    .join('\n')

  const assistantTexts = ctx.messages
    .filter(m => m.role === 'assistant')
    .map(m => m.content || '')
    .filter(s => s.trim())
  const assistantText = assistantTexts.join('\n')

  // 闭环判定
  const lastAssistant = [...assistantTexts].reverse().find(t => t.trim().length > 20) || ''
  const ERROR_RE = /(Traceback \(most recent call last\)|^\s*Error:|✖|✗|failed with exit code|命令执行失败|未解决|无法解决)/im
  const SUCCESS_RE = /(已完成|已修复|搞定|总结|验证通过|测试通过|build (?:succeeded|passed)|✅|all tests pass|resolved|fixed)/i
  const endsWithError = ERROR_RE.test(lastAssistant) && !SUCCESS_RE.test(lastAssistant)
  const editThenVerify = toolUses.length >= 2
    && toolUses.slice(-2).some(t => t.kind === 'edit')
    && toolUses.slice(-2).some(t => t.kind === 'shell' || t.kind === 'search-read')
  const closedLoop = !endsWithError && (SUCCESS_RE.test(lastAssistant) || editThenVerify)

  const searchReadCount = toolUses.filter(t => t.kind === 'search-read').length
  const editWriteCount = toolUses.filter(t => t.kind === 'edit' || (t.shellWrites?.length ?? 0) > 0).length
  const uniqueToolKinds = new Set(toolUses.filter(t => t.kind !== 'other').map(t => t.kind)).size

  return {
    turns,
    toolUses,
    changedFiles: [...fileMap.values()],
    patchText: patchChunks.join('\n'),
    thoughtText,
    assistantText,
    closedLoop,
    endsWithError: endsWithError ? lastAssistant.slice(0, 200) : false,
    metrics: {
      turnCount: turns.filter(t => t.userText.trim()).length || turns.length,
      toolCallCount: toolUses.length,
      realFileCount: fileMap.size,
      searchReadCount,
      editWriteCount,
      uniqueToolKinds,
      thoughtChars: thoughtText.length,
      assistantChars: assistantText.length
    }
  }
}

// 本地别名，避免与导出的 classifyTool 命名混淆
