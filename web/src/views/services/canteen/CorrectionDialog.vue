<template>
  <el-dialog
    :model-value="modelValue"
    :title="shop ? `纠错：${shop.name}` : '补充或纠正门店'"
    width="440px"
    class="cd-dialog"
    append-to-body
    @update:model-value="emit('update:modelValue', $event)"
    @open="reset"
  >
    <p v-if="shop" class="cd-where">{{ shop.canteenName }} · {{ shop.floorCode }} {{ shop.floorLabel }} · {{ shop.tags.map(categoryName).join("、") }}</p>
    <div class="cd-chips" role="radiogroup" aria-label="问题类型">
      <button
        v-for="item in kinds"
        :key="item"
        type="button"
        role="radio"
        :aria-checked="kind === item"
        :class="{ 'is-active': kind === item }"
        @click="kind = item"
      >{{ item }}</button>
    </div>

    <template v-if="adding">
      <div class="cd-field">
        <span class="cd-label">在哪</span>
        <div class="cd-floors">
          <div v-for="group in floorGroups" :key="group.canteenName" class="cd-floor-row">
            <span class="cd-canteen">{{ group.canteenName }}</span>
            <div class="cd-chips" role="radiogroup" :aria-label="group.canteenName">
              <button
                v-for="item in group.floors"
                :key="item.code"
                type="button"
                role="radio"
                :aria-checked="floorCode === item.code"
                :class="{ 'is-active': floorCode === item.code }"
                @click="floorCode = item.code"
              >{{ item.label }}</button>
            </div>
          </div>
        </div>
      </div>
      <label class="cd-field">
        <span class="cd-label">店名</span>
        <input v-model="name" class="cd-input" type="text" :maxlength="CANTEEN_SHOP_NAME_MAX" placeholder="招牌上的名字，例如：老王拌面" />
      </label>
      <div class="cd-field">
        <span class="cd-label">卖什么<small>选 1–2 个</small></span>
        <div class="cd-chips" role="group" aria-label="品类">
          <button
            v-for="item in CANTEEN_CATEGORIES"
            :key="item.id"
            type="button"
            :aria-pressed="tags.includes(item.id)"
            :class="{ 'is-active': tags.includes(item.id) }"
            @click="toggleTag(item.id)"
          >{{ item.name }}</button>
        </div>
      </div>
      <textarea v-model="content" class="cd-text" rows="2" maxlength="300" placeholder="补充说明（可不填），例如：在打饭窗口最里面"></textarea>
      <div class="cd-foot">
        <span>提交后由大家投票，超过 5 人认为正确就直接加进门店列表。</span>
      </div>
    </template>
    <template v-else>
      <textarea v-model="content" class="cd-text" rows="4" maxlength="300" :placeholder="placeholder"></textarea>
      <div class="cd-foot">
        <span>提交后由大家投票，超过 5 人认为正确就交给 AI 修改。</span>
        <span>{{ [...content].length }}/300</span>
      </div>
    </template>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="submitting" :disabled="!ready" @click="submit">提交</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { ElMessage } from "element-plus";
import { toolsApi, type CanteenCorrectionKind } from "@/api/tools";
import {
  CANTEEN_CATEGORIES,
  CANTEEN_FLOORS,
  CANTEEN_SHOP_NAME_MAX,
  canteenCategoryName as categoryName,
  type CanteenShop,
} from "@/data/canteenPicker";

const MAX_TAGS = 2;
const props = defineProps<{ modelValue: boolean; shop?: CanteenShop | null; floorCode?: string }>();
const emit = defineEmits<{ (e: "update:modelValue", value: boolean): void; (e: "submitted"): void }>();
const kind = ref<CanteenCorrectionKind | "">("");
const content = ref("");
const floorCode = ref("");
const name = ref("");
const tags = ref<string[]>([]);
const submitting = ref(false);

const kinds = computed<CanteenCorrectionKind[]>(() => props.shop
  ? ["删除门店", "店名不对", "位置不对", "品类不对", "其他"]
  : ["新增门店", "其他"]);
const adding = computed(() => !props.shop && kind.value === "新增门店");

