<template>
  <div class="pk-page pk-page--narrow workshop-page">
    <header class="pk-head">
      <router-link class="pk-back" to="/workshop">‹ 创意工坊</router-link>
    </header>
    <div v-if="loading" class="pk-card" role="status">
      <el-skeleton :rows="6" animated />
    </div>
    <div v-else-if="error" class="pk-empty ws-error" role="alert">
      <p>{{ error }}</p>
      <el-button @click="load">重试</el-button>
    </div>
    <template v-else-if="work && version">
      <header class="pk-card">
        <div class="pk-title">
          <span class="pk-tile" aria-hidden="true">{{
            version.type === "game" ? "🎮" : "✦"
          }}</span>
          <div class="pk-title-copy">
            <h1>
              {{ version.name
              }}<em class="pk-badge is-info">{{
                version.type === "game"
                  ? "游戏"
                  : version.type === "extension"
                    ? "站点扩展"
                    : "工具"
              }}</em>
            </h1>
            <p>
              由
              <router-link class="pk-link" :to="`/u/${work.author.id}`">{{
                work.author.nickname
              }}</router-link>
              创作 · v{{ version.version }} ·
              {{ workshopDate(work.updatedAt) }} 更新
            </p>
          </div>
        </div>
        <div class="ws-actions" style="margin-top: 18px">
          <el-button
            v-if="canUse"
            type="primary"
            @click="router.push(`/workshop/${work.id}/run`)"
            >{{
              version.type === "game"
                ? "开始游戏"
                : version.type === "extension"
                  ? "打开扩展"
                  : "打开工具"
            }}</el-button
          >
          <el-button v-if="canManage" @click="router.push('/workshop/mine')"
            >管理作品</el-button
          >
          <el-button v-if="canUse" @click="share">分享</el-button>
          <el-button
            :loading="favoriteBusy"
            :type="work.isFavorited ? 'primary' : 'default'"
            @click="toggleFavorite"
            >{{ work.isFavorited ? "已收藏" : "收藏" }} ·
            {{ work.favoriteCount }}</el-button
          >
          <el-button text @click="openReport">举报</el-button>
        </div>
        <p v-if="!canUse" class="pk-muted">
          {{
            work.disabled
              ? "作品已被停用，暂时无法使用。"
              : "作品尚未公开，作者和管理员可在版本列表中预览。"
          }}
        </p>
      </header>
      <section class="pk-card">
        <h2 class="pk-h2">作品介绍与使用说明</h2>
        <p class="ws-description" style="margin-top: 12px">
          {{ version.description }}
        </p>
      </section>
      <section class="pk-card">
        <h2 class="pk-h2">使用提示</h2>
        <p class="pk-muted">
          申请权限：{{ permissionText(version.manifest.permissions) }}
        </p>
        <p class="pk-muted">
          在浏览器中直接使用，请按照作品内的提示操作。{{
            version.manifest.permissions?.includes("storage")
              ? "此作品可保存你的进度，登录后存档随账号保留。"
              : "此作品没有申请账号存档权限。"
          }}
        </p>
        <p v-if="version.manifest.game" class="pk-muted">
          支持{{ controlsText }}操作 · {{ orientationText }}
        </p>
      </section>
      <section v-if="canManage && work.versions?.length" class="pk-card">
        <div class="pk-card-head">
          <div>
            <h2 class="pk-h2">全部版本</h2>
            <p class="pk-muted">预览仅对作者和管理员开放。</p>
          </div>
        </div>
        <div v-for="item in work.versions" :key="item.id" class="ws-version">
          <div class="ws-version-copy">
            <div class="ws-meta">
              <b>v{{ item.version }}</b
              ><em
                class="pk-badge"
                :class="
                  item.status === 'REJECTED'
                    ? 'is-danger'
                    : item.status === 'APPROVED'
                      ? 'is-open'
                      : 'is-info'
                "
                >{{ statusLabels[item.status] }}</em
              ><span v-if="item.id === work.publishedVersionId"
                >当前公开版本</span
              >
            </div>
            <p v-if="item.reviewReason" class="ws-reason">
              审核意见：{{ item.reviewReason }}
            </p>
          </div>
          <el-button
            :disabled="work.disabled"
            @click="
              router.push({
                path: `/workshop/${work.id}/run`,
                query: { versionId: item.id },
              })
            "
            >私密预览</el-button
          >
        </div>
      </section>
    </template>
    <div v-else class="pk-empty">作品没有可显示的版本</div>
    <el-dialog v-model="reportOpen" title="举报作品" width="min(480px, 92vw)"
      ><p class="pk-muted" style="margin-bottom: 12px">
        请说明作品中存在的问题，管理员将进行核查。
      </p>
      <el-input
        v-model="reportReason"
        type="textarea"
        :rows="4"
        maxlength="1000"
        show-word-limit
        placeholder="填写举报原因"
        aria-label="举报原因"
      /><template #footer
        ><el-button @click="reportOpen = false">取消</el-button
        ><el-button
          type="primary"
          :loading="reportBusy"
          :disabled="!reportReason.trim()"
          @click="sendReport"
          >提交举报</el-button
        ></template
      ></el-dialog
    >
  </div>
