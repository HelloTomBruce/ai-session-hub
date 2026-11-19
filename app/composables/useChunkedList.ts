/**
 * 分块渲染（chunked rendering）通用组合式。
 *
 * 背景：首页会话网格与详情页消息流都可能一次挂载上千个节点，直接全量渲染会长时间
 * 阻塞主线程。做法是「先渲染一批 + 视口内哨兵持续补齐」，把一次性成本摊到滚动过程中。
 *
 * 从两个页面里重复了两遍的实现抽出来：
 *  - app/pages/index.vue（会话卡片，chunk=60，rootMargin=600px）
 *  - app/pages/sessions/[id].vue（消息 / 思维链，chunk=150，rootMargin=800px）
 *
 * 行为约定（与抽取前的实现保持一致）：
 *  - `remaining` 为 0 时 `loadMore` 不产生变化；
 *  - 哨兵进入视口后**持续**补齐，直到元素被推到预加载边界之外（IntersectionObserver
 *    对持续相交不会重复回调，因此必须自己递归补齐）；
 *  - 组件卸载时断开 observer，避免泄漏；
 *  - 数据源变化时需要调用方显式 `reset()`（列表过滤/切换后回到首批）。
 */
export interface ChunkedListOptions {
  /** 每批渲染条数 */
  chunk?: number
  /** 哨兵预加载边距（px），越大越早开始补下一批 */
  rootMargin?: number
}

export interface ChunkedList<T> {
  /** 当前已挂载的条目（原始数组切片） */
  items: ComputedRef<T[]>
  /** 当前已挂载的条目 + 原始下标（消息流需要 idx 生成 DOM id / 高亮 key） */
  indexedItems: ComputedRef<Array<{ item: T, idx: number }>>
  /** 已挂载条数 */
  visibleCount: Ref<number>
  /** 尚未挂载条数 */
  remaining: ComputedRef<number>
  /** 绑定到列表尾部的哨兵元素 */
  sentinelRef: Ref<HTMLElement | null>
  /** 手动补一批 */
  loadMore: () => void
  /** 一次性全部挂载 */
  loadAll: () => void
  /** 回到第一批（数据源变化后调用） */
  reset: () => void
}

export function useChunkedList<T>(
  source: Ref<T[]>,
  options: ChunkedListOptions = {}
): ChunkedList<T> {
  const chunk = Math.max(1, options.chunk ?? 60)
  const rootMargin = `${Math.max(0, options.rootMargin ?? 600)}px`

  const visibleCount = ref(chunk)
  const sentinelRef = ref<HTMLElement | null>(null)

  const items = computed(() => source.value.slice(0, visibleCount.value))
  const indexedItems = computed(() =>
    source.value.slice(0, visibleCount.value).map((item, idx) => ({ item, idx }))
  )
  const remaining = computed(() => Math.max(0, source.value.length - visibleCount.value))

  const loadMore = () => {
    if (remaining.value <= 0) return
    visibleCount.value = Math.min(visibleCount.value + chunk, source.value.length)
  }

  const loadAll = () => {
    visibleCount.value = source.value.length
  }

  const reset = () => {
    visibleCount.value = chunk
  }

  /** 哨兵仍在预加载边界内就继续补，直到铺满屏幕 */
  const fillUntilVisible = async (): Promise<void> => {
    await nextTick()
    const el = sentinelRef.value
    if (!el) return
    if (remaining.value > 0 && el.getBoundingClientRect().top < window.innerHeight + (options.rootMargin ?? 600)) {
      loadMore()
      await fillUntilVisible()
    }
  }

  let observer: IntersectionObserver | null = null

  onMounted(() => {
    observer = new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting)) void fillUntilVisible()
    }, { rootMargin })
    if (sentinelRef.value) observer.observe(sentinelRef.value)
  })

  onBeforeUnmount(() => {
    observer?.disconnect()
    observer = null
  })

  watch(sentinelRef, (el, oldEl) => {
    if (!observer) return
    if (oldEl) observer.unobserve(oldEl)
    if (el) observer.observe(el)
  })

  return { items, indexedItems, visibleCount, remaining, sentinelRef, loadMore, loadAll, reset }
}
