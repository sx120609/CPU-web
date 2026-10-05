<template>
  <dl v-if="detail" class="fs-rules">
    <div><dt>状态</dt><dd><span class="fs-rules-dot" :class="detail.status" aria-hidden="true" />{{ statusText(detail.status) }}</dd></div>
    <div><dt>截止时间</dt><dd>{{ detail.deadline ? formatDateTime(detail.deadline) : "未设置" }}</dd></div>
    <div><dt>身份字段</dt><dd>{{ detail.fields.map((field) => field.label).join("、") }}</dd></div>
    <div><dt>问卷题目</dt><dd>{{ detail.surveyFields?.length ? detail.surveyFields.map((field) => field.label).join("、") : "未启用" }}</dd></div>
    <div><dt>文件类型</dt><dd>{{ detail.fileRules.allowedTypes.join(", ") || "不限" }}</dd></div>
    <div><dt>大小 / 数量</dt><dd>单个不超过 {{ detail.fileRules.maxSizeMb }} MB · 最多 {{ detail.fileRules.maxCount }} 个</dd></div>
    <div><dt>文件命名</dt><dd><code>{{ detail.renameTemplate }}</code></dd></div>
    <div><dt>文件夹</dt><dd><code>{{ detail.folderTemplate || "{name}-{student_id}" }}</code></dd></div>
    <div v-if="viewer?.isSuperAdmin"><dt>创建者</dt><dd>{{ formatCreator(detail.createdBy) }}</dd></div>
  </dl>
</template>

<script setup lang="ts">
import { formatCreator, formatDateTime, statusText } from "../shared";
import { useInjectedFilestoreWorkspace } from "../workspace";

const { detail, viewer } = useInjectedFilestoreWorkspace();
</script>

<style scoped>
.fs-rules { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 24px; margin: 0; }
.fs-rules > div { display: grid; grid-template-columns: 88px minmax(0, 1fr); gap: 12px; padding: 10px 2px; border-bottom: 1px dashed var(--cpu-border-soft); font-size: 13px; }
.fs-rules dt { color: var(--cpu-text-muted); }
.fs-rules dd { display: flex; min-width: 0; align-items: center; gap: 6px; margin: 0; color: var(--cpu-text); overflow-wrap: anywhere; }
.fs-rules code { padding: 1px 6px; border-radius: 6px; background: var(--cpu-surface-soft); font-family: var(--cpu-font-mono); font-size: 12px; }
.fs-rules-dot { width: 8px; height: 8px; flex: 0 0 auto; border-radius: 50%; background: var(--cpu-success); }
.fs-rules-dot.closed { background: var(--cpu-text-muted); }

@media (max-width: 960px) {
  .fs-rules { grid-template-columns: minmax(0, 1fr); }
  .fs-rules > div { grid-template-columns: 76px minmax(0, 1fr); }
}
</style>
