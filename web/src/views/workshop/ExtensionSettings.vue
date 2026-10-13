<template>
  <section class="pk-card">
    <h2 class="pk-h2">站点扩展设置</h2>
    <p class="pk-muted">
      审核公开后仍需单独启用。开屏最多 15 秒，小工具最多 120
      秒；更换公开版本不会自动更新这里的绑定。
    </p>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <div v-for="slot in slots" :key="slot" class="ws-version">
      <div class="ws-version-copy">
        <b>{{ slot === "splash" ? "公开页面开屏" : "主动打开的小工具" }}</b>
        <p>
          {{ binding(slot)?.version.name || "未启用"
          }}<span v-if="binding(slot)">
            · v{{ binding(slot)?.version.version
            }}{{ binding(slot)?.active === false ? " · 当前不可用" : "" }}</span
          >
        </p>
        <p v-if="binding(slot)" class="pk-muted">
          申请权限：{{
            permissionText(binding(slot)!.version.manifest.permissions)
          }}
        </p>
        <el-select
          v-model="selected[slot]"
          placeholder="选择已公开的扩展版本"
          clearable
          style="width: min(420px, 100%)"
          ><el-option
            v-for="work in candidates(slot)"
            :key="work.id"
            :label="`${work.version!.name} · v${work.version!.version}`"
            :value="work.version!.id"
        /></el-select>
      </div>
      <div class="ws-actions">
        <el-button
          :loading="busy === slot"
          :disabled="!selected[slot]"
          @click="save(slot, selected[slot])"
          >启用所选版本</el-button
        ><el-button
          :disabled="!binding(slot)"
          :loading="busy === slot"
          @click="save(slot, null)"
          >关闭位置</el-button
        >
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
        ? "确认在主站启用所选公开版本？请核对内容和申请权限。"
        : "确认关闭此位置？",
      "站点扩展设置",
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
