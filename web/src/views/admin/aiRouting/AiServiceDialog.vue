<template>
  <el-dialog
    :model-value="modelValue"
    :title="isNew ? '添加服务' : '编辑服务'"
    width="520px"
    append-to-body
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="asd-form">
      <label class="asd-field">
        <span>名称</span>
        <el-input v-model="form.name" maxlength="80" placeholder="例如：本地 Ollama" />
      </label>
      <label class="asd-field">
        <span>厂家 / 协议</span>
        <el-select v-model="form.provider" filterable allow-create default-first-option @change="handleProviderChange">
          <el-option v-for="option in providerOptions" :key="option.value" :label="option.label" :value="option.value" />
        </el-select>
      </label>
      <label class="asd-field asd-field--wide">
        <span>API 地址</span>
        <el-input
          v-model="form.apiUrl"
          maxlength="240"
          :placeholder="urlPlaceholder"
          @change="probe = null"
        />
      </label>
      <label class="asd-field asd-field--wide">
        <span>API Key</span>
        <el-input v-model="form.apiKey" maxlength="240" show-password :placeholder="isOllama ? 'Ollama 可留空' : 'sk-...'" @change="probe = null" />
      </label>
      <label class="asd-field">
        <span>拾间 AI 历史消息数</span>
        <el-input-number v-model="form.assistantContextMaxMessages" :min="0" :max="60" controls-position="right" />
      </label>
      <label class="asd-field">
        <span>单条历史字符上限</span>
        <el-input-number v-model="form.assistantContextMaxCharsPerMessage" :min="0" :max="4000" :step="100" controls-position="right" />
      </label>
    </div>
    <p class="asd-note">
      {{ isOllama
        ? "Ollama 走 /v1/chat/completions，模型名填本机已安装的 tag，例如 qwen3:8b。"
        : isClaude
          ? "Claude 走 Messages 接口，中转站也填到 /v1/messages；模型名如 claude-sonnet-5-5。"
          : "服务端按地址自动识别协议：/responses、/chat/completions，或 Claude 的 /messages。" }}
      历史消息两项只对拾间 AI 生效，0 表示不限制；云端服务建议 0 / 0，本地 Ollama 建议 2 / 800。
    </p>
    <p class="asd-probe" :class="probe && (probe.ok ? 'is-good' : 'is-bad')">
      <el-button size="small" :loading="probing" :disabled="!form.apiUrl.trim()" @click="runProbe">读取模型目录</el-button>
      <span v-if="probe">{{ probe.ok ? `连接正常，读到 ${probe.models.length} 个模型，用时 ${probe.latencyMs}ms` : `读取失败：${probe.error}` }}</span>
    </p>
    <template #footer>
      <div class="asd-footer">
        <el-button v-if="!isNew" type="danger" text :disabled="!canDelete" @click="emit('delete', form.id)">删除这个服务</el-button>
        <span class="asd-spacer" />
        <el-button @click="emit('update:modelValue', false)">取消</el-button>
        <el-button type="primary" :disabled="!form.name.trim()" @click="confirm">确定</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { adminApi, type AiServiceConfig, type AiServiceProbe } from "@/api/admin";

const props = defineProps<{
  modelValue: boolean;
  /** 为空表示新建。 */
  service: AiServiceConfig | null;
  canDelete: boolean;
}>();
const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  /** 确定后交回编辑好的服务和刚读到的模型目录；写进线路草稿，和其他改动一起保存。 */
  save: [service: AiServiceConfig, probe: AiServiceProbe | null];
  delete: [serviceId: string];
}>();

const DEFAULT_REMOTE_URL = "https://api.deepseek.com/chat/completions";
const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
const DEFAULT_CLAUDE_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_URLS = [DEFAULT_REMOTE_URL, DEFAULT_OLLAMA_URL, DEFAULT_CLAUDE_URL];
const providerOptions = [
  { value: "deepseek", label: "DeepSeek 兼容接口" },
  { value: "openai", label: "OpenAI 兼容接口" },
  { value: "anthropic", label: "Claude 兼容接口" },
  { value: "ollama", label: "Ollama" },
];

