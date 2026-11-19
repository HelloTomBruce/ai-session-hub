/**
 * 长文本折叠（从 app/pages/sessions/[id].vue 抽出）。
 *
 * 会话详情里思考过程、工具入参、消息正文都可能上万字符，直接渲染会让首屏变慢且难以阅读。
 * 策略：超过 limit 先只渲染前 limit 个字符，用户点开后再展示全文。
 * 展开状态按 key 记录（key 由调用方用消息 id / 下标生成），避免同一消息的不同片段互相干扰。
 */
export function useLongTextCollapse() {
  const expandedKeys = ref(new Set<string>())

  const toggleExpand = (key: string) => {
    const next = new Set(expandedKeys.value)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    expandedKeys.value = next
  }

  const overLimit = (text: string | undefined, limit: number) => Boolean(text && text.length > limit)

  const displayText = (text: string | undefined, key: string, limit: number) => {
    if (!text) return ''
    if (text.length <= limit || expandedKeys.value.has(key)) return text
    return text.slice(0, limit)
  }

  return { expandedKeys, toggleExpand, overLimit, displayText }
}
