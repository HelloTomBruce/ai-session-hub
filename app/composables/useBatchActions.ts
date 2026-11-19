import type { ComputedRef } from 'vue'

/**
 * 会话批量操作（删除 / 打标签 / 导出）。
 *
 * 从 app/pages/index.vue 抽出，行为保持原样：
 *  - 只通过传入的 `selectedSessions` 读取选中项，不在组合式里自己推导；
 *  - 操作成功后由调用方传入的 `refresh()` 刷新列表与统计，并 `clearSelection()`；
 *  - 不直接持有 `useFetch`，页面仍是数据的所有者；
 *  - 文案、toast 颜色/图标、弹窗打开顺序与失败分支全部沿用原实现。
 */
export interface BatchActionSession {
  id: string
  cli: string
}

export interface UseBatchActionsOptions<T extends BatchActionSession> {
  /** 当前选中的会话对象（由 useBatchSelection 提供） */
  selectedSessions: ComputedRef<T[]>
  /** 清空勾选（由 useBatchSelection 提供） */
  clearSelection: () => void
  /** 批量操作完成后的刷新回调（列表 + 统计 + 插件） */
  refresh: () => Promise<void>
}

export function useBatchActions<T extends BatchActionSession>(options: UseBatchActionsOptions<T>) {
  const { selectedSessions, clearSelection, refresh } = options
  const toast = useToast()

  const isBatchDeleting = ref(false)
  const isBatchDeleteModalOpen = ref(false)
  const isBatchTagging = ref(false)
  const batchTagInput = ref('')

  const openBatchDeleteConfirm = () => {
    if (selectedSessions.value.length === 0) return
    isBatchDeleteModalOpen.value = true
  }

  const executeBatchDelete = async () => {
    if (selectedSessions.value.length === 0) return
    isBatchDeleting.value = true
    try {
      const items = selectedSessions.value.map(s => ({ id: s.id, cli: s.cli }))
      const res = await $fetch<{
        success: boolean
        data: { successCount: number, failCount: number, errors: string[] }
      }>('/api/sessions/batch-delete', { method: 'POST', body: { items } })
      if (res.success) {
        isBatchDeleteModalOpen.value = false
        clearSelection()
        await refresh()
        if (res.data.failCount > 0) {
          toast.add({
            title: `已批量删除 ${res.data.successCount} 个会话，${res.data.failCount} 个失败`,
            color: 'warning',
            icon: 'i-lucide-alert-triangle'
          })
        } else {
          toast.add({
            title: `已成功批量删除 ${res.data.successCount} 个会话`,
            color: 'success',
            icon: 'i-lucide-check-circle-2'
          })
        }
      }
    } catch (err) {
      const fetchErr = err as { data?: { message?: string }, message?: string } | null | undefined
      toast.add({
        title: '批量删除失败: ' + (fetchErr?.data?.message || fetchErr?.message || '未知错误'),
        color: 'error',
        icon: 'i-lucide-alert-triangle'
      })
    } finally {
      isBatchDeleting.value = false
    }
  }

  const handleBatchAddTag = async () => {
    const tag = batchTagInput.value.trim()
    if (!tag) return
    isBatchTagging.value = true
    try {
      const items = selectedSessions.value.map(s => ({ id: s.id, cli: s.cli }))
      const res = await $fetch<{ success: boolean, message?: string }>('/api/sessions/batch-tag', {
        method: 'POST',
        body: { items, tags: [tag], mode: 'add' }
      })
      batchTagInput.value = ''
      clearSelection()
      await refresh()
      if (res.message) toast.add({ title: res.message, color: 'success', icon: 'i-lucide-check-circle-2' })
    } catch (err) {
      const fetchErr = err as { data?: { message?: string }, message?: string } | null | undefined
      toast.add({ title: '批量打标签失败: ' + (fetchErr?.data?.message || fetchErr?.message), color: 'error', icon: 'i-lucide-alert-triangle' })
    } finally {
      isBatchTagging.value = false
    }
  }

  const handleBatchExport = async (format: string) => {
    const items = selectedSessions.value.map(s => `${s.cli}::${s.id}`).join(',')
    const url = `/api/sessions/batch-export?items=${encodeURIComponent(items)}&format=${format}`
    window.open(url, '_blank')
    clearSelection()
  }

  return {
    isBatchDeleting,
    isBatchDeleteModalOpen,
    isBatchTagging,
    batchTagInput,
    openBatchDeleteConfirm,
    executeBatchDelete,
    handleBatchAddTag,
    handleBatchExport
  }
}
