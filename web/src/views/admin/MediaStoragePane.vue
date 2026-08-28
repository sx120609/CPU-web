<template>
  <div class="media-storage-pane">
    <el-alert type="info" :closable="false" show-icon class="info-banner">
      <template #title>
        仅管理员可见
      </template>
      <div class="banner-copy">
        这里统一管理腾讯云 COS、世纪互联 OneDrive / SharePoint 与本地媒体，并查看当前站点通过 <code>/uploads</code> 管理的文件清单。
      </div>
    </el-alert>

    <section class="settings-card" :class="{ 'is-config-disabled': Boolean(configLoadError) }" v-loading="loadingConfig">
      <div class="section-head">
        <div>
          <h3 class="section-title">媒体存储配置</h3>
          <p class="section-desc">图片和视频可分别选择后端；腾讯云 COS 适合站内图片与视频，世纪互联继续保留给网盘与文件收集。</p>
        </div>
        <div class="summary-row">
          <el-tag :type="mediaStorageImageProvider === 'local' ? 'info' : 'success'" round>
            图片：{{ backendLabel(mediaStorageImageProvider) }}
          </el-tag>
          <el-tag :type="mediaStorageVideoProvider === 'local' ? 'info' : 'success'" round>
            视频：{{ backendLabel(mediaStorageVideoProvider) }}
          </el-tag>
        </div>
      </div>
      <el-alert
        v-if="configLoadError"
        type="error"
        :closable="false"
        show-icon
        class="pane-alert"
        :title="configLoadError"
      >
        <template #default>
          <el-button size="small" :loading="loadingConfig" @click="reloadConfig">重试配置</el-button>
        </template>
      </el-alert>

      <div class="storage-layout">
        <div class="storage-copy">
          <div class="summary-row">
            <span class="summary-pill">{{ oneDriveChinaClientSecretConfigured ? "已保存密钥" : "未保存密钥" }}</span>
            <span class="summary-pill">{{ oneDriveChinaRefreshTokenConfigured ? "已完成授权" : "未授权" }}</span>
            <span class="summary-pill" v-if="oneDriveChinaDriveName">文档库：{{ oneDriveChinaDriveName }}</span>
            <span class="summary-pill" v-if="oneDriveChinaAuthorizedAt">授权时间：{{ formatTime(oneDriveChinaAuthorizedAt) }}</span>
          </div>

          <div class="storage-meta">
            <div><b>回调地址：</b><code>{{ oneDriveCallbackUrl }}</code></div>
            <div v-if="oneDriveChinaSharepointHost"><b>已解析站点：</b>{{ oneDriveChinaSharepointHost }}{{ oneDriveChinaSharepointPath }}</div>
            <div v-if="oneDriveChinaSiteName"><b>站点名称：</b>{{ oneDriveChinaSiteName }}</div>
            <div v-if="oneDriveChinaLastError" class="storage-error"><b>最近错误：</b>{{ oneDriveChinaLastError }}</div>
            <div class="storage-hint">“网站域名”仍在功能开关页维护；未设置时，这里的回调地址会回退到当前访问域名。</div>
          </div>
        </div>

        <div class="storage-form">
          <div class="storage-grid">
            <div class="storage-field">
              <span class="field-label">图片后端</span>
              <el-select v-model="mediaStorageImageProvider">
                <el-option label="本地磁盘" value="local" />
                <el-option label="世纪互联 OneDrive / SharePoint" value="onedrive-cn" />
                <el-option label="腾讯云 COS" value="cos" />
              </el-select>
            </div>
            <div class="storage-field">
              <span class="field-label">视频后端</span>
              <el-select v-model="mediaStorageVideoProvider">
                <el-option label="本地磁盘" value="local" />
                <el-option label="世纪互联 OneDrive / SharePoint" value="onedrive-cn" />
                <el-option label="腾讯云 COS" value="cos" />
              </el-select>
            </div>
            <div class="storage-field">
              <span class="field-label">远端前缀</span>
              <el-input v-model="mediaStorageRemotePrefixesInput" placeholder="*" />
              <span class="storage-hint">使用 <code>*</code> 可接管头像、论坛、AI 生成图等全部受管媒体。</span>
            </div>
            <div class="storage-field">
              <span class="field-label">Azure 应用 ID</span>
              <el-input v-model="oneDriveChinaClientId" maxlength="120" placeholder="Application (client) ID" />
            </div>
            <div class="storage-field">
              <span class="field-label">Azure 应用密钥</span>
              <el-input
                v-model="oneDriveChinaClientSecretInput"
                maxlength="240"
                show-password
                :placeholder="oneDriveChinaClientSecretConfigured ? '留空表示继续使用已保存密钥' : 'Client Secret'"
              />
            </div>
            <div class="storage-field storage-field-wide">
              <span class="field-label">SharePoint 地址</span>
              <el-input v-model="oneDriveChinaSharepointUrl" maxlength="500" placeholder="https://tenant.sharepoint.cn/sites/media" />
            </div>
            <div class="storage-field">
              <span class="field-label">远端根目录</span>
              <el-input v-model="oneDriveChinaRootPath" maxlength="240" placeholder="cpu-web-media" />
            </div>
          </div>

          <div class="storage-actions">
            <el-button type="primary" :loading="savingMediaStorage" :disabled="savingMediaStorage || Boolean(configLoadError)" @click="saveMediaStorageConfig">保存媒体存储配置</el-button>
            <el-button :loading="validatingOneDriveChinaClient" :disabled="validatingOneDriveChinaClient || Boolean(configLoadError)" @click="validateOneDriveChinaClient">校验密钥</el-button>
            <el-button :loading="authorizingOneDriveChina" :disabled="authorizingOneDriveChina || Boolean(configLoadError)" @click="startOneDriveChinaAuth">登录授权</el-button>
            <el-button :disabled="!oneDriveChinaRefreshTokenConfigured || loadingOneDriveChinaDrives || Boolean(configLoadError)" :loading="loadingOneDriveChinaDrives" @click="loadOneDriveChinaDrives">刷新文档库</el-button>
            <el-button :disabled="!oneDriveChinaRefreshTokenConfigured || clearingOneDriveChinaAuth || Boolean(configLoadError)" :loading="clearingOneDriveChinaAuth" @click="clearOneDriveChinaAuth">清除授权</el-button>
          </div>

          <div v-if="oneDriveChinaDriveOptions.length" class="storage-drive-box">
            <div class="storage-drive-row">
              <el-select v-model="oneDriveChinaDriveId" class="drive-select" placeholder="选择要写入的 SharePoint 文档库">
                <el-option v-for="item in oneDriveChinaDriveOptions" :key="item.id" :label="item.name" :value="item.id" />
              </el-select>
              <el-button type="primary" plain :loading="savingOneDriveChinaDrive" :disabled="savingOneDriveChinaDrive || Boolean(configLoadError)" @click="saveOneDriveChinaDriveSelection">保存文档库</el-button>
            </div>
            <div class="section-desc drive-desc">
              当前站点：{{ oneDriveChinaSiteName || "未解析" }}。如果粘贴的是文档库或列表页面 URL，系统会自动向上回退成可用站点路径。
            </div>
          </div>
        </div>
      </div>

      <div class="cos-config-card">
        <div class="section-head compact-head">
          <div>
            <h4 class="card-title">腾讯云 COS</h4>
            <p class="section-desc">当前桶保持私有读写；站点通过签名地址访问，浏览器上传需要为本站配置 PUT 跨域。</p>
          </div>
          <span class="summary-pill">{{ tencentCosSecretKeyConfigured ? "已保存密钥" : "未保存密钥" }}</span>
        </div>
        <div class="storage-grid">
          <div class="storage-field">
            <span class="field-label">SecretId</span>
            <el-input v-model="tencentCosSecretId" maxlength="160" placeholder="AKID..." />
          </div>
          <div class="storage-field">
            <span class="field-label">SecretKey</span>
            <el-input v-model="tencentCosSecretKeyInput" maxlength="240" show-password :placeholder="tencentCosSecretKeyConfigured ? '留空表示继续使用已保存密钥' : 'SecretKey'" />
          </div>
          <div class="storage-field">
            <span class="field-label">存储桶</span>
            <el-input v-model="tencentCosBucket" maxlength="100" placeholder="cputime-1462084442" />
          </div>
          <div class="storage-field">
            <span class="field-label">地域</span>
            <el-input v-model="tencentCosRegion" maxlength="80" placeholder="ap-shanghai" />
          </div>
          <div class="storage-field">
            <span class="field-label">对象根目录</span>
            <el-input v-model="tencentCosRootPath" maxlength="240" placeholder="cpu-web-media" />
          </div>
          <div class="storage-field">
            <span class="field-label">自定义域名 / CDN（可选）</span>
            <el-input v-model="tencentCosPublicBaseUrl" maxlength="500" placeholder="https://media.cputime.cn" />
          </div>
        </div>
        <div class="storage-actions">
          <el-button type="primary" :loading="savingMediaStorage" :disabled="savingMediaStorage || Boolean(configLoadError)" @click="saveMediaStorageConfig">保存 COS 配置</el-button>
          <el-button :loading="validatingTencentCos" :disabled="validatingTencentCos || Boolean(configLoadError)" @click="validateTencentCos">连接测试</el-button>
        </div>
      </div>
    </section>

    <section class="settings-card" v-loading="loadingInventory">
      <div class="section-head">
        <div>
          <h3 class="section-title">站点文件总览</h3>
          <p class="section-desc">展示当前由 <code>/uploads</code> 管理的文件，并分别标出本地、缓存、世纪互联与腾讯云 COS 副本。</p>
        </div>
        <div class="inventory-actions">
          <el-button :loading="loadingInventory" :disabled="loadingInventory" @click="reloadInventory">刷新列表</el-button>
          <el-button
            type="primary"
            :disabled="migrationDisabled"
            :loading="migratingFiles"
            @click="migrateLocalFiles"
          >
            按当前后端同步文件
          </el-button>
          <el-button
            type="danger"
            plain
            :disabled="cleanupDisabled"
            :loading="cleaningLocalFiles"
            @click="cleanupLocalFiles"
          >
            清理已迁移的本地/缓存副本
          </el-button>
        </div>
      </div>
      <el-alert
        v-if="inventoryLoadError"
        type="error"
        :closable="false"
        show-icon
        class="inventory-alert"
        :title="inventoryLoadError"
      >
        <template #default>
          <el-button size="small" :loading="loadingInventory" @click="reloadInventory">重试列表</el-button>
        </template>
      </el-alert>

      <div v-if="inventory" class="summary-row inventory-summary">
        <span class="summary-pill">图片后端 {{ backendLabel(inventory.mediaStorageImageProvider) }}</span>
        <span class="summary-pill">视频后端 {{ backendLabel(inventory.mediaStorageVideoProvider) }}</span>
        <span class="summary-pill">总文件 {{ inventory.summary.total }}</span>
        <span class="summary-pill">本地 {{ inventory.summary.localCount }}</span>
        <span class="summary-pill">缓存 {{ inventory.summary.cacheCount }}</span>
        <span class="summary-pill">远端 {{ inventory.summary.remoteCount }}</span>
        <span class="summary-pill">COS {{ inventory.summary.cosCount }}</span>
        <span class="summary-pill">世纪互联 {{ inventory.summary.oneDriveCount }}</span>
        <span class="summary-pill" v-if="inventory.summary.legacyAvatarCount">待转存头像 {{ inventory.summary.legacyAvatarCount }}</span>
        <span class="summary-pill">待同步 {{ inventory.summary.eligibleMigrationCount }}</span>
        <span class="summary-pill">已在当前后端 {{ inventory.summary.migratedCount }}</span>
        <span class="summary-pill" v-if="inventory.summary.outOfScopeLocalCount">前缀外本地 {{ inventory.summary.outOfScopeLocalCount }}</span>
      </div>

      <el-alert
        v-if="inventory && !inventory.remoteConfigured"
        type="warning"
        :closable="false"
        show-icon
        class="inventory-alert"
        title="远端存储尚未就绪，当前文件总览仍可查看本地与缓存状态；请先保存并校验所选后端。"
      />
      <el-alert
        v-else-if="inventory && inventory.remoteError"
        type="error"
        :closable="false"
        show-icon
        class="inventory-alert"
        :title="inventory.remoteError"
      />
      <el-alert
        v-if="inventory && inventory.summary.outOfScopeLocalCount"
        type="info"
        :closable="false"
        show-icon
        class="inventory-alert"
        title="有一部分当前应走远端的本地文件不在远端前缀内，这些文件不会参与迁移，否则会影响原路径访问。"
      />
      <el-alert
        v-if="migrationProgressText"
        type="info"
        :closable="false"
        show-icon
        class="inventory-alert"
        :title="migrationProgressText"
      />

      <div class="filters">
        <el-input v-model="fileQuery" clearable placeholder="搜索路径 / 文件名" class="filter-search" />
        <el-select v-model="fileFilter" class="filter-state">
          <el-option label="全部状态" value="all" />
          <el-option label="待同步" value="eligible" />
          <el-option label="已在当前后端" value="migrated" />
          <el-option label="本地 + 远端并存" value="synced" />
          <el-option label="仅本地" value="local-only" />
          <el-option label="仅远端" value="remote-only" />
          <el-option label="仅缓存" value="cache-only" />
          <el-option label="前缀外本地" value="out-of-scope" />
        </el-select>
      </div>

      <div v-if="lastMigrationResult" class="migration-result">
          <div class="migration-head">
            <div class="card-title">最近一次同步结果</div>
            <div class="section-desc">
            已同步到当前后端 {{ lastMigrationResult.migrated }} / {{ lastMigrationResult.eligible }}，失败 {{ lastMigrationResult.failed }}。
            </div>
          </div>
        <div v-if="failedMigrationItems.length" class="migration-errors">
          <div v-for="item in failedMigrationItems" :key="item.relativePath" class="migration-error-row">
            <code>{{ item.relativePath }}</code>
            <span>{{ item.message }}</span>
          </div>
        </div>
      </div>

      <div v-if="lastCleanupResult" class="migration-result">
          <div class="migration-head">
            <div class="card-title">最近一次本地清理结果</div>
            <div class="section-desc">
            已删除旧副本 {{ lastCleanupResult.removed }} / {{ lastCleanupResult.eligible }}，失败 {{ lastCleanupResult.failed }}。
            </div>
          </div>
        <div v-if="failedCleanupItems.length" class="migration-errors">
          <div v-for="item in failedCleanupItems" :key="item.relativePath" class="migration-error-row">
            <code>{{ item.relativePath }}</code>
            <span>{{ item.message }}</span>
          </div>
        </div>
      </div>

      <div v-if="filteredFiles.length" class="inventory-table-scroll">
        <el-table
          :data="paginatedFiles"
          stripe
          size="default"
          class="inventory-table"
          max-height="620"
        >
          <el-table-column label="文件" min-width="280">
            <template #default="{ row }">
              <div class="file-main">
                <div class="file-path">{{ row.relativePath }}</div>
                <a class="file-link" :href="row.url" target="_blank" rel="noopener noreferrer">{{ row.url }}</a>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="类型 / 目标后端" width="180">
            <template #default="{ row }">
              <div class="time-stack">
                <span>{{ row.mediaKind === "image" ? "图片" : row.mediaKind === "video" ? "视频" : "未知" }}</span>
                <span>当前应走{{ backendLabel(row.configuredBackend) }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="170">
            <template #default="{ row }">
              <el-tag :type="resolveState(row).type" round>{{ resolveState(row).label }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="位置" min-width="220">
            <template #default="{ row }">
              <div class="location-tags">
                <el-tag size="small" :type="row.localExists ? 'success' : 'info'">本地{{ row.localExists ? ` ${formatBytes(row.localSizeBytes)}` : " -" }}</el-tag>
                <el-tag size="small" :type="row.cacheExists ? 'warning' : 'info'">缓存{{ row.cacheExists ? ` ${formatBytes(row.cacheSizeBytes)}` : " -" }}</el-tag>
                <el-tag size="small" :type="row.oneDriveExists ? 'primary' : 'info'">世纪互联{{ row.oneDriveExists ? ` ${formatBytes(row.oneDriveSizeBytes)}` : " -" }}</el-tag>
                <el-tag size="small" :type="row.cosExists ? 'success' : 'info'">COS{{ row.cosExists ? ` ${formatBytes(row.cosSizeBytes)}` : " -" }}</el-tag>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="最近更新" min-width="160">
            <template #default="{ row }">
              <div class="time-stack">
                <span v-if="row.localUpdatedAt">本地：{{ formatTime(row.localUpdatedAt) }}</span>
                <span v-else-if="row.cacheUpdatedAt">缓存：{{ formatTime(row.cacheUpdatedAt) }}</span>
                <span v-else-if="row.remoteUpdatedAt">远端：{{ formatTime(row.remoteUpdatedAt) }}</span>
                <span v-else>-</span>
              </div>
            </template>
          </el-table-column>
        </el-table>
        <el-pagination
          v-model:current-page="filePage"
          v-model:page-size="filePageSize"
          class="inventory-pagination"
          layout="total, sizes, prev, pager, next, jumper"
          :page-sizes="[25, 50, 100, 200]"
          :total="filteredFiles.length"
        />
      </div>
      <el-empty v-else description="当前筛选条件下没有文件" />
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  adminApi,
  type MediaStorageAdminFileEntry,
  type MediaStorageAdminInventory,
  type MediaStorageCleanupResult,
  type MediaStorageConfig,
  type MediaStorageBackend,
  type MediaStorageMigrationResult,
  type OneDriveChinaDriveOption,
} from "@/api/admin";

type FileFilterKey =
  | "all"
  | "eligible"
  | "migrated"
  | "synced"
  | "local-only"
  | "remote-only"
  | "cache-only"
  | "out-of-scope";

const route = useRoute();
const router = useRouter();

const loadingConfig = ref(false);
const loadingInventory = ref(false);
const savingMediaStorage = ref(false);
const authorizingOneDriveChina = ref(false);
const validatingOneDriveChinaClient = ref(false);
const validatingTencentCos = ref(false);
const loadingOneDriveChinaDrives = ref(false);
const savingOneDriveChinaDrive = ref(false);
const clearingOneDriveChinaAuth = ref(false);
const migratingFiles = ref(false);
const cleaningLocalFiles = ref(false);
const configLoadError = ref("");
const inventoryLoadError = ref("");
let configLoadSeq = 0;
let inventoryLoadSeq = 0;

const siteOrigin = ref("");
const mediaStorageProvider = ref<MediaStorageBackend>("local");
const mediaStorageImageProvider = ref<MediaStorageBackend>("local");
const mediaStorageVideoProvider = ref<MediaStorageBackend>("local");
const mediaStorageRemotePrefixesInput = ref("forum");
const oneDriveChinaClientId = ref("");
const oneDriveChinaClientSecretInput = ref("");
const oneDriveChinaClientSecretConfigured = ref(false);
const oneDriveChinaSharepointUrl = ref("");
const oneDriveChinaSharepointHost = ref("");
const oneDriveChinaSharepointPath = ref("/");
const oneDriveChinaSiteId = ref("");
const oneDriveChinaSiteName = ref("");
const oneDriveChinaDriveId = ref("");
const oneDriveChinaDriveName = ref("");
const oneDriveChinaRootPath = ref("");
const oneDriveChinaRefreshTokenConfigured = ref(false);
const oneDriveChinaAuthorizedAt = ref("");
const oneDriveChinaLastError = ref("");
const oneDriveChinaDriveOptions = ref<OneDriveChinaDriveOption[]>([]);
const tencentCosSecretId = ref("");
const tencentCosSecretKeyInput = ref("");
const tencentCosSecretKeyConfigured = ref(false);
const tencentCosBucket = ref("");
const tencentCosRegion = ref("");
const tencentCosRootPath = ref("");
const tencentCosPublicBaseUrl = ref("");

const inventory = ref<MediaStorageAdminInventory | null>(null);
const lastMigrationResult = ref<MediaStorageMigrationResult | null>(null);
const lastCleanupResult = ref<MediaStorageCleanupResult | null>(null);
const fileQuery = ref("");
const fileFilter = ref<FileFilterKey>("all");
const filePage = ref(1);
const filePageSize = ref(50);
const migrationProgressText = ref("");
const migrationBatchLimit = 100;

const oneDriveCallbackUrl = computed(() => `${(siteOrigin.value || window.location.origin).replace(/\/+$/, "")}/api/storage/onedrive-cn/callback`);
const migrationCandidates = computed(() => (inventory.value?.list ?? []).filter((row) => needsMigration(row)));
const migrationEligibleCount = computed(() => inventory.value?.summary.eligibleMigrationCount ?? 0);
const migrationNeedsOneDrive = computed(() => (
  migrationCandidates.value.some((row) => (
    row.configuredBackend === "onedrive-cn"
    || (!row.localExists && !row.cacheExists && row.oneDriveExists)
  ))
  || Boolean(inventory.value?.summary.legacyAvatarCount && mediaStorageImageProvider.value === "onedrive-cn")
));
const migrationNeedsCos = computed(() => (
  migrationCandidates.value.some((row) => (
    row.configuredBackend === "cos"
    || (!row.localExists && !row.cacheExists && row.cosExists)
  ))
  || Boolean(inventory.value?.summary.legacyAvatarCount && mediaStorageImageProvider.value === "cos")
));
const migrationDisabled = computed(() =>
  migratingFiles.value
  || !migrationEligibleCount.value
  || (migrationNeedsOneDrive.value && (
    (!oneDriveChinaRefreshTokenConfigured.value || !oneDriveChinaDriveId.value)
    && (!inventory.value?.oneDriveConfigured || !inventory.value?.oneDriveReachable)
  ))
  || (migrationNeedsCos.value && !tencentCosSecretKeyConfigured.value)
);
const cleanupCandidates = computed(() => (inventory.value?.list ?? []).filter((row) => hasRedundantCopies(row)));
const cleanupNeedsOneDrive = computed(() => cleanupCandidates.value.some((row) => row.oneDriveExists));
const cleanupNeedsCos = computed(() => cleanupCandidates.value.some((row) => row.cosExists));
const cleanupEligibleCount = computed(() => cleanupCandidates.value.length);
const cleanupDisabled = computed(() =>
  cleaningLocalFiles.value
  || !cleanupEligibleCount.value
  || (cleanupNeedsOneDrive.value && (!oneDriveChinaRefreshTokenConfigured.value || !oneDriveChinaDriveId.value))
  || (cleanupNeedsCos.value && !tencentCosSecretKeyConfigured.value)
);
const failedMigrationItems = computed(() => (lastMigrationResult.value?.list ?? []).filter((item) => item.status === "failed"));
const failedCleanupItems = computed(() => (lastCleanupResult.value?.list ?? []).filter((item) => item.status === "failed"));
const filteredFiles = computed(() => {
  const source = inventory.value?.list ?? [];
  const query = fileQuery.value.trim().toLowerCase();
  return source.filter((row) => {
    if (query && !`${row.relativePath} ${row.url}`.toLowerCase().includes(query)) return false;
    return matchesFilter(row, fileFilter.value);
  });
});
const paginatedFiles = computed(() => {
  const totalPages = Math.max(1, Math.ceil(filteredFiles.value.length / filePageSize.value));
  const page = Math.min(filePage.value, totalPages);
  const start = (page - 1) * filePageSize.value;
  return filteredFiles.value.slice(start, start + filePageSize.value);
});

watch([fileQuery, fileFilter, filePageSize], () => {
  filePage.value = 1;
});

onMounted(reload);

async function reload() {
  await Promise.all([reloadConfig(), reloadInventory()]);
  await handleStorageAuthQuery();
}

async function reloadConfig() {
  const seq = ++configLoadSeq;
  loadingConfig.value = true;
  configLoadError.value = "";
  try {
    const [config, siteConfig] = await Promise.all([
      adminApi.mediaStorageConfig({ suppressErrorMessage: true }),
      adminApi.siteConfig({ suppressErrorMessage: true }),
    ]);
    if (seq !== configLoadSeq) return;
    applyMediaStorageConfig(config);
    siteOrigin.value = siteConfig.siteOrigin;
  } catch (error) {
    if (seq === configLoadSeq) {
      configLoadError.value = requestMessage(error) || "媒体存储配置加载失败，请稍后重试";
    }
  } finally {
    if (seq === configLoadSeq) loadingConfig.value = false;
  }
}

function applyMediaStorageConfig(config: MediaStorageConfig) {
  mediaStorageProvider.value = config.mediaStorageProvider;
  mediaStorageImageProvider.value = config.mediaStorageImageProvider;
  mediaStorageVideoProvider.value = config.mediaStorageVideoProvider;
  mediaStorageRemotePrefixesInput.value = (config.mediaStorageRemotePrefixes ?? []).join(", ");
  oneDriveChinaClientId.value = config.oneDriveChinaClientId;
  oneDriveChinaClientSecretInput.value = "";
  oneDriveChinaClientSecretConfigured.value = config.oneDriveChinaClientSecretConfigured;
  oneDriveChinaSharepointUrl.value = config.oneDriveChinaSharepointUrl;
  oneDriveChinaSharepointHost.value = config.oneDriveChinaSharepointHost;
  oneDriveChinaSharepointPath.value = config.oneDriveChinaSharepointPath || "/";
  oneDriveChinaSiteId.value = config.oneDriveChinaSiteId;
  oneDriveChinaSiteName.value = config.oneDriveChinaSiteName;
  oneDriveChinaDriveId.value = config.oneDriveChinaDriveId;
  oneDriveChinaDriveName.value = config.oneDriveChinaDriveName;
  oneDriveChinaRootPath.value = config.oneDriveChinaRootPath;
  oneDriveChinaRefreshTokenConfigured.value = config.oneDriveChinaRefreshTokenConfigured;
  oneDriveChinaAuthorizedAt.value = config.oneDriveChinaAuthorizedAt;
  oneDriveChinaLastError.value = config.oneDriveChinaLastError;
  tencentCosSecretId.value = config.tencentCosSecretId;
  tencentCosSecretKeyInput.value = "";
  tencentCosSecretKeyConfigured.value = config.tencentCosSecretKeyConfigured;
  tencentCosBucket.value = config.tencentCosBucket;
  tencentCosRegion.value = config.tencentCosRegion;
  tencentCosRootPath.value = config.tencentCosRootPath;
  tencentCosPublicBaseUrl.value = config.tencentCosPublicBaseUrl;
}

async function persistMediaStorageConfig(silent = false) {
  if (configLoadError.value) {
    ElMessage.warning("请先重新加载媒体存储配置");
    return false;
  }
  savingMediaStorage.value = true;
  try {
    await adminApi.updateMediaStorageConfig({
      mediaStorageImageProvider: mediaStorageImageProvider.value,
      mediaStorageVideoProvider: mediaStorageVideoProvider.value,
      mediaStorageRemotePrefixes: mediaStorageRemotePrefixesInput.value,
      oneDriveChinaClientId: oneDriveChinaClientId.value,
      oneDriveChinaClientSecret: oneDriveChinaClientSecretInput.value || undefined,
      oneDriveChinaSharepointUrl: oneDriveChinaSharepointUrl.value,
      oneDriveChinaRootPath: oneDriveChinaRootPath.value,
      tencentCosSecretId: tencentCosSecretId.value,
      tencentCosSecretKey: tencentCosSecretKeyInput.value || undefined,
      tencentCosBucket: tencentCosBucket.value,
      tencentCosRegion: tencentCosRegion.value,
      tencentCosRootPath: tencentCosRootPath.value,
      tencentCosPublicBaseUrl: tencentCosPublicBaseUrl.value,
    });
    const nextConfig = await adminApi.mediaStorageConfig({ suppressErrorMessage: true });
    applyMediaStorageConfig(nextConfig);
    configLoadError.value = "";
    await reloadInventory();
    if (!silent) ElMessage.success("媒体存储配置已保存");
    return true;
  } finally {
    savingMediaStorage.value = false;
  }
}

async function saveMediaStorageConfig() {
  await persistMediaStorageConfig(false);
}

async function startOneDriveChinaAuth() {
  if (authorizingOneDriveChina.value || configLoadError.value) return;
  authorizingOneDriveChina.value = true;
  try {
    const saved = await persistMediaStorageConfig(true);
    if (!saved) return;
    const result = await adminApi.beginOneDriveChinaAuth();
    window.location.assign(result.authorizeUrl);
  } finally {
    authorizingOneDriveChina.value = false;
  }
}

async function validateOneDriveChinaClient() {
  if (validatingOneDriveChinaClient.value || configLoadError.value) return;
  validatingOneDriveChinaClient.value = true;
  try {
    const saved = await persistMediaStorageConfig(true);
    if (!saved) return;
    const result = await adminApi.validateOneDriveChinaClient();
    ElMessage.success(result.message);
  } finally {
    validatingOneDriveChinaClient.value = false;
  }
}

async function validateTencentCos() {
  if (validatingTencentCos.value || configLoadError.value) return;
  validatingTencentCos.value = true;
  try {
    const saved = await persistMediaStorageConfig(true);
    if (!saved) return;
    const result = await adminApi.validateTencentCos();
    ElMessage.success(result.message);
    await reloadInventory();
  } finally {
    validatingTencentCos.value = false;
  }
}

async function fetchOneDriveChinaDrives(silent = false) {
  if (loadingOneDriveChinaDrives.value || configLoadError.value) return;
  loadingOneDriveChinaDrives.value = true;
  try {
    const result = await adminApi.oneDriveChinaDrives({ suppressErrorMessage: true });
    oneDriveChinaSiteId.value = result.siteId;
    oneDriveChinaSiteName.value = result.siteName;
    oneDriveChinaSharepointUrl.value = result.sharepointUrl;
    oneDriveChinaSharepointHost.value = result.sharepointHost;
    oneDriveChinaSharepointPath.value = result.sharepointPath || "/";
    oneDriveChinaDriveId.value = result.selectedDriveId;
    oneDriveChinaDriveName.value = result.selectedDriveName;
    oneDriveChinaDriveOptions.value = result.list;
    if (!silent) ElMessage.success(result.list.length ? "文档库已刷新" : "当前站点下没有可用文档库");
  } catch (error) {
    if (!silent) ElMessage.error(requestMessage(error) || "文档库刷新失败，请稍后重试");
  } finally {
    loadingOneDriveChinaDrives.value = false;
  }
}

async function loadOneDriveChinaDrives() {
  await fetchOneDriveChinaDrives(false);
}

async function saveOneDriveChinaDriveSelection() {
  if (savingOneDriveChinaDrive.value || configLoadError.value) return;
  if (!oneDriveChinaDriveId.value) {
    ElMessage.warning("请先选择文档库");
    return;
  }
  savingOneDriveChinaDrive.value = true;
  try {
    const result = await adminApi.saveOneDriveChinaDrive(oneDriveChinaDriveId.value);
    oneDriveChinaDriveName.value = result.driveName;
    await reloadInventory();
    ElMessage.success("文档库选择已保存");
  } finally {
    savingOneDriveChinaDrive.value = false;
  }
}

async function clearOneDriveChinaAuth() {
  if (clearingOneDriveChinaAuth.value || configLoadError.value) return;
  clearingOneDriveChinaAuth.value = true;
  try {
    await ElMessageBox.confirm(
      "确认清除当前世纪互联 OneDrive / SharePoint 授权吗？已保存的应用 ID、密钥和 SharePoint 地址会保留，但 refresh token 与已解析文档库会被清空。",
      "清除授权",
      { type: "warning", confirmButtonText: "清除", cancelButtonText: "取消" },
    );
  } catch {
    clearingOneDriveChinaAuth.value = false;
    return;
  }
  try {
    await adminApi.clearOneDriveChinaAuthorization();
    oneDriveChinaRefreshTokenConfigured.value = false;
    oneDriveChinaAuthorizedAt.value = "";
    oneDriveChinaDriveId.value = "";
    oneDriveChinaDriveName.value = "";
    oneDriveChinaSiteId.value = "";
    oneDriveChinaSiteName.value = "";
    oneDriveChinaDriveOptions.value = [];
    await reloadInventory();
    ElMessage.success("已清除世纪互联 OneDrive 授权");
  } finally {
    clearingOneDriveChinaAuth.value = false;
  }
}

async function reloadInventory() {
  const seq = ++inventoryLoadSeq;
  loadingInventory.value = true;
  inventoryLoadError.value = "";
  try {
    const nextInventory = await adminApi.mediaStorageFiles({ suppressErrorMessage: true });
    if (seq === inventoryLoadSeq) inventory.value = nextInventory;
  } catch (error) {
    if (seq === inventoryLoadSeq) {
      inventory.value = null;
      inventoryLoadError.value = requestMessage(error) || "站点文件总览加载失败，请稍后重试";
    }
  } finally {
    if (seq === inventoryLoadSeq) loadingInventory.value = false;
  }
}

async function handleStorageAuthQuery() {
  const status = typeof route.query.storageAuth === "string" ? route.query.storageAuth : "";
  const message = typeof route.query.storageAuthMessage === "string" ? route.query.storageAuthMessage : "";
  if (!status) return;
  if (status === "success") {
    ElMessage.success("世纪互联 OneDrive 授权成功");
    const nextConfig = await loadMediaStorageConfigAfterAuth();
    if (nextConfig) applyMediaStorageConfig(nextConfig);
    await fetchOneDriveChinaDrives(true).catch(() => null);
    await reloadInventory();
  } else {
    ElMessage.error(message || "世纪互联 OneDrive 授权失败");
    const nextConfig = await loadMediaStorageConfigAfterAuth();
    if (nextConfig) applyMediaStorageConfig(nextConfig);
    await reloadInventory();
  }
  const nextQuery = { ...route.query } as Record<string, any>;
  delete nextQuery.storageAuth;
  delete nextQuery.storageAuthMessage;
  router.replace({ query: nextQuery }).catch(() => null);
}

async function loadMediaStorageConfigAfterAuth() {
  try {
    const nextConfig = await adminApi.mediaStorageConfig({ suppressErrorMessage: true });
    configLoadError.value = "";
    return nextConfig;
  } catch (error) {
    configLoadError.value = requestMessage(error) || "媒体存储配置加载失败，请稍后重试";
    return null;
  }
}

async function migrateLocalFiles() {
  if (migratingFiles.value) return;
  if (!inventory.value?.summary.eligibleMigrationCount) {
    ElMessage.warning("当前没有需要同步到当前后端的文件");
    return;
  }
  migratingFiles.value = true;
  try {
    await ElMessageBox.confirm(
      `确认按当前配置同步这 ${inventory.value.summary.eligibleMigrationCount} 个文件吗？每个文件都会按目标后端迁移；历史 Base64 头像也会分批转为受管图片。站内访问链接会继续保持 /uploads 路径。`,
      "按当前后端同步文件",
      { type: "warning", confirmButtonText: "开始同步", cancelButtonText: "取消" },
    );
  } catch {
    migratingFiles.value = false;
    return;
  }

  try {
    const totalEligible = inventory.value.summary.eligibleMigrationCount;
    const allItems: MediaStorageMigrationResult["list"] = [];
    const failedPaths = new Set<string>();
    let migrated = 0;
    let failed = 0;
    let processed = 0;
    let remaining = totalEligible;
    let aggregate: MediaStorageMigrationResult | null = null;

    while (remaining > 0) {
      migrationProgressText.value = `正在同步：已处理 ${processed} / ${totalEligible}，本批最多 ${migrationBatchLimit} 个`;
      const result = await adminApi.migrateMediaStorageFiles({
        limit: migrationBatchLimit,
        excludePaths: [...failedPaths],
      });
      if (!result.processed && !result.list.length) {
        remaining = 0;
        aggregate = {
          ...result,
          eligible: totalEligible,
          processed,
          remaining,
          migrated,
          failed,
          list: allItems,
        };
        break;
      }

      for (const item of result.list) {
        allItems.push(item);
        if (item.status === "failed") failedPaths.add(item.relativePath);
      }
      migrated += result.migrated;
      failed += result.failed;
      processed += result.processed;
      remaining = result.remaining;
      aggregate = {
        ...result,
        eligible: totalEligible,
        processed,
        remaining,
        migrated,
        failed,
        list: [...allItems],
      };
      lastMigrationResult.value = aggregate;
      if (result.remaining <= 0) break;
    }

    if (aggregate) lastMigrationResult.value = aggregate;
    await reloadInventory();
    if (failed) {
      ElMessage.warning(`同步完成：成功 ${migrated}，失败 ${failed}`);
    } else {
      ElMessage.success(`同步完成，共处理 ${migrated} 个文件`);
    }
  } finally {
    migrationProgressText.value = "";
    migratingFiles.value = false;
  }
}

async function cleanupLocalFiles() {
  if (cleaningLocalFiles.value) return;
  if (!cleanupEligibleCount.value) {
    ElMessage.warning("当前没有可清理的本地或缓存副本");
    return;
  }
  cleaningLocalFiles.value = true;
  try {
    await ElMessageBox.confirm(
      `确认删除这 ${cleanupEligibleCount.value} 个已完成目标后端落盘文件的旧副本吗？删除后仍会从当前后端读取，后续如需审核会自动回源到临时缓存。`,
      "清理本地副本",
      { type: "warning", confirmButtonText: "开始清理", cancelButtonText: "取消" },
    );
  } catch {
    cleaningLocalFiles.value = false;
    return;
  }

  try {
    const result = await adminApi.cleanupMediaStorageLocalFiles();
    lastCleanupResult.value = result;
    await reloadInventory();
    if (result.failed) {
      ElMessage.warning(`清理完成：成功 ${result.removed}，失败 ${result.failed}`);
    } else {
      ElMessage.success(`清理完成，共删除 ${result.removed} 个本地副本`);
    }
  } finally {
    cleaningLocalFiles.value = false;
  }
}

function matchesFilter(row: MediaStorageAdminFileEntry, filter: FileFilterKey) {
  if (filter === "all") return true;
  const state = resolveState(row).key;
  return state === filter;
}

function needsMigration(row: MediaStorageAdminFileEntry) {
  if (row.configuredBackend === "cos") {
    return row.inRemotePrefix && !row.cosExists && (row.localExists || row.cacheExists || row.oneDriveExists);
  }
  if (row.configuredBackend === "onedrive-cn") {
    return row.inRemotePrefix && !row.oneDriveExists && (row.localExists || row.cacheExists || row.cosExists);
  }
  return !row.localExists && (row.cacheExists || row.oneDriveExists || row.cosExists);
}

function hasRedundantCopies(row: MediaStorageAdminFileEntry) {
  if (row.configuredBackend === "cos") {
    return row.cosExists && (row.localExists || row.cacheExists || row.oneDriveExists);
  }
  if (row.configuredBackend === "onedrive-cn") {
    return row.oneDriveExists && (row.localExists || row.cacheExists || row.cosExists);
  }
  return row.localExists && (row.cacheExists || row.oneDriveExists || row.cosExists);
}

function resolveState(rowInput: unknown) {
  const row = rowInput as MediaStorageAdminFileEntry;
  const currentExists = row.configuredBackend === "cos"
    ? row.cosExists
    : row.configuredBackend === "onedrive-cn"
      ? row.oneDriveExists
      : row.localExists;
  const copyCount = Number(row.localExists) + Number(row.cacheExists) + Number(row.oneDriveExists) + Number(row.cosExists);
  if (currentExists && copyCount > 1) {
    return {
      key: "synced" as const,
      label: "当前后端 + 旧副本",
      type: "warning" as const,
    };
  }
  if (currentExists) {
    return { key: "migrated" as const, label: "已在当前后端", type: "success" as const };
  }
  if (needsMigration(row)) {
    return { key: "eligible" as const, label: "待同步", type: "warning" as const };
  }
  if (row.localExists && !row.inRemotePrefix) {
    if (row.configuredBackend === "local") {
      return { key: "migrated" as const, label: "已在当前后端", type: "success" as const };
    }
    return { key: "out-of-scope" as const, label: "前缀外本地", type: "info" as const };
  }
  if (row.remoteExists && !row.localExists && !row.cacheExists) {
    return {
      key: "remote-only" as const,
      label: row.configuredBackend === "local" ? "历史仅远端" : "仅远端",
      type: "primary" as const,
    };
  }
  if (row.cacheExists && !row.localExists && !row.remoteExists) {
    return { key: "cache-only" as const, label: "仅缓存", type: "info" as const };
  }
  return { key: "local-only" as const, label: "仅本地", type: "info" as const };
}

function requestMessage(error: unknown) {
  if (typeof error !== "object" || error === null) return "";
  const responseMessage = (error as { response?: { data?: { message?: unknown } } }).response?.data?.message;
  if (typeof responseMessage === "string") return responseMessage;
  return error instanceof Error ? error.message : "";
}

function formatBytes(value: number | null) {
  if (!value && value !== 0) return "-";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

function formatTime(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function backendLabel(value: MediaStorageBackend) {
  if (value === "cos") return "腾讯云 COS";
  if (value === "onedrive-cn") return "世纪互联 OneDrive";
  return "本地磁盘";
}
</script>

<style scoped>
.media-storage-pane {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.info-banner :deep(.el-alert__title) {
  font-size: 14px;
}

.banner-copy {
  font-size: 13px;
  line-height: 1.7;
}

.settings-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 18px;
  border: 1px solid #e7edf5;
  border-radius: 16px;
  background: linear-gradient(180deg, #ffffff 0%, #fbfdff 100%);
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.04);
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.section-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: #111827;
}

.section-desc {
  margin: 6px 0 0;
  font-size: 13px;
  line-height: 1.7;
  color: #667085;
}

.storage-layout {
  display: grid;
  grid-template-columns: minmax(280px, 0.9fr) minmax(420px, 1.3fr);
  gap: 18px;
}

.storage-copy {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.summary-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.summary-pill {
  padding: 6px 10px;
  border-radius: 999px;
  background: #eff6ff;
  color: #22539f;
  font-size: 12px;
  font-weight: 600;
}

.storage-meta {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
  color: #475467;
}

.storage-error {
  color: #c2410c;
}

.storage-hint {
  color: #667085;
  line-height: 1.7;
}

.storage-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.cos-config-card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  border: 1px solid #cce8e1;
  border-radius: 14px;
  background: linear-gradient(135deg, #f3fbf9 0%, #ffffff 70%);
}

.compact-head {
  align-items: flex-start;
}

.storage-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.storage-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.storage-field-wide {
  grid-column: 1 / -1;
}

.field-label {
  font-size: 12px;
  color: #667085;
}

.storage-actions,
.inventory-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.storage-drive-box,
.migration-result {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border-radius: 14px;
  background: #fcfdff;
  border: 1px dashed #d7e2f0;
}

.storage-drive-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.drive-select {
  flex: 1;
}

.drive-desc {
  margin: 0;
}

.pane-alert :deep(.el-alert__content),
.inventory-alert :deep(.el-alert__content) {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
}

.settings-card.is-config-disabled .storage-layout {
  pointer-events: none;
  opacity: 0.62;
}

.inventory-alert {
  margin-top: -4px;
}

.inventory-summary {
  margin-top: -2px;
}

.filters {
  display: flex;
  gap: 12px;
  align-items: center;
}

.filter-search {
  flex: 1;
}

.filter-state {
  width: 200px;
}

.migration-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.card-title {
  font-size: 15px;
  font-weight: 700;
  color: #1f2937;
}

.migration-errors {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.migration-error-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
  gap: 12px;
  padding: 10px 12px;
  border-radius: 12px;
  background: #fff7ed;
  color: #9a3412;
  font-size: 13px;
}

.inventory-table-scroll {
  width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.inventory-table-scroll :deep(.inventory-table) {
  min-width: 980px;
}

.inventory-table-scroll :deep(.el-table__cell) {
  vertical-align: top;
}

.inventory-pagination {
  justify-content: flex-end;
  min-width: 720px;
  padding: 18px 8px 4px;
}

.file-main {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.file-path {
  font-weight: 600;
  color: #1f2937;
  word-break: break-all;
}

.file-link {
  color: #2563eb;
  font-size: 12px;
  word-break: break-all;
}

.location-tags,
.time-stack {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

@media (max-width: 1080px) {
  .storage-layout {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .settings-card,
  .storage-drive-box,
  .migration-result {
    padding: 14px;
  }

  .section-head,
  .migration-head,
  .filters,
  .storage-drive-row {
    align-items: stretch;
    flex-direction: column;
  }

  .storage-grid {
    grid-template-columns: 1fr;
  }

  .filter-state,
  .drive-select {
    width: 100%;
  }

  .inventory-actions :deep(.el-button),
  .storage-actions :deep(.el-button) {
    width: 100%;
  }

  .migration-error-row {
    grid-template-columns: 1fr;
  }
}
</style>
