<template>
  <div class="pk-page workshop-page">
    <header class="pk-head">
      <router-link class="pk-back" to="/workshop">‹ 创意工坊</router-link>
      <div class="pk-title">
        <span class="pk-tile" aria-hidden="true">✎</span>
        <div class="pk-title-copy">
          <h1>作者中心</h1>
          <p>上传、预览并提交你的作品，审核通过后向大家公开。</p>
        </div>
      </div>
    </header>
    <section class="pk-card pk-card--soft">
      <div class="pk-card-head">
        <div>
          <h2 class="pk-h2">从模板开始创作</h2>
          <p class="pk-muted">
            游戏、工具和站点扩展均有模板与 SDK，完成后打包为 ZIP 即可上传。
          </p>
        </div>
      </div>
      <div class="ws-actions">
        <router-link class="pk-pill" to="/workshop/develop"
          >开发指南</router-link
        ><a class="pk-pill" href="/workshop/game-template.zip" download
          >下载游戏模板</a
        ><a class="pk-pill" href="/workshop/tool-template.zip" download
          >下载工具模板</a
        ><a class="pk-pill" href="/workshop/extension-template.zip" download
          >下载扩展模板</a
        >
      </div>
    </section>
    <section class="pk-card">
      <div class="pk-card-head">
        <div>
          <h2 class="pk-h2">
            {{
              uploadTarget
                ? `为「${uploadTarget.version?.name || uploadTarget.slug}」上传新版本`
                : "上传作品包"
            }}
          </h2>
          <p class="pk-muted">ZIP 上传后保存为草稿。先私密预览，再提交审核。</p>
        </div>
        <el-button v-if="uploadTarget" text @click="uploadTarget = null"
          >改为上传其他作品</el-button
        >
      </div>
      <div class="ws-upload">
        <el-upload
          drag
          accept=".zip,application/zip"
          :auto-upload="false"
          :show-file-list="false"
          :disabled="uploading"
          :on-change="chooseFile"
          ><el-icon :size="32" aria-hidden="true"><UploadFilled /></el-icon>
          <div>拖入 ZIP 文件，或点击选择</div>
          <div class="ws-upload-name">
            {{
              selectedFile
                ? `${selectedFile.name} · ${(selectedFile.size / 1024 / 1024).toFixed(2)} MB`
                : "请选择包含 manifest.json 和网页资源的作品包，最大 20 MB"
            }}
          </div></el-upload
        >
        <el-progress
          v-if="uploading"
          :percentage="uploadProgress"
          :indeterminate="uploadProgress >= 100"
          :duration="3"
        />
        <div class="ws-actions">
          <el-button
            type="primary"
            :loading="uploading"
            :disabled="!selectedFile"
            @click="upload"
            >上传为草稿</el-button
          ><el-button
            v-if="selectedFile && !uploading"
            @click="selectedFile = null"
            >清除文件</el-button
          >
        </div>
        <p class="ws-upload-hint">
          {{
            uploadTarget
              ? `新版本的 manifest.json 中 id 必须保持为 ${uploadTarget.slug}，version 必须使用未上传过的版本号。`
              : "作品包根目录必须有 manifest.json，注明作品名称、介绍、类型、版本号和入口页面。更新同一作品时保持 id 不变，使用新的版本号。"
          }}
          介绍中请写清用途与操作方法。
        </p>
        <div v-if="uploadError" class="ws-reason" role="alert">
          {{ uploadError }}
        </div>
      </div>
    </section>
    <section class="pk-card ws-section-stack">
      <div class="pk-card-head">
        <div>
          <h2 class="pk-h2">我的作品</h2>
          <p class="pk-muted">
            草稿和待审核版本仅对你与管理员可见。发布新版本后替换当前公开版本。
          </p>
        </div>
        <el-button :loading="loading" @click="load">刷新</el-button>
      </div>
      <div v-if="loading" role="status"><el-skeleton :rows="5" animated /></div>
      <div v-else-if="error" class="pk-empty ws-error" role="alert">
        <p>{{ error }}</p>
        <el-button @click="load">重试</el-button>
      </div>
      <div v-else-if="!works.length" class="pk-empty">
        还没有作品，上传 ZIP 开始你的第一次分享
      </div>
      <template v-else>
        <article
          v-for="work in works"
          :key="work.id"
          class="pk-card pk-card--soft"
        >
          <div class="pk-card-head">
            <div>
              <h3 class="ws-name">
                <router-link :to="`/workshop/${work.id}`">{{
                  work.version?.name || work.slug
                }}</router-link>
              </h3>
              <p class="pk-muted">
                {{ work.slug }} · {{ workshopDate(work.updatedAt) }} 更新
                <em v-if="work.disabled" class="pk-badge is-danger">已停用</em
                ><em
                  v-else-if="work.publishedVersionId"
                  class="pk-badge is-open"
                  >已公开</em
                ><em v-else class="pk-badge">未公开</em>
              </p>
            </div>
            <el-button :disabled="uploading" @click="chooseTarget(work)"
              >上传新版本</el-button
            >
          </div>
          <div v-if="detailErrors[work.id]" class="ws-reason" role="alert">
            {{ detailErrors[work.id] }}
            <el-button text @click="loadVersions(work)">重试加载版本</el-button>
          </div>
          <div
            v-for="version in work.versions ||
            (work.version ? [work.version] : [])"
            :key="version.id"
            class="ws-version"
          >
            <div class="ws-version-copy">
              <div class="ws-meta">
                <b>v{{ version.version }}</b
                ><em
                  class="pk-badge"
                  :class="
                    version.status === 'REJECTED'
                      ? 'is-danger'
                      : version.status === 'APPROVED'
                        ? 'is-open'
                        : 'is-info'
                  "
                  >{{ statusLabels[version.status] }}</em
                ><span v-if="version.id === work.publishedVersionId"
                  >当前公开版本</span
                ><span>{{ workshopDate(version.createdAt) }} 上传</span>
              </div>
              <p v-if="version.reviewReason" class="ws-reason">
                审核意见：{{ version.reviewReason }}
              </p>
            </div>
            <div class="ws-actions">
              <el-button
                :disabled="work.disabled"
                @click="preview(work, version)"
                >私密预览</el-button
              ><el-button
                v-if="
                  version.status === 'DRAFT' ||
                  version.status === 'REJECTED' ||
                  (version.status === 'APPROVED' && !work.publishedVersionId)
                "
                type="primary"
                :disabled="work.disabled"
                :loading="submitBusy.has(version.id)"
                @click="submit(version)"
                >{{
                  version.status === "REJECTED" || version.status === "APPROVED"
                    ? "重新提交审核"
                    : "提交审核"
                }}</el-button
              >
            </div>
          </div>
        </article>
        <div v-if="total > pageSize" class="ws-pagination">
          <el-pagination
            v-model:current-page="page"
            :page-size="pageSize"
            :total="total"
            layout="prev, pager, next"
            @current-change="load"
          />
        </div>
      </template>
    </section>
  </div>
