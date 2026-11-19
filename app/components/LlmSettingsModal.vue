<script setup lang="ts">
const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', val: boolean): void
}>()

const isOpen = computed({
  get: () => props.open,
  set: v => emit('update:open', v)
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

/** 协议清单由 GET /api/settings/llm 下发，前端不复制协议表（也避免把 LLM SDK 打进浏览器包） */
interface ProviderOption {
  value: string
  label: string
  spec: string
  defaultBaseUrl: string
  defaultModel: string
  modelExamples: string[]
}

const providers = ref<ProviderOption[]>([])

const providerOptions = computed(() => providers.value.map(p => ({ label: p.label, value: p.value })))
const currentSpec = computed(() => providers.value.find(p => p.value === form.value.providerType))

/** 连通性自检结果 */
const isTesting = ref(false)
const testResult = ref<{ ok: boolean, latencyMs?: number, sample?: string, error?: string, label?: string } | null>(null)

const loadSettings = async () => {
  isLoading.value = true
  try {
    const res = await $fetch<{ success: boolean, data: LLMSettingsForm, providers?: ProviderOption[] }>('/api/settings/llm')
    if (res?.providers?.length) providers.value = res.providers
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

/**
 * 切换协议：把端点与模型填成该协议的默认值。
 * 协议决定 wire format（OpenAI Chat / Responses / Anthropic Messages / Gemini），
 * 端点必须与之匹配，所以默认联动，用户仍可手改（自建代理、Azure 前置网关等）。
 */
const applyProvider = (type: string) => {
  form.value.providerType = type
  const spec = providers.value.find(p => p.value === type)
  if (spec) {
    form.value.baseUrl = spec.defaultBaseUrl
    form.value.model = spec.defaultModel
  }
  testResult.value = null
}

/** 连通性自检：先测再存，失败原因直接回显 */
const testConnection = async () => {
  isTesting.value = true
  testResult.value = null
  try {
    const res = await $fetch<{ ok: boolean, latencyMs?: number, sample?: string, error?: string, label?: string }>('/api/settings/llm/test', {
      method: 'POST',
      body: {
        providerType: form.value.providerType,
        baseUrl: form.value.baseUrl,
        model: form.value.model,
        temperature: Number(form.value.temperature) || 0,
        ...(form.value.apiKey.trim() ? { apiKey: form.value.apiKey.trim() } : {})
      }
    })
    testResult.value = res
  } catch (err) {
    testResult.value = { ok: false, error: (err as { data?: { message?: string } } | null)?.data?.message || '测试请求失败' }
  } finally {
    isTesting.value = false
  }
}

const toast = useToast()

const saveSettings = async () => {
  isSaving.value = true
  try {
    const payload: Partial<LLMSettingsForm> & Pick<LLMSettingsForm, 'enabled' | 'providerType' | 'baseUrl' | 'model' | 'temperature'> = {
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

    const res = await $fetch<{ success: boolean, data: { apiKeyMasked?: string, hasKey?: boolean } }>('/api/settings/llm', {
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
  } catch (err) {
    toast.add({ title: (err as { data?: { message?: string } } | null | undefined)?.data?.message || '保存设置失败', color: 'error', icon: 'i-lucide-alert-triangle' })
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="isOpen"
    :ui="{ content: 'max-w-lg' }"
  >
    <template #content>
      <div class="p-5 space-y-4">
        <!-- Header -->
        <div class="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-3">
          <div class="flex items-center gap-2">
            <div class="w-8 h-8 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center border border-purple-500/20">
              <UIcon
                name="i-lucide-cpu"
                class="w-4 h-4"
              />
            </div>
            <div>
              <h3 class="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                大模型 Provider 设置 (LLM Judge)
              </h3>
              <p class="text-[11px] text-zinc-400 mt-0.5">
                配置用于会话效能诊断、知识提炼的自定义大模型服务
              </p>
            </div>
          </div>
          <UButton
            size="sm"
            variant="ghost"
            color="neutral"
            icon="i-lucide-x"
            @click="isOpen = false"
          />
        </div>

        <!-- Form Body -->
        <div class="space-y-3.5 text-xs">
          <!-- Enable Toggle -->
          <div class="flex items-center justify-between p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30">
            <div>
              <div class="font-semibold text-zinc-900 dark:text-zinc-100">
                启用自定义模型进行诊断
              </div>
              <div class="text-[11px] text-zinc-400">
                开启后将优先通过用户配置的模型调用评估准则做审计
              </div>
            </div>
            <USwitch v-model="form.enabled" />
          </div>

          <!-- 调用协议（决定 wire format） -->
          <div class="space-y-1">
            <label class="font-medium text-zinc-700 dark:text-zinc-300 text-[11px]">调用协议 / 平台</label>
            <USelect
              :model-value="form.providerType"
              :items="providerOptions"
              size="sm"
              class="w-full text-xs"
              @update:model-value="applyProvider"
            />
            <div class="flex flex-wrap gap-1.5 pt-0.5">
              <button
                v-for="p in providers.filter(p => p.spec === 'openai-compatible' || p.value === 'openai' || p.value === 'anthropic' || p.value === 'gemini')"
                :key="p.value"
                type="button"
                :class="[
                  'px-2 py-1 rounded font-mono text-[10px] transition-colors border',
                  form.providerType === p.value
                    ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100'
                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-200/60 dark:border-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                ]"
                @click="applyProvider(p.value)"
              >
                {{ p.value }}
              </button>
            </div>
            <p
              v-if="currentSpec"
              class="text-[10px] text-zinc-400 leading-relaxed"
            >
              wire format: <span class="font-mono">{{ currentSpec.spec }}</span>
              · 默认端点 <span class="font-mono">{{ currentSpec.defaultBaseUrl }}</span>
              · 示例模型 <span class="font-mono">{{ currentSpec.modelExamples.join(' / ') }}</span>
            </p>
          </div>

          <!-- Base URL -->
          <UFormField :label="`Base URL（${currentSpec?.spec || 'openai-compatible'}）`">
            <UInput
              v-model="form.baseUrl"
              placeholder="https://api.openai.com/v1"
              size="sm"
              class="w-full font-mono text-xs"
            />
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
              <span
                v-if="form.hasKey"
                class="text-[10px] text-emerald-600 dark:text-emerald-400 block font-mono"
              >
                ✔ 当前已保存有效 Key: {{ form.apiKeyMasked }}
              </span>
            </div>
          </UFormField>

          <!-- Model Name -->
          <div class="grid grid-cols-2 gap-3">
            <UFormField label="Model 模型名称">
              <UInput
                v-model="form.model"
                :placeholder="currentSpec?.modelExamples?.join(' / ') || 'gpt-4o-mini'"
                size="sm"
                class="w-full font-mono text-xs"
              />
            </UFormField>

            <UFormField label="Temperature 温度">
              <UInput
                v-model.number="form.temperature"
                type="number"
                step="0.05"
                min="0"
                max="1"
                size="sm"
                class="w-full font-mono text-xs"
              />
            </UFormField>
          </div>
        </div>

        <!-- 连通性自检结果 -->
        <div
          v-if="testResult"
          :class="[
            'rounded-lg border px-3 py-2 text-[11px] leading-relaxed',
            testResult.ok
              ? 'border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300'
          ]"
        >
          <template v-if="testResult.ok">
            <div class="font-medium flex items-center gap-1.5">
              <UIcon
                name="i-lucide-check-circle"
                class="w-3.5 h-3.5"
              />
              连接成功 · {{ testResult.latencyMs }}ms · {{ testResult.label }}
            </div>
            <div
              v-if="testResult.sample"
              class="font-mono text-[10px] mt-1 opacity-80"
            >
              模型回复: {{ testResult.sample }}
            </div>
          </template>
          <template v-else>
            <div class="font-medium flex items-center gap-1.5">
              <UIcon
                name="i-lucide-x-circle"
                class="w-3.5 h-3.5"
              />
              连接失败
            </div>
            <div class="font-mono text-[10px] mt-1 break-all opacity-80">
              {{ testResult.error }}
            </div>
          </template>
        </div>

        <!-- Footer Actions -->
        <div class="flex items-center justify-between pt-3 border-t border-zinc-100 dark:border-zinc-800">
          <span
            v-if="saveSuccess"
            class="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-medium"
          >
            <UIcon
              name="i-lucide-check-circle"
              class="w-3.5 h-3.5"
            /> 保存成功！
          </span>
          <span
            v-else
            class="text-[10px] text-zinc-400 font-mono"
          >配置保存在本地 ~/.session-hub</span>

          <div class="flex items-center gap-2">
            <UButton
              variant="subtle"
              color="neutral"
              size="sm"
              icon="i-lucide-plug-zap"
              :loading="isTesting"
              @click="testConnection"
            >
              测试连接
            </UButton>
            <UButton
              variant="ghost"
              color="neutral"
              size="sm"
              @click="isOpen = false"
            >
              取消
            </UButton>
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