const floorGroups = computed(() => {
  const groups: { canteenName: string; floors: typeof CANTEEN_FLOORS }[] = [];
  for (const item of CANTEEN_FLOORS) {
    const group = groups.find((entry) => entry.canteenName === item.canteenName);
    if (group) group.floors.push(item);
    else groups.push({ canteenName: item.canteenName, floors: [item] });
  }
  return groups;
});

const placeholder = computed(() => ({
  新增门店: "",
  删除门店: "说说情况，例如：已经撤店，档口换成了别的店",
  店名不对: "现在的店名是什么",
  位置不对: "实际在哪个食堂几楼",
  品类不对: "应该算什么品类，例如：主要卖麻辣烫，不是面",
  其他: props.shop ? "具体哪里不对" : "说清楚是哪个食堂几楼的哪家店、哪里不对",
  "": "先选问题类型",
}[kind.value]));

const nameLength = computed(() => [...name.value.trim()].length);
const ready = computed(() => adding.value
  ? Boolean(floorCode.value) && nameLength.value >= 2 && nameLength.value <= CANTEEN_SHOP_NAME_MAX && tags.value.length > 0
  : Boolean(kind.value) && [...content.value.trim()].length >= 2);

function toggleTag(id: string) {
  if (tags.value.includes(id)) tags.value = tags.value.filter((item) => item !== id);
  else tags.value = [...tags.value, id].slice(-MAX_TAGS);
}

function reset() {
  kind.value = props.shop ? "" : "新增门店";
  content.value = "";
  floorCode.value = props.floorCode && CANTEEN_FLOORS.some((item) => item.code === props.floorCode) ? props.floorCode : "";
  name.value = "";
  tags.value = [];
}

async function submit() {
  if (!kind.value || !ready.value) return;
  submitting.value = true;
  try {
    await toolsApi.submitCanteenCorrection(adding.value
      ? { kind: "新增门店", content: content.value.trim(), floorCode: floorCode.value, name: name.value.trim(), tags: tags.value }
      : { shopId: props.shop?.id, kind: kind.value, content: content.value.trim() });
    ElMessage.success("已提交，等大家投票");
    emit("submitted");
    emit("update:modelValue", false);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "提交失败");
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped>
.cd-where { margin: 0 0 10px; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); }
.cd-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.cd-chips button { height: 28px; padding: 0 10px; border: 1px solid var(--cpu-border); border-radius: 999px; background: transparent; color: var(--cpu-text-secondary); cursor: pointer; font: inherit; font-size: var(--cpu-fs-s); }
.cd-chips button.is-active { border-color: var(--cpu-primary); background: var(--cpu-primary); color: var(--cpu-on-primary); }
.cd-field { display: grid; gap: 6px; margin-top: 12px; }
.cd-label { color: var(--cpu-text); font-size: var(--cpu-fs-s); font-weight: 600; }
.cd-label small { margin-left: 6px; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); font-weight: 400; }
.cd-floors { display: grid; gap: 6px; }
.cd-floor-row { display: flex; align-items: center; gap: 8px; }
.cd-canteen { flex-shrink: 0; width: 3.5em; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); }
.cd-input { box-sizing: border-box; width: 100%; height: 32px; padding: 0 10px; border: 1px solid var(--cpu-border); border-radius: var(--cpu-radius-m); background: var(--cpu-surface); color: var(--cpu-text); font: inherit; font-size: var(--cpu-fs-s); }
.cd-text { display: block; box-sizing: border-box; width: 100%; margin-top: 10px; padding: 8px 10px; border: 1px solid var(--cpu-border); border-radius: var(--cpu-radius-m); background: var(--cpu-surface); color: var(--cpu-text); font: inherit; font-size: var(--cpu-fs-s); line-height: 1.6; resize: vertical; }
.cd-input:focus, .cd-text:focus { outline: 2px solid var(--cpu-primary); outline-offset: -1px; }
.cd-foot { display: flex; justify-content: space-between; gap: 10px; margin-top: 6px; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); line-height: 1.5; }
@media (pointer: coarse) {
  .cd-input, .cd-text { font-size: 16px; }
}
</style>
