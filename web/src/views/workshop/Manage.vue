<template>
  <div class="wk-page wk-manage">
    <router-link class="wk-back" to="/workshop">
      <el-icon aria-hidden="true"><ArrowLeft /></el-icon>创意工坊
    </router-link>
    <header class="wk-head">
      <div class="wk-head-copy">
        <h1>我的作品</h1>
        <p>上传作品包，自己先试一遍，再提交审核；通过后公开。</p>
      </div>
      <div class="wk-actions">
        <el-button @click="router.push('/workshop/develop')">开发指南</el-button>
        <el-button type="primary" :icon="Upload" @click="openUpload(null)">上传作品</el-button>
      </div>
    </header>

    <div v-if="loading" class="wk-group" role="status" aria-label="正在加载我的作品">
      <el-skeleton :rows="5" animated />
    </div>
    <div v-else-if="error" class="wk-group wk-empty" role="alert">
      <p>{{ error }}</p>
      <el-button @click="load">重试</el-button>
    </div>
    <div v-else-if="!works.length" class="wk-group wk-empty">
      <el-icon aria-hidden="true"><Box /></el-icon>
      <p>还没有作品。从模板改一个，或者让 AI 帮你写，打包成 ZIP 传上来。</p>
      <div class="wk-actions">
        <el-button type="primary" @click="openUpload(null)">上传作品</el-button>
        <el-button @click="router.push('/workshop/develop')">看看怎么做</el-button>
      </div>
    </div>
    <template v-else>
      <section v-for="work in works" :key="work.id" class="wk-group wk-group--flush">
        <div class="wk-manage-work">
          <WorkIcon :slug="work.slug" :name="workName(work)" :type="work.version?.type" :size="44" />
          <div class="wk-manage-copy">
            <h2 class="wk-h2">
              <router-link :to="`/workshop/${work.id}`">{{ workName(work) }}</router-link>
              <em class="wk-chip" :class="`is-${workState(work).tone}`">{{ workState(work).label }}</em>
            </h2>
            <p class="wk-meta">
              <span>{{ typeLabels[work.version?.type || "tool"] }}</span>
              <span>标识 {{ work.slug }}</span>
              <span>{{ work.favoriteCount }} 人收藏</span>
            </p>
          </div>
          <el-button :disabled="work.disabled" @click="openUpload(work)">上传新版本</el-button>
        </div>
        <p v-if="work.disabled" class="wk-note is-danger wk-manage-note">
          这个作品已被管理员停用，暂时不能预览、提交或上传新版本。
        </p>
        <p v-if="detailErrors[work.id]" class="wk-note is-danger wk-manage-note" role="alert">
          {{ detailErrors[work.id] }}
          <el-button text size="small" @click="loadVersions(work)">重试</el-button>
        </p>
        <div class="wk-rows wk-manage-versions">
          <div v-for="version in versionsOf(work)" :key="version.id" class="wk-row">
            <div class="wk-row-copy">
              <div class="wk-row-title">
                <span>v{{ version.version }}</span>
                <em class="wk-chip" :class="`is-${statusTone[version.status]}`">{{ statusLabels[version.status] }}</em>
                <em v-if="version.id === work.publishedVersionId" class="wk-chip is-ok">公开中</em>
              </div>
              <p class="wk-meta">
                <span>{{ workshopDate(version.createdAt) }} 上传</span>
                <span v-if="hint(work, version)">{{ hint(work, version) }}</span>
              </p>
              <p v-if="version.reviewReason" class="wk-note is-danger wk-manage-reason">
                审核意见：{{ version.reviewReason }}
              </p>
            </div>
            <div class="wk-actions">
              <el-button :disabled="work.disabled" @click="router.push(playerPath(work.id, version.id))">预览</el-button>
              <el-button
                v-if="canSubmit(work, version)"
                type="primary"
                :disabled="work.disabled"
                :loading="submitBusy.has(version.id)"
                @click="submit(version)"
                >{{ version.status === "DRAFT" ? "提交审核" : "重新提交" }}</el-button
              >
              <el-button
                v-if="version.id !== work.publishedVersionId"
                text
                :disabled="work.disabled"
                :loading="deleteBusy.has(version.id)"
                :aria-label="`删除 v${version.version}`"
                @click="removeVersion(work, version)"
                >删除</el-button
              >
            </div>
          </div>
          <p v-if="!versionsOf(work).length" class="wk-row wk-sub">这个作品没有版本了，可以上传新版本。</p>
        </div>
      </section>
      <div v-if="total > pageSize" class="wk-pagination">
        <el-pagination
          v-model:current-page="page"
          :page-size="pageSize"
          :total="total"
          layout="prev, pager, next"
          @current-change="load"
        />
      </div>
    </template>

    <el-dialog
      v-model="uploadOpen"
      class="wk-dialog"
      :title="uploadTarget ? `上传新版本 · ${workName(uploadTarget)}` : '上传作品'"
      width="min(520px, 92vw)"
      :close-on-click-modal="!uploading"
      :close-on-press-escape="!uploading"
      :show-close="!uploading"
    >
      <el-upload
        class="wk-manage-drop"
        drag
        accept=".zip,application/zip"
        :auto-upload="false"
        :show-file-list="false"
        :disabled="uploading"
        :on-change="chooseFile"
      >
        <el-icon class="wk-manage-drop-icon" aria-hidden="true"><UploadFilled /></el-icon>
        <b v-if="selectedFile">{{ selectedFile.name }}</b>
        <b v-else>把 ZIP 拖到这里，或点击选择</b>
        <small>{{
          selectedFile
            ? `${(selectedFile.size / 1024 / 1024).toFixed(2)} MB · 点击可以换一个文件`
            : "最大 20 MB，根目录要有 manifest.json"
        }}</small>
      </el-upload>
      <el-progress
        v-if="uploading"
        class="wk-manage-progress"
        :percentage="uploadProgress"
        :indeterminate="uploadProgress >= 100"
        :duration="3"
        :show-text="false"
      />
      <p v-if="uploadError" class="wk-note is-danger wk-manage-upload-note" role="alert">{{ uploadError }}</p>
      <p v-else class="wk-note wk-manage-upload-note">
        <template v-if="uploadTarget">
          manifest.json 里的 id 保持 <b>{{ uploadTarget.slug }}</b
          >，version 换成没传过的版本号。
        </template>
        <template v-else>
          上传后先存为草稿，只有你自己能看到。同一个作品以后出新版本，id 不变、version 递增。
        </template>
      </p>
      <template #footer>
        <el-button :disabled="uploading" @click="uploadOpen = false">取消</el-button>
        <el-button type="primary" :loading="uploading" :disabled="!selectedFile" @click="upload">上传</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox, type UploadFile } from "element-plus";
