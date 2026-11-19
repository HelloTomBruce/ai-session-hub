import type { Ref } from 'vue'

/**
 * 单条会话操作：打开详情 / 重命名 / 删除。
 *
 * 从 app/pages/index.vue 抽出，行为保持原样：
 *  - `openDetail` 仍是路由跳转（详情页是独立页面，不是弹窗）；
 *  - 重命名成功后先就地更新标题，再交给调用方的 `syncTitleToList` 同步列表数据，
 *    最后 `refresh()`；失败分支的 toast 文案与图标不变；
 *  - 删除成功后关闭删除弹窗（若详情弹窗开着也一并关闭）再 `refresh()`。
 *
 * 数据刷新与列表数据都由页面持有，组合式只负责交互状态与请求编排。
 */
export interface EditableSession {
  id: string
  cli: string
  title: string
}

export interface UseSessionActionsOptions<T extends EditableSession> {
  /** 变更后的刷新回调（列表 + 统计 + 插件） */
  refresh: () => Promise<void>
  /** 把新标题同步回页面持有的列表数据（原先直接改 sessionData 里的同一条） */
  syncTitleToList?: (session: T, title: string) => void
}

export function useSessionActions<T extends EditableSession>(options: UseSessionActionsOptions<T>) {
  const { refresh, syncTitleToList } = options
  const toast = useToast()

  // Detail
  const isDetailOpen = ref(false)
  const selectedSession = ref(null) as Ref<T | null>

  const openDetail = (session: T) => {
    navigateTo(`/sessions/${session.id}?cli=${session.cli}`)
  }

  // Edit Modal
  const isEditOpen = ref(false)
  const editingTitle = ref('')
  const isSavingEdit = ref(false)

  const startEdit = (session: T) => {
    selectedSession.value = session
    editingTitle.value = session.title
    isEditOpen.value = true
  }

  const saveEdit = async () => {
    if (!selectedSession.value) return
    isSavingEdit.value = true
    try {
      const res = await $fetch<{ success: boolean, message?: string }>(`/api/sessions/${selectedSession.value.id}?cli=${selectedSession.value.cli}`, {
        method: 'PUT',
        body: { title: editingTitle.value }
      })
      if (res.success) {
        // 就地更新弹窗里持有的对象，再同步页面列表数据（原实现的两步，语义不变）
        const edited = selectedSession.value
        if (edited) {
          edited.title = editingTitle.value
          syncTitleToList?.(edited, editingTitle.value)
        }
        isEditOpen.value = false
        await refresh()
      } else {
        toast.add({ title: res.message || '修改失败', color: 'error', icon: 'i-lucide-alert-triangle' })
      }
    } catch (err) {
      const fetchErr = err as { data?: { message?: string }, message?: string } | null | undefined
      toast.add({ title: fetchErr?.data?.message || fetchErr?.message || '修改失败', color: 'error', icon: 'i-lucide-alert-triangle' })
    } finally {
      isSavingEdit.value = false
    }
  }

  // Delete Modal
  const isDeleteOpen = ref(false)
  const isDeleting = ref(false)

  const confirmDelete = (session: T) => {
    selectedSession.value = session
    isDeleteOpen.value = true
  }

  const executeDelete = async () => {
    if (!selectedSession.value) return
    isDeleting.value = true
    try {
      const res = await $fetch<{ success: boolean, message?: string }>(`/api/sessions/${selectedSession.value.id}?cli=${selectedSession.value.cli}`, {
        method: 'DELETE'
      })
      if (res.success) {
        isDeleteOpen.value = false
        if (isDetailOpen.value) isDetailOpen.value = false
        await refresh()
      } else {
        toast.add({ title: res.message || '删除失败', color: 'error', icon: 'i-lucide-alert-triangle' })
      }
    } catch (err) {
      const fetchErr = err as { data?: { message?: string }, message?: string } | null | undefined
      toast.add({ title: fetchErr?.data?.message || fetchErr?.message || '删除失败', color: 'error', icon: 'i-lucide-alert-triangle' })
    } finally {
      isDeleting.value = false
    }
  }

  return {
    isDetailOpen,
    selectedSession,
    openDetail,
    isEditOpen,
    editingTitle,
    isSavingEdit,
    startEdit,
    saveEdit,
    isDeleteOpen,
    isDeleting,
    confirmDelete,
    executeDelete
  }
}