</template>
<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox, type UploadFile } from "element-plus";
import { UploadFilled } from "@element-plus/icons-vue";
import {
  workshopApi,
  type WorkshopWork,
  type WorkshopVersion,
} from "@/api/workshop";
import { statusLabels, workshopDate, workshopError } from "./shared";
import "./workshop.css";
const router = useRouter();
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
const page = ref(1);
const pageSize = 10;
const total = ref(0);
let requestId = 0;
function chooseFile(file: UploadFile) {
  if (!file.raw) return;
  if (!file.name.toLowerCase().endsWith(".zip")) {
    ElMessage.error("请选择 ZIP 作品包");
    return;
  }
  if (file.raw.size > 20 * 1024 * 1024) {
    ElMessage.error("作品包不能超过 20 MB");
    return;
  }
  selectedFile.value = file.raw;
  uploadError.value = "";
}
function chooseTarget(work: WorkshopWork) {
  uploadTarget.value = work;
  selectedFile.value = null;
  uploadError.value = "";
  window.scrollTo({ top: 0, behavior: "smooth" });
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
            uploadProgress.value = Math.min(
              100,
              Math.round((event.loaded / event.total) * 100),
            );
        },
      },
      uploadTarget.value?.id,
    );
    ElMessage.success(
      `v${result.version.version} 已保存为草稿，请预览后提交审核`,
    );
    selectedFile.value = null;
    uploadTarget.value = null;
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
    const detail = await workshopApi.detail(work.id);
    Object.assign(work, detail);
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
    works.value = data.items;
    total.value = data.pagination.total;
    await Promise.all(data.items.map(loadVersions));
  } catch (e) {
    if (id === requestId) error.value = workshopError(e, "我的作品加载失败");
  } finally {
    if (id === requestId) loading.value = false;
  }
}
function preview(work: WorkshopWork, version: WorkshopVersion) {
  void router.push({
    path: `/workshop/${work.id}/run`,
    query: { versionId: version.id },
  });
}
async function submit(version: WorkshopVersion) {
  if (submitBusy.value.has(version.id)) return;
  try {
    await ElMessageBox.confirm(
      `确认提交 v${version.version} 审核？通过后将公开此版本。`,
      "提交审核",
      {
        confirmButtonText: "提交",
        cancelButtonText: "取消",
        type: "info",
      },
    );
  } catch {
    return;
  }
  submitBusy.value.add(version.id);
  try {
    await workshopApi.submit(version.id);
    ElMessage.success("已提交审核");
    await load();
  } catch (e) {
    ElMessage.error(workshopError(e));
  } finally {
    submitBusy.value.delete(version.id);
  }
}
onMounted(load);
</script>