import { ArrowLeft, Box, Upload, UploadFilled } from "@element-plus/icons-vue";
import { workshopApi, type WorkshopVersion, type WorkshopWork } from "@/api/workshop";
import WorkIcon from "./WorkIcon.vue";
import {
  playerPath,
  statusLabels,
  statusTone,
  typeLabels,
  workName,
  workState,
  workshopDate,
  workshopError,
} from "./shared";
import "./workshop.css";

const router = useRouter();
const uploadOpen = ref(false);
const selectedFile = ref<File | null>(null);
const uploadTarget = ref<WorkshopWork | null>(null);
const uploading = ref(false);
const uploadProgress = ref(0);
const uploadError = ref("");
const loading = ref(true);
const error = ref("");
const works = ref<WorkshopWork[]>([]);
const detailErrors = ref<Record<string, string>>({});
const submitBusy = ref(new Set<string>());
const deleteBusy = ref(new Set<string>());
const page = ref(1);
const pageSize = 10;
const total = ref(0);
let requestId = 0;

const versionsOf = (work: WorkshopWork) => work.versions || (work.version ? [work.version] : []);
function canSubmit(work: WorkshopWork, version: WorkshopVersion) {
  return (
    version.status === "DRAFT" ||
    version.status === "REJECTED" ||
    (version.status === "APPROVED" && !work.publishedVersionId)
  );
}
/** 每个版本下一步该做什么，写成一句话。 */
function hint(work: WorkshopWork, version: WorkshopVersion) {
  if (work.disabled) return "";
  if (version.status === "DRAFT") return "还没提交，先预览确认没问题";
  if (version.status === "PENDING") return "等待管理员审核";
  if (version.status === "REJECTED") return "修改后上传新版本，或直接重新提交";
  if (version.id !== work.publishedVersionId && !work.publishedVersionId) return "已下架，可以重新提交";
  return "";
}
function openUpload(work: WorkshopWork | null) {
  uploadTarget.value = work;
  selectedFile.value = null;
  uploadError.value = "";
  uploadProgress.value = 0;
  uploadOpen.value = true;
}
function chooseFile(file: UploadFile) {
  if (!file.raw) return;
  if (!file.name.toLowerCase().endsWith(".zip")) {
    uploadError.value = "请选择 ZIP 作品包";
    return;
  }
  if (file.raw.size > 20 * 1024 * 1024) {
    uploadError.value = "作品包不能超过 20 MB";
    return;
  }
  selectedFile.value = file.raw;
  uploadError.value = "";
}
async function upload() {
  if (!selectedFile.value || uploading.value) return;
  uploading.value = true;
  uploadProgress.value = 0;
  uploadError.value = "";
  try {
    const result = await workshopApi.upload(
      selectedFile.value,
      {
        onUploadProgress: (event) => {
          if (event.total)
            uploadProgress.value = Math.min(100, Math.round((event.loaded / event.total) * 100));
        },
      },
      uploadTarget.value?.id,
    );
    uploadOpen.value = false;
    ElMessage.success(`v${result.version.version} 已存为草稿，预览没问题就可以提交审核`);
    page.value = 1;
    await load();
  } catch (e) {
    uploadError.value = workshopError(e, "上传失败，请检查作品包后重试");
  } finally {
    uploading.value = false;
  }
}
async function loadVersions(work: WorkshopWork) {
  delete detailErrors.value[work.id];
  try {
    Object.assign(work, await workshopApi.detail(work.id));
  } catch (e) {
    detailErrors.value[work.id] = workshopError(e, "版本列表加载失败");
  }
}
async function load() {
  const id = ++requestId;
  loading.value = true;
  error.value = "";
  detailErrors.value = {};
  try {
    const data = await workshopApi.mine({ page: page.value, pageSize });
    if (id !== requestId) return;
    await Promise.all(data.items.map(loadVersions));
    if (id !== requestId) return;
    works.value = data.items;
    total.value = data.pagination.total;
  } catch (e) {
    if (id === requestId) error.value = workshopError(e, "我的作品加载失败");
  } finally {
    if (id === requestId) loading.value = false;
  }
}
async function submit(version: WorkshopVersion) {
  if (submitBusy.value.has(version.id)) return;
  try {
    await ElMessageBox.confirm(
      `提交 v${version.version} 审核？通过后这个版本会公开，并替换当前公开的版本。`,
      "提交审核",
      { confirmButtonText: "提交", cancelButtonText: "取消", type: "info" },
    );
  } catch {
    return;
  }
  submitBusy.value.add(version.id);
  try {
    await workshopApi.submit(version.id);
    ElMessage.success("已提交，等待管理员审核");
    await load();
  } catch (e) {
    ElMessage.error(workshopError(e));
  } finally {
    submitBusy.value.delete(version.id);
  }
}
async function removeVersion(work: WorkshopWork, version: WorkshopVersion) {
  if (deleteBusy.value.has(version.id)) return;
  const last = versionsOf(work).length === 1;
  try {
    await ElMessageBox.confirm(
      last
        ? `删除 v${version.version}？这是「${workName(work)}」唯一的版本，文件删除后不能恢复。`
        : `删除 v${version.version}？文件删除后不能恢复。`,
      "删除版本",
      { confirmButtonText: "删除", cancelButtonText: "取消", type: "warning" },
    );
  } catch {
    return;
  }
  deleteBusy.value.add(version.id);
  try {
    const result = await workshopApi.deleteVersion(version.id);
    ElMessage.success(result.workDeleted ? "作品已删除" : `v${version.version} 已删除`);
    await load();
  } catch (e) {
    ElMessage.error(workshopError(e));
  } finally {
    deleteBusy.value.delete(version.id);
  }
}
onMounted(load);
</script>