</template>
<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { workshopApi, type WorkshopWork } from "@/api/workshop";
import { useAuthStore } from "@/stores/auth";
import {
  permissionText,
  statusLabels,
  workshopDate,
  workshopError,
} from "./shared";
import "./workshop.css";
const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const work = ref<WorkshopWork | null>(null);
const version = computed(
  () =>
    work.value?.versions?.find(
      (item) => item.id === work.value?.publishedVersionId,
    ) ||
    work.value?.version ||
    work.value?.versions?.[0],
);
const canManage = computed(
  () =>
    !!work.value &&
    (auth.user?.id === work.value.author.id || auth.user?.role === "admin"),
);
const canUse = computed(
  () => !!work.value?.publishedVersionId && !work.value.disabled,
);
const loading = ref(true);
const error = ref("");
const favoriteBusy = ref(false);
const reportOpen = ref(false);
const reportReason = ref("");
const reportBusy = ref(false);
const controlsText = computed(
  () =>
    version.value?.manifest.game?.controls
      .map(
        (item) => ({ pointer: "鼠标", keyboard: "键盘", touch: "触屏" })[item],
      )
      .join("、") || "作品内提示的",
);
const orientationText = computed(
  () =>
    ({ portrait: "建议竖屏", landscape: "建议横屏", any: "横竖屏均可" })[
      version.value?.manifest.game?.orientation || "any"
    ],
);
let requestId = 0;
async function share() {
  if (!work.value || !version.value) return;
  const url = new URL(`/workshop/${work.value.id}`, window.location.origin)
    .href;
  try {
    if (navigator.share) {
      await navigator.share({ title: version.value.name, url });
    } else {
      await navigator.clipboard.writeText(url);
      ElMessage.success("作品链接已复制");
    }
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError")) {
      ElMessage.info("请复制浏览器地址分享此作品");
    }
  }
}
async function load() {
  const id = ++requestId;
  loading.value = true;
  error.value = "";
  work.value = null;
  try {
    const data = await workshopApi.detail(String(route.params.id));
    if (id === requestId) work.value = data;
  } catch (e) {
    if (id === requestId)
      error.value = workshopError(e, "作品不存在或暂时无法访问");
  } finally {
    if (id === requestId) loading.value = false;
  }
}
async function requireLogin() {
  if (auth.isLoggedIn) return true;
  await router.push({ name: "login", query: { redirect: route.fullPath } });
  return false;
}
async function toggleFavorite() {
  if (!work.value || favoriteBusy.value || !(await requireLogin())) return;
  const current = work.value;
  favoriteBusy.value = true;
  try {
    if (current.isFavorited) await workshopApi.unfavorite(current.id);
    else await workshopApi.favorite(current.id);
    current.isFavorited = !current.isFavorited;
    current.favoriteCount = Math.max(
      0,
      current.favoriteCount + (current.isFavorited ? 1 : -1),
    );
  } catch (e) {
    ElMessage.error(workshopError(e));
  } finally {
    favoriteBusy.value = false;
  }
}
async function openReport() {
  if (await requireLogin()) {
    reportReason.value = "";
    reportOpen.value = true;
  }
}
async function sendReport() {
  if (!work.value || !reportReason.value.trim() || reportBusy.value) return;
  reportBusy.value = true;
  try {
    await workshopApi.report(work.value.id, reportReason.value.trim());
    reportOpen.value = false;
    ElMessage.success("举报已提交，感谢你的反馈");
  } catch (e) {
    ElMessage.error(workshopError(e));
  } finally {
    reportBusy.value = false;
  }
}
watch(() => route.params.id, load, { immediate: true });
</script>
