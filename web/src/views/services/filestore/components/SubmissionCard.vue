<template>
  <article v-if="detail" class="fs-sub">
    <header>
      <span class="fs-sub-avatar" aria-hidden="true">{{ owner.slice(0, 1) }}</span>
      <div class="fs-sub-who">
        <b>{{ owner }}</b>
        <span>{{ identifier || `提交 #${submission.id}` }} · {{ formatDateTime(submission.createdAt) }}</span>
      </div>
      <el-button text type="danger" :icon="Delete" aria-label="删除提交" @click="deleteSubmission(submission)" />
    </header>

    <dl v-if="extraRows.length" class="fs-sub-fields">
      <div v-for="row in extraRows" :key="row.key">
        <dt>{{ row.label }}</dt>
        <dd>{{ row.value || "-" }}</dd>
      </div>
    </dl>

    <ul class="fs-sub-files">
      <li v-for="file in submission.files" :key="file.id">
        <FileBadge :name="file.storedName" :size="34" />
        <div class="fs-sub-file-copy">
          <b>{{ file.storedName }}</b>
          <span>{{ file.originalName }} · {{ formatBytes(file.size) }}</span>
        </div>
        <el-dropdown trigger="click" placement="bottom-end" @command="(action: string) => onFileAction(action, file)">
          <el-button text :icon="MoreFilled" aria-label="文件操作" />
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="preview" :icon="View">查看</el-dropdown-item>
              <el-dropdown-item command="download" :icon="Download">下载</el-dropdown-item>
              <el-dropdown-item command="delete" :icon="Delete" divided class="fs-danger-item">删除</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </li>
    </ul>
    <p class="fs-sub-ip">IP {{ submission.ip || "-" }}</p>
  </article>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Delete, Download, MoreFilled, View } from "@element-plus/icons-vue";
import type { FilestoreFile, FilestoreSubmission } from "@/api/filestore";
import { formatBytes } from "@/views/services/fileCollectExport";
import { formatDateTime, formatSurveyAnswer, submissionIdentifier, submissionOwner } from "../shared";
import { useInjectedFilestoreWorkspace } from "../workspace";
import FileBadge from "./FileBadge.vue";

const props = defineProps<{ submission: FilestoreSubmission }>();
const { detail, deleteSubmission, previewFile, downloadFile, deleteFile } = useInjectedFilestoreWorkspace();

const owner = computed(() => (detail.value ? submissionOwner(detail.value, props.submission) : ""));
const identifier = computed(() => (detail.value ? submissionIdentifier(detail.value, props.submission) : ""));
// 身份字段里已经作为标题展示的姓名和编号不再重复列出。
const extraRows = computed(() => {
  const task = detail.value;
  if (!task) return [];
  const shown = new Set([owner.value, identifier.value]);
  return [
    ...task.fields
      .filter((field) => !shown.has(props.submission.data[field.key] || ""))
      .map((field) => ({ key: `f-${field.key}`, label: field.label, value: props.submission.data[field.key] || "" })),
    ...(task.surveyFields || []).map((field) => ({ key: `q-${field.id}`, label: field.label, value: formatSurveyAnswer(props.submission.answers?.[field.id]) })),
  ];
});

function onFileAction(action: string, file: FilestoreFile) {
  if (action === "preview") void previewFile(file);
  else if (action === "download") void downloadFile(file);
  else if (action === "delete") void deleteFile(file);
}
</script>

<style scoped>
.fs-sub { display: flex; flex-direction: column; gap: 10px; padding: 12px 12px 10px; border: 1px solid var(--cpu-border-soft); border-radius: 16px; background: var(--cpu-card); box-shadow: var(--cpu-shadow-sm); }
.fs-sub header { display: flex; align-items: center; gap: 10px; }
.fs-sub-avatar { display: grid; width: 34px; height: 34px; flex: 0 0 auto; place-items: center; border-radius: 50%; background: var(--cpu-primary-soft); color: var(--cpu-primary); font-size: 14px; font-weight: 700; }
.fs-sub-who { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 1px; }
.fs-sub-who b { overflow: hidden; font-size: 15px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.fs-sub-who span { overflow: hidden; color: var(--cpu-text-muted); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.fs-sub header .el-button { width: 34px; margin: 0; padding: 0; }

.fs-sub-fields { display: flex; flex-direction: column; gap: 4px; margin: 0; padding: 8px 10px; border-radius: 10px; background: var(--cpu-surface-soft); }
.fs-sub-fields > div { display: flex; gap: 10px; font-size: 12px; line-height: 1.55; }
.fs-sub-fields dt { width: 84px; flex: 0 0 auto; color: var(--cpu-text-muted); }
.fs-sub-fields dd { min-width: 0; margin: 0; color: var(--cpu-text); overflow-wrap: anywhere; }

.fs-sub-files { display: flex; flex-direction: column; margin: 0; padding: 0; list-style: none; }
.fs-sub-files li { display: flex; align-items: center; gap: 10px; padding: 6px 0; }
.fs-sub-files li + li { border-top: 1px solid var(--cpu-border-soft); }
.fs-sub-file-copy { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 1px; }
.fs-sub-file-copy b { overflow: hidden; font-size: 13px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.fs-sub-file-copy span { overflow: hidden; color: var(--cpu-text-muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.fs-sub-files .el-button { width: 34px; margin: 0; padding: 0; }
.fs-sub-ip { margin: 0; color: var(--cpu-text-muted); font-size: 11px; text-align: right; }
:global(.fs-danger-item) { color: var(--cpu-danger) !important; }
</style>