<style scoped>
.wk-manage-work {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 12px;
  padding: 14px 16px;
}
.wk-manage-copy { min-width: 0; flex: 1 1 140px; }
.wk-manage-copy h2 {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
}
.wk-manage-copy h2 a { color: inherit; text-decoration: none; overflow-wrap: anywhere; }
.wk-manage-note { margin: 0 16px 12px; }
.wk-manage-versions { border-top: 1px solid var(--cpu-border-soft); background: var(--cpu-surface-soft); }
.wk-manage-reason { margin-top: 6px; }

.wk-manage-drop :deep(.el-upload),
.wk-manage-drop :deep(.el-upload-dragger) { width: 100%; }
.wk-manage-drop :deep(.el-upload-dragger) {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 28px 16px;
}
.wk-manage-drop-icon { color: var(--cpu-text-muted); font-size: 32px; }
.wk-manage-drop b { font-size: var(--cpu-fs-m); font-weight: 600; overflow-wrap: anywhere; }
.wk-manage-drop small { color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); }
.wk-manage-progress { margin-top: 12px; }
.wk-manage-upload-note { margin-top: 12px; }
@media (max-width: 600px) {
  .wk-manage-work { padding: 12px 14px; }
  .wk-manage-note { margin: 0 14px 12px; }
}
</style>
