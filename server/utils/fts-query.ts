/**
 * FTS5 查询串构造（用户输入 -> 合法 MATCH 语法）
 *
 * 背景（回归 #fts-syntax-error）：
 * 旧实现把含 `-` / `.` 的 token 拼成 `-*` / `xxx.yy*` 前缀匹配，
 * 但 FTS5 的 bareword 合法字符集只有 [A-Za-z0-9_] 与非 ASCII 字符，
 * 导致 SqliteError: fts5: syntax error near "*" / "."，
 * 且错误被上层 catch 吞掉后全文检索静默返回空结果
 * （典型触发：搜索 cache-service、--flag、v1.2.3 等含连字符/点号的词）。
 *
 * 规则：
 * 1. 纯 [A-Za-z0-9_] 且非保留字（AND/OR/NOT）-> `token*` 前缀匹配
 * 2. 其余一切 token（含 - . 等特殊字符、中文、混合字符）-> `"token"` 引号短语（内部 " 加倍转义）
 * 3. 纯标点/空白 token（含 - * / 等语法敏感字符）无检索语义，直接丢弃
 */

/** 无检索意义的纯标点 token（比旧版新增 - * /，它们对 FTS5 是语法敏感字符） */
const PUNCT_ONLY_RE = /^[\s,.:;!?'"()[\]{}\-*/]+$/

/** FTS5 合法 bareword 字符集（见 SQLite FTS5 docs: String） */
const FTS5_BAREWORD_RE = /^[a-zA-Z0-9_]+$/

/** FTS5 保留字：作裸词会被解析为布尔运算符，裸拼会导致语法错误（如 `AND*` -> near "AND"） */
const FTS5_RESERVED_WORDS = new Set(['and', 'or', 'not'])

/**
 * 将用户输入转义为 FTS5 分词匹配语法。
 * 返回空串表示无有效检索词，调用方应短路返回空结果。
 */
export function escapeFtsQuery(query: string, segmenter: Intl.Segmenter): string {
  const raw = query.trim()
  if (!raw) return ''

  try {
    const tokens = Array.from(segmenter.segment(raw))
      .map(s => s.segment.trim())
      .filter(s => s.length > 0 && !PUNCT_ONLY_RE.test(s))

    if (tokens.length === 0) return ''

    return tokens.map((t) => {
      // 纯英文/数字/下划线 -> 前缀模糊匹配
      if (FTS5_BAREWORD_RE.test(t) && !FTS5_RESERVED_WORDS.has(t.toLowerCase())) {
        return `${t}*`
      }
      // 中文字符、含 - . 等特殊字符的混合 token、保留字 -> 引号短语（语法安全）
      return `"${t.replace(/"/g, '""')}"`
    }).join(' ')
  } catch {
    return `"${raw.replace(/"/g, '""')}"`
  }
}
