import { ref, readonly } from 'vue'

interface ConfirmOptions {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  /** 危险操作（删除类）时确认按钮使用错误色 */
  danger?: boolean
}

const isOpen = ref(false)
const options = ref<ConfirmOptions>({ title: '' })
let resolver: ((value: boolean) => void) | null = null

/**
 * 全局 Promise 式确认对话框。
 * 在任意组件中调用 `const { confirm } = useConfirm()`，
 * 然后 `if (!await confirm({ title: '...' })) return`。
 * 通过 app.vue 中挂载的 <ConfirmDialog /> 渲染。
 */
export function useConfirm() {
  const confirm = (opts: ConfirmOptions): Promise<boolean> => {
    // 上一次未决的确认直接以 false 收尾，避免 resolver 泄漏
    resolver?.(false)
    options.value = opts
    isOpen.value = true
    return new Promise<boolean>((resolve) => {
      resolver = resolve
    })
  }

  const resolveConfirm = (value: boolean) => {
    isOpen.value = false
    resolver?.(value)
    resolver = null
  }

  return {
    isOpen: readonly(isOpen),
    options: readonly(options),
    confirm,
    resolveConfirm
  }
}
