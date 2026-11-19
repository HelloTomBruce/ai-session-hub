import type { Ref } from 'vue'

/**
 * 会话网格的批量勾选状态。
 *
 * 勾选键为 `${cli}::${id}`：同一个 id 可能来自不同 CLI，必须带来源前缀才能唯一定位。
 *
 * 语义与抽取前的 app/pages/index.vue 完全一致：
 *  - `selectAllOnPage()` 勾选的是**当前过滤结果里的全部会话**（`sessions`），
 *    不是「已渲染的那一批」；对应模板里的「全选本页 ({{ sessions.length }})」；
 *  - `isAllSelected` / `isIndeterminate` 与它基于同一集合计算，
 *    所以两者不会因为分块渲染而互相矛盾；
 *  - 每次变更都替换整个 Set（而不是原地 mutate），保持与原先的响应式写法一致。
 */
export interface BatchSelectableSession {
  id: string
  cli: string
}

const selectionKey = (item: BatchSelectableSession): string => `${item.cli}::${item.id}`

export function useBatchSelection<T extends BatchSelectableSession>(sessions: Ref<T[]>) {
  const selectedIds = ref<Set<string>>(new Set())

  const toggleSelect = (item: T) => {
    const key = selectionKey(item)
    const next = new Set(selectedIds.value)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    selectedIds.value = next
  }

  /** 勾选当前过滤结果中的全部会话（注意：不是仅当前渲染窗口） */
  const selectAllOnPage = () => {
    const next = new Set(selectedIds.value)
    for (const s of sessions.value) {
      next.add(selectionKey(s))
    }
    selectedIds.value = next
  }

  const clearSelection = () => {
    selectedIds.value = new Set()
  }

  const selectedSessions = computed(() => {
    return sessions.value.filter(s => selectedIds.value.has(selectionKey(s)))
  })

  const isAllSelected = computed(() => {
    if (sessions.value.length === 0) return false
    return sessions.value.every(s => selectedIds.value.has(selectionKey(s)))
  })

  const isIndeterminate = computed(() => {
    const count = sessions.value.filter(s => selectedIds.value.has(selectionKey(s))).length
    return count > 0 && count < sessions.value.length
  })

  const toggleSelectAll = () => {
    if (isAllSelected.value) {
      clearSelection()
    } else {
      selectAllOnPage()
    }
  }

  return {
    selectedIds,
    toggleSelect,
    selectAllOnPage,
    clearSelection,
    selectedSessions,
    isAllSelected,
    isIndeterminate,
    toggleSelectAll
  }
}
