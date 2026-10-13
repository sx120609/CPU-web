<template>
  <section class="wk-group wk-group--flush">
    <div class="wk-group-head">
      <div>
        <h2 class="wk-h2">扩展位置</h2>
        <p class="wk-sub">扩展审核公开后，还要在这里启用才会出现在网站上。开屏最长 15 秒，小工具最长 120 秒；扩展出了新版本不会自动换过来。</p>
      </div>
    </div>
    <p v-if="error" class="wk-note is-danger wk-placement-error" role="alert">{{ error }}</p>
    <div class="wk-rows">
      <div v-for="slot in slots" :key="slot" class="wk-row wk-placement">
        <div class="wk-row-copy">
          <div class="wk-row-title">
            <span>{{ slot === "splash" ? "开屏" : "小工具" }}</span>
            <em class="wk-chip" :class="binding(slot) ? (binding(slot)?.active === false ? 'is-warn' : 'is-ok') : ''">{{
              binding(slot) ? (binding(slot)?.active === false ? "暂不可用" : "已启用") : "未启用"
            }}</em>
          </div>
          <p class="wk-sub">
            {{ slot === "splash" ? "打开公开页面时出现一次" : "页面角落的按钮，点了才打开" }}
          </p>
          <p v-if="binding(slot)" class="wk-meta">
            <span>{{ binding(slot)!.version.name }}</span>
            <span>v{{ binding(slot)!.version.version }}</span>
            <span>权限：{{ permissionText(binding(slot)!.version.manifest.permissions) }}</span>
          </p>
        </div>
        <div class="wk-placement-controls">
          <el-select v-model="selected[slot]" placeholder="选择已公开的扩展" clearable :aria-label="slot === 'splash' ? '开屏使用的扩展' : '小工具使用的扩展'">
            <el-option
              v-for="work in candidates(slot)"
              :key="work.id"
              :label="`${work.version!.name} · v${work.version!.version}`"
              :value="work.version!.id"
            />
          </el-select>
          <el-button
            type="primary"
            :loading="busy === slot"
            :disabled="!selected[slot]"
            @click="save(slot, selected[slot])"
            >启用</el-button
          >
          <el-button :disabled="!binding(slot)" :loading="busy === slot" @click="save(slot, null)">关闭</el-button>
        </div>
      </div>
    </div>
  </section>
</template>
<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  workshopApi,
  type WorkshopPlacement,
  type WorkshopSlot,
  type WorkshopWork,
} from "@/api/workshop";
import { permissionText, workshopError } from "./shared";
const props = defineProps<{ refreshKey?: number }>();
let generation = 0;
let alive = true;
const slots: WorkshopSlot[] = ["splash", "dialog"];
const items = ref<WorkshopPlacement[]>([]),
  works = ref<WorkshopWork[]>([]),
  selected = ref<Record<WorkshopSlot, string>>({ splash: "", dialog: "" }),
  busy = ref<WorkshopSlot | null>(null),
  error = ref("");
const binding = (slot: WorkshopSlot) =>
  items.value.find((p) => p.slot === slot);
const candidates = (slot: WorkshopSlot) =>
  works.value.filter(
    (w) =>
      !w.disabled &&
      w.version?.id === w.publishedVersionId &&
      w.version?.manifest.extension?.slots.includes(slot),
  );
async function load() {
  const seq = ++generation;
  error.value = "";
  try {
    const [placements, first] = await Promise.all([
      workshopApi.adminPlacements(),
      workshopApi.adminWorks({
        type: "extension",
        state: "published",
        pageSize: 12,
      }),
    ]);
    if (seq !== generation) return;
    const collected = [...first.items];
    for (let page = 2; page <= first.pagination.totalPages; page++) {
      const result = await workshopApi.adminWorks({
        type: "extension",
        state: "published",
        page,
        pageSize: 12,
      });
      if (seq !== generation) return;
      collected.push(...result.items);
    }
    const refreshed = await Promise.all(
      collected.map(async (work) => {
        if (!work.publishedVersionId) return work;
        const detail = await workshopApi.detail(work.id);
        return {
          ...detail,
          version:
            detail.versions?.find((v) => v.id === detail.publishedVersionId) ||
            detail.version,
        };
      }),
    );
    if (seq !== generation) return;
    items.value = placements.items;
    works.value = refreshed;
    for (const slot of slots) {
      if (!candidates(slot).some((w) => w.version?.id === selected.value[slot]))
        selected.value[slot] = "";
    }
  } catch (e) {
    if (seq !== generation) return;
    error.value = workshopError(e, "扩展设置加载失败");
  }
}
async function save(slot: WorkshopSlot, versionId: string | null) {
  if (busy.value) return;
  busy.value = slot;
  try {
    await ElMessageBox.confirm(
      versionId
        ? "在网站上启用这个扩展？启用前请核对内容和申请的权限。"
        : "关闭这个位置？",
      "扩展位置",
      { dangerouslyUseHTMLString: false },
    );
  } catch {
    busy.value = null;
    return;
  }
  if (!alive) {
    busy.value = null;
    return;
  }
  try {
    items.value = (await workshopApi.setPlacement(slot, versionId)).items;
    ElMessage.success(versionId ? "扩展已启用" : "位置已关闭");
  } catch (e) {
    ElMessage.error(workshopError(e));
  } finally {
    busy.value = null;
  }
}
watch(() => props.refreshKey, load);
defineExpose({ reload: load, enable: save });
onBeforeUnmount(() => {
  alive = false;
  generation++;
});
onMounted(load);
</script>

<style scoped>
.wk-placement-error { margin: 0 16px 12px; }
.wk-placement-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.wk-placement-controls .el-select { width: 220px; }
.wk-placement-controls .el-button + .el-button { margin-left: 0; }
@media (max-width: 600px) {
  .wk-placement-controls, .wk-placement-controls .el-select { width: 100%; }
}
</style>
