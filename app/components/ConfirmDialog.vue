<script setup lang="ts">
const { isOpen, options, resolveConfirm } = useConfirm()
</script>

<template>
  <UModal
    :open="isOpen"
    :ui="{ content: 'max-w-sm' }"
    @update:open="(v) => !v && resolveConfirm(false)"
  >
    <template #content>
      <div class="p-5 space-y-4">
        <div class="space-y-1.5">
          <h3 class="text-sm font-bold text-zinc-900 dark:text-zinc-100">
            {{ options.title }}
          </h3>
          <p
            v-if="options.description"
            class="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed"
          >
            {{ options.description }}
          </p>
        </div>
        <div class="flex justify-end gap-2">
          <UButton
            size="sm"
            color="neutral"
            variant="outline"
            @click="resolveConfirm(false)"
          >
            {{ options.cancelLabel || '取消' }}
          </UButton>
          <UButton
            size="sm"
            :color="options.danger ? 'error' : 'neutral'"
            :variant="options.danger ? 'solid' : 'outline'"
            @click="resolveConfirm(true)"
          >
            {{ options.confirmLabel || '确认' }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
