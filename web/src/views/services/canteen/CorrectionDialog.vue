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
    <div class="cd-kinds" role="radiogroup" aria-label="问题类型">
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
    <textarea v-model="content" class="cd-text" rows="4" maxlength="300" :placeholder="placeholder"></textarea>
    <div class="cd-foot">
      <span>提交后由大家投票，超过 5 人认为正确就交给 AI 修改。</span>
      <span>{{ [...content].length }}/300</span>
    </div>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="submitting" :disabled="!kind || [...content.trim()].length < 2" @click="submit">提交</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { ElMessage } from "element-plus";
import { toolsApi, type CanteenCorrectionKind } from "@/api/tools";
import { canteenCategoryName as categoryName, type CanteenShop } from "@/data/canteenPicker";

const props = defineProps<{ modelValue: boolean; shop?: CanteenShop | null }>();
const emit = defineEmits<{ (e: "update:modelValue", value: boolean): void; (e: "submitted"): void }>();
const kind = ref<CanteenCorrectionKind | "">("");
const content = ref("");
const submitting = ref(false);

const kinds = computed<CanteenCorrectionKind[]>(() => props.shop
  ? ["删除门店", "店名不对", "位置不对", "品类不对", "其他"]
  : ["新增门店", "其他"]);

const placeholder = computed(() => ({
  新增门店: "哪个食堂几楼、店名叫什么、卖什么。例如：二食堂三楼新开了“老王拌面”，卖拌面和凉皮",
  删除门店: "说说情况，例如：已经撤店，档口换成了别的店",
  店名不对: "现在的店名是什么",
  位置不对: "实际在哪个食堂几楼",
  品类不对: "应该算什么品类，例如：主要卖麻辣烫，不是面",
  其他: "具体哪里不对",
  "": "先选问题类型",
}[kind.value]));

function reset() {
  kind.value = props.shop ? "" : "新增门店";
  content.value = "";
}

async function submit() {
  if (!kind.value) return;
  submitting.value = true;
  try {
    await toolsApi.submitCanteenCorrection({ shopId: props.shop?.id, kind: kind.value, content: content.value.trim() });
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
.cd-kinds { display: flex; flex-wrap: wrap; gap: 6px; }
.cd-kinds button { height: 28px; padding: 0 10px; border: 1px solid var(--cpu-border); border-radius: 999px; background: transparent; color: var(--cpu-text-secondary); cursor: pointer; font: inherit; font-size: var(--cpu-fs-s); }
.cd-kinds button.is-active { border-color: var(--cpu-primary); background: var(--cpu-primary); color: var(--cpu-on-primary); }
.cd-text { display: block; box-sizing: border-box; width: 100%; margin-top: 10px; padding: 8px 10px; border: 1px solid var(--cpu-border); border-radius: var(--cpu-radius-m); background: var(--cpu-surface); color: var(--cpu-text); font: inherit; font-size: var(--cpu-fs-s); line-height: 1.6; resize: vertical; }
.cd-text:focus { outline: 2px solid var(--cpu-primary); outline-offset: -1px; }
.cd-foot { display: flex; justify-content: space-between; gap: 10px; margin-top: 6px; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); line-height: 1.5; }
@media (pointer: coarse) {
  .cd-text { font-size: 16px; }
}
</style>
