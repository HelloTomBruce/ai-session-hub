// ============================================
// FTS5 查询构造（TOMB-20）
//
// 将用户输入安全地转义为合法的 FTS5 查询串。
//
// 背景：索引表使用 unicode61 分词器，`-` / `.` / `@` 等字符
// 不是 token 字符。旧实现对含这些字符的 token 直接拼接 `*`
// 前缀（如 `project-alpha*`、`node.js*`），属于非法 FTS5 语法，
// 导致文件名/路径/版本号/邮箱等高频查询整类静默 0 命中。
//
// 转义规则：
//  - 纯 ASCII 词（[A-Za-z0-9_]）-> `word*` 前缀查询
//  - 其余 token（含 CJK 或特殊字符）-> 双引号短语。
//    FTS5 会对短语内容再次分词，`"node.js"` 等价于 `node js`
//    邻接短语，与文档侧 unicode61 分词结果一致
//  - AND / OR / NOT 仅在两侧都有操作数时保留为运算符，
//    否则降级为字面量短语，避免悬空运算符造成语法错误
//  - 仅由标点/符号组成的片段直接丢弃（不会成为索引 token）
// ============================================

const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' })

/** FTS5 布尔运算符（仅大写形式具有运算符语义） */
const FTS_OPERATORS = new Set(['AND', 'OR', 'NOT'])

/** 仅由空白/标点/符号组成 —— unicode61 下不会成为 token */
const PUNCT_ONLY_RE = /^[\s\p{P}\p{S}]+$/u

/** 纯 ASCII 词字符，可安全使用 `word*` 前缀查询 */
const ASCII_WORD_RE = /^[A-Za-z0-9_]+$/

interface QueryPart {
  kind: 'operand' | 'operator'
  text: string
}

/** 双引号短语，内部 `"` 按 FTS5 规则双写转义 */
function quotePhrase(token: string): string {
  return `"${token.replace(/"/g, '""')}"`
}

function operandForToken(token: string): string {
  if (ASCII_WORD_RE.test(token)) return `${token}*`
  return quotePhrase(token)
}

/**
 * 将用户输入转义为合法的 FTS5 MATCH 查询串。
 * 返回空串表示输入中没有可检索的 token。
 */
export function buildFtsQuery(query: string): string {
  const raw = query.trim()
  if (!raw) return ''

  try {
    const parts: QueryPart[] = []
    for (const seg of segmenter.segment(raw)) {
      const token = seg.segment.trim()
      if (!token || PUNCT_ONLY_RE.test(token)) continue
      if (FTS_OPERATORS.has(token)) {
        parts.push({ kind: 'operator', text: token })
      } else {
        parts.push({ kind: 'operand', text: operandForToken(token) })
      }
    }

    // 运算符仅在「前面已有操作数 且 后面还存在操作数」时保留，
    // 否则降级为字面量短语（如 `OR`、`hello AND` 不致语法错误）
    const resolved: QueryPart[] = []
    for (const [i, part] of parts.entries()) {
      if (part.kind === 'operator') {
        const prevIsOperand = resolved[resolved.length - 1]?.kind === 'operand'
        const hasLaterOperand = parts.slice(i + 1).some(p => p.kind === 'operand')
        if (prevIsOperand && hasLaterOperand) {
          resolved.push(part)
        } else {
          resolved.push({ kind: 'operand', text: quotePhrase(part.text) })
        }
      } else {
        resolved.push(part)
      }
    }

    return resolved.map(p => p.text).join(' ')
  } catch {
    // 分词异常时兜底为整串短语，保证永不产生非法语法
    return quotePhrase(raw)
  }
}
