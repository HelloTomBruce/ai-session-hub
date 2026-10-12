/**
 * 沉淀去重纯函数（无副作用，便于单测）
 */

/** 标题规范化：小写、折叠空白 */
export function normalizeTitleForDedup(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * 行级 Jaccard 相似度：忽略空行与 markdown 标题标记行，
 * 用于判断同名记忆是"实质一致"还是"内容演进"。
 */
export function contentSimilarity(a: string, b: string): number {
  const linesOf = (text: string) => new Set(
    text.split('\n').map(l => l.trim()).filter(l => l.length > 8 && !/^#+\s/.test(l))
  )
  const sa = linesOf(a)
  const sb = linesOf(b)
  if (sa.size === 0 || sb.size === 0) return 0
  let inter = 0
  for (const l of sa) {
    if (sb.has(l)) inter++
  }
  return inter / new Set([...sa, ...sb]).size
}