function blankService(): AiServiceConfig {
  return {
    id: `service-${Date.now()}`,
    name: "",
    provider: "deepseek",
    apiUrl: DEFAULT_REMOTE_URL,
    apiKey: "",
    assistantContextMaxMessages: 0,
    assistantContextMaxCharsPerMessage: 0,
  };
}

const form = reactive<AiServiceConfig>(blankService());
const probe = ref<AiServiceProbe | null>(null);
const probing = ref(false);
const isNew = computed(() => !props.service);
const isOllama = computed(() => form.provider.trim().toLowerCase() === "ollama");
const isClaude = computed(() => form.provider.trim().toLowerCase() === "anthropic");
const urlPlaceholder = computed(() => {
  if (isOllama.value) return DEFAULT_OLLAMA_URL;
  if (isClaude.value) return DEFAULT_CLAUDE_URL;
  return "支持 /v1/responses、/v1/chat/completions 或 /v1/messages";
});

watch(() => props.modelValue, (open) => {
  if (!open) return;
  // 逐个字段覆盖，免得上一次编辑的停用标记留在表单里。
  delete form.disabled;
  Object.assign(form, props.service ? { ...props.service } : blankService());
  probe.value = null;
});

/** 切换厂家时，顺手换掉还是默认值的地址；在云端和本地之间切换时也换掉上下文限制。 */
function handleProviderChange() {
  const url = form.apiUrl.trim();
  if (!url || DEFAULT_URLS.includes(url)) {
    form.apiUrl = isOllama.value ? DEFAULT_OLLAMA_URL : isClaude.value ? DEFAULT_CLAUDE_URL : DEFAULT_REMOTE_URL;
  }
  if (isOllama.value && form.apiUrl === DEFAULT_OLLAMA_URL) {
    if (form.assistantContextMaxMessages === 0 && form.assistantContextMaxCharsPerMessage === 0) {
      form.assistantContextMaxMessages = 2;
      form.assistantContextMaxCharsPerMessage = 800;
    }
  } else if (!isOllama.value && url === DEFAULT_OLLAMA_URL) {
    if (form.assistantContextMaxMessages === 2 && form.assistantContextMaxCharsPerMessage === 800) {
      form.assistantContextMaxMessages = 0;
      form.assistantContextMaxCharsPerMessage = 0;
    }
  }
  probe.value = null;
}

async function runProbe() {
  if (probing.value) return;
  probing.value = true;
  try {
    const [result] = await adminApi.probeAiServices(
      [{ id: form.id, provider: form.provider.trim(), apiUrl: form.apiUrl.trim(), apiKey: form.apiKey.trim() }],
      { timeout: 45_000, preserveResponseCache: true },
    );
    probe.value = result ?? null;
  } finally {
    probing.value = false;
  }
}

function confirm() {
  emit("save", {
    ...form,
    name: form.name.trim(),
    provider: form.provider.trim() || "deepseek",
    apiUrl: form.apiUrl.trim(),
    apiKey: form.apiKey.trim(),
  }, probe.value);
  emit("update:modelValue", false);
}
</script>

<style scoped>
.asd-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.asd-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.asd-field--wide {
  grid-column: 1 / -1;
}

.asd-field > span {
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-xs);
}

.asd-field :deep(.el-select),
.asd-field :deep(.el-input-number) {
  width: 100%;
}

.asd-note {
  margin: 12px 0 0;
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-xs);
  line-height: 1.6;
}

.asd-probe {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 12px 0 0;
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-s);
}

.asd-probe.is-good {
  color: var(--cpu-success);
}

.asd-probe.is-bad {
  color: var(--cpu-danger);
}

.asd-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.asd-spacer {
  flex: 1;
}

@media (max-width: 640px) {
  .asd-form {
    grid-template-columns: 1fr;
  }
}
</style>
