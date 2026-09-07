<script setup lang="ts">
const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', val: boolean): void
}>()

const isOpen = computed({
  get: () => props.open,
  set: (v) => emit('update:open', v)
})

interface LLMSettingsForm {
  enabled: boolean
  providerType: string
  baseUrl: string
  apiKey: string
  apiKeyMasked?: string
  hasKey?: boolean
  model: string
  temperature: number
}

const form = ref<LLMSettingsForm>({
  enabled: false,
  providerType: 'openai-compatible',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  temperature: 0.1
})

const isLoading = ref(false)
const isSaving = ref(false)
const saveSuccess = ref(false)

const loadSettings = async () => {
  isLoading.value = true
  try {
    const res = await $fetch<{ success: boolean, data: LLMSettingsForm }>('/api/settings/llm')
    if (res?.data) {
      form.value = {
        ...res.data,
        apiKey: '' // Keep input empty unless user intends to change key
      }
    }
  } catch (err) {
    console.error('Failed to load LLM settings:', err)
  } finally {
    isLoading.value = false
  }
}

watch(() => props.open, (open) => {
  if (open) {
    loadSettings()
  }
})

const providerPresets: Record<string, { baseUrl: string; model: string }> = {
  'openai-compatible': { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  'deepseek': { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  'gemini': { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash' },
  'ollama': { baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5-coder:7b' }
}

const applyPreset = (presetKey: string) => {
  if (providerPresets[presetKey]) {
    form.value.baseUrl = providerPresets[presetKey].baseUrl
    form.value.model = providerPresets[presetKey].model
    form.value.providerType = presetKey
  }
}

const saveSettings = async () => {
  isSaving.value = true
  try {
    const payload: any = {
      enabled: form.value.enabled,
      providerType: form.value.providerType,
      baseUrl: form.value.baseUrl,
      model: form.value.model,
      temperature: Number(form.value.temperature) || 0.1
    }
    // Only send API Key if user entered a new one
    if (form.value.apiKey.trim()) {
      payload.apiKey = form.value.apiKey.trim()
    }

    const res = await $fetch<{ success: boolean, data: any }>('/api/settings/llm', {
      method: 'PUT',
      body: payload
    })

    if (res?.data) {
      form.value.apiKeyMasked = res.data.apiKeyMasked
      form.value.hasKey = res.data.hasKey
      form.value.apiKey = ''
    }

    saveSuccess.value = true
    setTimeout(() => {
      saveSuccess.value = false
      isOpen.value = false
    }, 1200)
  } catch (err: any) {
    alert(err?.data?.message || '保存设置失败')
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <UModal v-model:open="isOpen" :ui="{ content: 'max-w-lg' }">
    <template #content>
      <div class="p-5 space-y-4">
        <!-- Header -->
        <div class="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-3">
          <div class="flex items-center gap-2">
            <div class="w-8 h-8 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center border border-purple-500/20">
              <UIcon name="i-lucide-cpu" class="w-4 h-4" />
            </div>
            <div>
              <h3 class="text-sm font-bold text-zinc-900 dark:text-zinc-100">大模型 Provider 设置 (LLM Judge)</h3>
              <p class="text-[11px] text-zinc-400 mt-0.5">配置用于会话效能诊断、知识提炼的自定义大模型服务</p>
            </div>
          </div>
          <UButton size="sm" variant="ghost" color="neutral" icon="i-lucide-x" @click="isOpen = false" />
        </div>

        <!-- Form Body -->
        <div class="space-y-3.5 text-xs">
          <!-- Enable Toggle -->
          <div class="flex items-center justify-between p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30">
            <div>
              <div class="font-semibold text-zinc-900 dark:text-zinc-100">启用自定义模型进行诊断</div>
              <div class="text-[11px] text-zinc-400">开启后将优先通过用户配置的模型调用评估准则做审计</div>
            </div>
            <USwitch v-model="form.enabled" />
          </div>

          <!-- Quick Presets -->
          <div class="space-y-1">
            <label class="font-medium text-zinc-700 dark:text-zinc-300 text-[11px]">快捷预设平台</label>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="(meta, pKey) in providerPresets"
                :key="pKey"
                type="button"
                @click="applyPreset(pKey)"
                class="px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 font-mono text-[10px] transition-colors border border-zinc-200/60 dark:border-zinc-700"
              >
                {{ pKey }}
              </button>
            </div>
          </div>

          <!-- Base URL -->
          <UFormField label="Base URL (兼容 OpenAI 规范)">
            <UInput v-model="form.baseUrl" placeholder="https://api.openai.com/v1" size="sm" class="w-full font-mono text-xs" />
          </UFormField>

          <!-- API Key -->
          <UFormField label="API Key">
            <div class="space-y-1 w-full">
              <UInput
                v-model="form.apiKey"
                type="password"
                :placeholder="form.hasKey ? `已配置 (${form.apiKeyMasked})，留空则保持不变` : '输入你的 API Key (如 sk-...)'"
                size="sm"
                class="w-full font-mono text-xs"
              />
              <span v-if="form.hasKey" class="text-[10px] text-emerald-600 dark:text-emerald-400 block font-mono">
                ✔ 当前已保存有效 Key: {{ form.apiKeyMasked }}
              </span>
            </div>
          </UFormField>

          <!-- Model Name -->
          <div class="grid grid-cols-2 gap-3">
            <UFormField label="Model 模型名称">
              <UInput v-model="form.model" placeholder="gpt-4o-mini / deepseek-chat" size="sm" class="w-full font-mono text-xs" />
            </UFormField>

            <UFormField label="Temperature 温度">
              <UInput v-model.number="form.temperature" type="number" step="0.05" min="0" max="1" size="sm" class="w-full font-mono text-xs" />
            </UFormField>
          </div>
        </div>

        <!-- Footer Actions -->
        <div class="flex items-center justify-between pt-3 border-t border-zinc-100 dark:border-zinc-800">
          <span v-if="saveSuccess" class="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-medium">
            <UIcon name="i-lucide-check-circle" class="w-3.5 h-3.5" /> 保存成功！
          </span>
          <span v-else class="text-[10px] text-zinc-400 font-mono">配置保存在本地 ~/.session-hub</span>

          <div class="flex items-center gap-2">
            <UButton variant="ghost" color="neutral" size="sm" @click="isOpen = false">取消</UButton>
            <UButton
              color="neutral"
              size="sm"
              class="bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              :loading="isSaving"
              @click="saveSettings"
            >
              保存配置
            </UButton>
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>
