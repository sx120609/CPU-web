<template>
  <el-dialog
    :model-value="modelValue"
    :title="documentTitles[activeDocument]"
    width="min(860px, calc(100vw - 24px))"
    class="policy-document-dialog"
    append-to-body
    destroy-on-close
    :close-on-click-modal="false"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="policy-document-reader">
      <p v-if="loading" role="status">正在加载{{ documentTitles[activeDocument] }}…</p>
      <div v-else-if="loadError" role="alert">
        <p>暂时无法加载正文，请重试。</p>
        <el-button @click="loadDocument(activeDocument)">重新加载</el-button>
      </div>
      <article v-else class="policy-document-content" v-html="content" @click="onDocumentClick" />
    </div>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">关闭并返回</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import DOMPurify from 'dompurify';

const props = defineProps<{ modelValue: boolean; document: 'privacy' | 'terms' }>();
const emit = defineEmits<{ (event: 'update:modelValue', value: boolean): void }>();
const documentTitles = { privacy: '隐私政策', terms: '用户协议', 'community-rules': '社区治理规则' } as const;
type PolicyDocument = keyof typeof documentTitles;
const activeDocument = ref<PolicyDocument>(props.document);
const content = ref('');
const loading = ref(false);
const loadError = ref(false);
let request: AbortController | null = null;

async function loadDocument(document: PolicyDocument) {
  request?.abort();
  const currentRequest = new AbortController();
  request = currentRequest;
  activeDocument.value = document;
  loading.value = true;
  loadError.value = false;
  content.value = '';
  try {
    const response = await fetch(`/${document}.html`, { signal: currentRequest.signal });
    if (!response.ok) throw new Error('Policy document unavailable');
    const page = new DOMParser().parseFromString(await response.text(), 'text/html');
    const documentBody = page.querySelector('article') || page.querySelector('main') || page.body;
    if (!currentRequest.signal.aborted) {
      content.value = DOMPurify.sanitize(documentBody.innerHTML, {
        USE_PROFILES: { html: true },
        FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe'],
        FORBID_ATTR: ['style'],
      });
    }
  } catch {
    if (!currentRequest.signal.aborted) loadError.value = true;
  } finally {
    if (request === currentRequest) loading.value = false;
  }
}

function onDocumentClick(event: MouseEvent) {
  const link = event.target instanceof Element ? event.target.closest('a') : null;
  if (!link) return;
  const destination = new URL(link.href, window.location.href);
  if (destination.origin !== window.location.origin) return;
  const document = destination.pathname.replace(/^\//, '').replace(/\.html$/, '');
  if (Object.hasOwn(documentTitles, document)) {
    event.preventDefault();
    void loadDocument(document as PolicyDocument);
  }
}

watch([() => props.modelValue, () => props.document], ([open, document]) => {
  if (open) void loadDocument(document);
  else request?.abort();
}, { immediate: true });
onBeforeUnmount(() => request?.abort());
</script>

<style scoped>
.policy-document-reader {
  height: min(62dvh, 640px);
  overflow: auto;
  overscroll-behavior: contain;
  padding: 4px 12px 4px 2px;
  color: var(--cpu-text);
  font-size: 15px;
  line-height: 1.85;
}

.policy-document-content :deep(h1) { margin: 0 0 12px; font-size: 22px; line-height: 1.4; }
.policy-document-content :deep(h2) { margin: 24px 0 10px; font-size: 18px; line-height: 1.5; }
.policy-document-content :deep(p) { margin: 0 0 14px; }
.policy-document-content :deep(ul), .policy-document-content :deep(ol) { padding-left: 22px; }
.policy-document-content :deep(li) { margin: 8px 0; }
.policy-document-content :deep(.meta) { color: var(--cpu-text-secondary); font-size: 13px; }
.policy-document-content :deep(a) { color: var(--cpu-primary); text-underline-offset: 3px; }
.policy-document-content :deep(a:focus-visible) { outline: 2px solid var(--cpu-primary); outline-offset: 3px; }

@media (max-width: 600px) {
  .policy-document-reader { padding-right: 6px; }
}

:global(.policy-document-dialog.el-dialog) {
  --el-dialog-margin-top: 5dvh;
  max-height: calc(100dvh - 24px);
  overflow: auto;
}
</style>
