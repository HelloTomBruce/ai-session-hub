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
 *
 * 行集合任一不足以判定时（短内容常见：行 ≤8 字符全部被过滤），
 * 回退到空白归一化后的 3-gram 字符 shingle Jaccard——否则短资产
 * 相似度恒为 0，同标题重复保存会走 superseded 无限膨胀演进链。
 */
export function contentSimilarity(a: string, b: string): number {
  const jaccard = <T>(sa: Set<T>, sb: Set<T>): number => {
    if (sa.size === 0 || sb.size === 0) return 0
    let inter = 0
    for (const x of sa) {
      if (sb.has(x)) inter++
    }
    return inter / new Set([...sa, ...sb]).size
  }

  const linesOf = (text: string) => new Set(
    text.split('\n').map(l => l.trim()).filter(l => l.length > 8 && !/^#+\s/.test(l))
  )
  const la = linesOf(a)
  const lb = linesOf(b)
  if (la.size >= 2 && lb.size >= 2) return jaccard(la, lb)

  return jaccard(shinglesOf(a), shinglesOf(b))
}

/** 空白归一化后的字符 3-gram 集合（短文本相似度回退判定用） */
function shinglesOf(text: string): Set<string> {
  const normalized = text.replace(/\s+/g, ' ').trim()
  const set = new Set<string>()
  if (!normalized) return set
  if (normalized.length <= 3) {
    set.add(normalized)
    return set
  }
  for (let i = 0; i + 3 <= normalized.length; i++) {
    set.add(normalized.slice(i, i + 3))
  }
  return set
}
