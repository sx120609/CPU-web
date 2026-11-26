<template>
  <!-- 首次使用个人模式的说明与同意：说清读什么、发给谁、存多久，按用户的选择开启 -->
  <el-dialog
    :model-value="modelValue"
    title="开启个人模式"
    width="min(480px, calc(100vw - 24px))"
    align-center
    append-to-body
    :show-close="false"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    class="sj-agent-dialog"
  >
    <div class="sj-consent-body">
      <p class="sj-consent-lead">
        开启后，拾间AI 会在你提问时，按下面的选择读取你的数据，连同你的昵称一起发给 AI 服务来生成回答。
      </p>

      <p class="sj-group-title">你需要知道</p>
      <ul class="sj-consent-points">
        <li>AI 服务由平台配置的模型服务商提供，可能位于境外，按服务商自己的规则处理请求。</li>
        <li>教务登录凭据、学校密码和验证码不会发给 AI 服务。</li>
        <li>新建日程、发帖、发私信等操作，都要你点确认才会执行。</li>
        <li>对话记录保存在你的账号里，可以随时删除；AI 调用日志保存 180 天。</li>
        <li>以后可以在「个人模式」里随时修改授权或关闭。</li>
      </ul>
      <p class="sj-group-title">读取哪些数据</p>
      <div class="sj-group">
        <div v-for="scope in SCOPE_ITEMS" :key="scope.key" class="sj-row">
          <div class="sj-row-copy">
            <strong :id="`sj-consent-${scope.key}`">{{ scope.title }}</strong>
            <small>{{ scope.hint }}</small>
          </div>
          <el-switch
            v-model="choices[scope.key]"
            :disabled="Boolean(busy)"
            :aria-labelledby="`sj-consent-${scope.key}`"
          />
        </div>
      </div>

      <p class="sj-consent-link">
        完整说明见<a href="/privacy.html#ai" target="_blank" rel="noopener noreferrer">《隐私政策》拾间AI 一节</a>
      </p>
    </div>

    <template #footer>
      <div class="sj-consent-actions">
        <button type="button" class="sj-btn" :disabled="Boolean(busy)" @click="decline">暂不开启</button>
        <button type="button" class="sj-btn sj-btn--primary" :disabled="Boolean(busy)" @click="agree">
          {{ busy === "agree" ? "正在开启…" : "同意并开启" }}
        </button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import {
  searchApi,
  type PersonalAgentConsentChoices,
  type PersonalAgentPermissions,
  type PersonalAgentScopeKey,
} from "@/api/search";

const props = defineProps<{
  modelValue: boolean;
  permissions: PersonalAgentPermissions;
  version: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  /** 用户做了选择：agreed 为真表示同意并开启，permissions 是服务器保存后的授权。 */
  decided: [permissions: PersonalAgentPermissions, agreed: boolean];
}>();

type ChoiceKey = PersonalAgentScopeKey | "memory";

const SCOPE_ITEMS: Array<{ key: ChoiceKey; title: string; hint: string }> = [
  { key: "schedule", title: "课表和日程", hint: "本学期课表、调课和你的日程，用来排时间、查冲突、找空教室" },
  { key: "collab", title: "情侣和宿舍课表", hint: "情侣和室友共享给你的课表，用来找大家都没课的时间" },
  { key: "campusLife", title: "校园生活", hint: "宿舍电费、图书馆借阅、查分单、问卷和文件收集" },
  { key: "community", title: "论坛和课评", hint: "公告热帖、课程评价、失物招领，以及发帖回帖草稿" },
  { key: "academic", title: "成绩和学业", hint: "成绩单、绩点、考试安排、毕业学分和培养方案" },
  { key: "messages", title: "通知和私信", hint: "未读通知和最近私信的摘录" },
  { key: "memory", title: "记住我的情况", hint: "记住校区、年级专业、升学打算和作息，以后的回答会参考" },
];

const choices = reactive<Record<ChoiceKey, boolean>>({
  schedule: true, academic: false, collab: true, campusLife: true, community: true, messages: false, memory: true,
});
const busy = ref<"" | "agree" | "decline">("");

// 每次打开都从当前授权起步（之前自己关掉的仍是关的）
watch(() => props.modelValue, (open) => {
  if (!open) return;
  for (const item of SCOPE_ITEMS) choices[item.key] = Boolean(props.permissions[item.key]);
}, { immediate: true });

const QUIET = { suppressErrorMessage: true } as const;

async function agree() {
  if (busy.value) return;
  busy.value = "agree";
  try {
    const picked: PersonalAgentConsentChoices = { ...choices };
    const res = await searchApi.recordPersonalAgentConsent(props.version, picked, QUIET);
    emit("decided", res.permissions, true);
    emit("update:modelValue", false);
  } catch {
    ElMessage.error("没有开启成功，请稍后再试");
  } finally {
    busy.value = "";
  }
}

async function decline() {
  if (busy.value) return;
  busy.value = "decline";
  try {
    const res = await searchApi.savePersonalAgentPermissions({ enabled: false }, QUIET);
    emit("decided", res.permissions, false);
  } catch {
    // 没存上也按“暂不开启”处理：服务器在用户同意前本来就不读个人数据
    emit("decided", { ...props.permissions, enabled: false }, false);
  } finally {
    busy.value = "";
    emit("update:modelValue", false);
  }
}
</script>

<style scoped>
.sj-consent-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  /* 小屏上说明较长，正文单独滚动，按钮始终露在底部 */
  max-height: calc(100dvh - 190px);
  overflow-y: auto;
  overscroll-behavior: contain;
  color: var(--cpu-text);
}
.sj-consent-body > * {
  flex-shrink: 0;
}
.sj-consent-lead {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
}
.sj-group-title {
  margin: 8px 4px 0;
  font-size: 12px;
  color: var(--cpu-text-secondary);
}
.sj-group {
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  overflow: hidden;
  background: var(--cpu-surface-subtle);
}
.sj-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 44px;
  padding: 8px 14px;
}
.sj-row + .sj-row {
  border-top: 1px solid var(--cpu-border-soft);
}
.sj-row-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.sj-row-copy strong {
  font-size: 14px;
  font-weight: 500;
}
.sj-row-copy small {
  color: var(--cpu-text-secondary);
  font-size: 12px;
  line-height: 1.45;
}
.sj-consent-points {
  margin: 0;
  padding: 0 4px 0 22px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--cpu-text);
}
.sj-consent-points li + li {
  margin-top: 2px;
}
.sj-consent-link {
  margin: 0 4px;
  font-size: 12px;
  color: var(--cpu-text-secondary);
}
.sj-consent-link a {
  color: var(--cpu-primary);
  text-underline-offset: 3px;
}
.sj-consent-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.sj-btn {
  height: 36px;
  padding: 0 16px;
  border: none;
  border-radius: 10px;
  background: var(--cpu-surface-subtle);
  color: var(--cpu-text);
  font-size: 14px;
  cursor: pointer;
}
.sj-btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.sj-btn--primary {
  background: var(--cpu-primary);
  color: var(--cpu-on-primary, #fff);
}
</style>
