<template>
  <el-dialog
    v-model="visible"
    title="刷题小工具设置"
    width="min(560px, calc(100vw - 32px))"
    :close-on-click-modal="false"
    append-to-body
  >
    <el-alert
      v-if="pendingReload"
      type="warning"
      :closable="false"
      show-icon
      title="部分改动要重新打开学习平台窗口才生效"
      description="脚本在窗口打开时会把节奏与自动化设置快照下来，之后改动不影响已开着的窗口。"
      class="reload-hint"
    />

    <el-form label-position="top" :disabled="saving">
      <section class="group">
        <h4>自动化</h4>
        <div class="switch-row" v-for="item in AUTOMATION" :key="item.key">
          <div class="switch-label">
            <strong>{{ item.label }}</strong>
            <small>{{ item.hint }}</small>
          </div>
          <el-switch
            :model-value="config[item.key]"
            @update:model-value="(value: any) => update(item.key, value)"
          />
        </div>
      </section>

      <section class="group">
        <h4>节奏</h4>
        <p class="group-hint">间隔越短越省时间，但行为特征越明显。默认值是相对稳妥的取值。</p>
        <div class="field-grid">
          <el-form-item label="换章等待（秒）">
            <el-input-number
              :model-value="config.interval" :min="1" :max="120"
              controls-position="right" @update:model-value="(v: any) => update('interval', v)"
            />
          </el-form-item>
          <el-form-item label="每题间隔（秒）">
            <div class="range">
              <el-input-number
                :model-value="config.answerIntervalMin" :min="1" :max="300"
                controls-position="right" @update:model-value="(v: any) => update('answerIntervalMin', v)"
              />
              <span>至</span>
              <el-input-number
                :model-value="config.answerIntervalMax" :min="1" :max="300"
                controls-position="right" @update:model-value="(v: any) => update('answerIntervalMax', v)"
              />
            </div>
          </el-form-item>
          <el-form-item label="提交前等待（秒）">
            <div class="range">
              <el-input-number
                :model-value="config.submitDelayMin" :min="1" :max="600"
                controls-position="right" @update:model-value="(v: any) => update('submitDelayMin', v)"
              />
              <span>至</span>
              <el-input-number
                :model-value="config.submitDelayMax" :min="1" :max="600"
                controls-position="right" @update:model-value="(v: any) => update('submitDelayMax', v)"
              />
            </div>
          </el-form-item>
          <el-form-item label="低于此正确率不自动提交">
            <el-input-number
              :model-value="config.minAccuracy" :min="0" :max="1" :step="0.05" :precision="2"
              controls-position="right" @update:model-value="(v: any) => update('minAccuracy', v)"
            />
          </el-form-item>
        </div>
      </section>

      <section class="group">
        <h4>AI 解答</h4>
        <div class="switch-row">
          <div class="switch-label">
            <strong>用校园 AI 作答</strong>
            <small>走药大拾间的 AI 通道，消耗你的每日额度；题库查不到时才会用</small>
          </div>
          <el-switch
            :model-value="config.aiEnabled"
            @update:model-value="(v: any) => update('aiEnabled', v)"
          />
        </div>
        <el-form-item v-if="config.aiEnabled" label="模型名称">
          <el-input
            :model-value="config.aiModel" placeholder="deepseek-reasoner"
            @update:model-value="(v: any) => update('aiModel', v)"
          />
        </el-form-item>
      </section>

      <section class="group">
        <h4>自定义题库</h4>
        <div class="switch-row">
          <div class="switch-label">
            <strong>启用自定义题库</strong>
            <small>填了地址才会生效。题目文本会发送到该地址</small>
          </div>
          <el-switch
            :model-value="config.customApiEnabled"
            @update:model-value="(v: any) => update('customApiEnabled', v)"
          />
        </div>
        <template v-if="config.customApiEnabled">
          <el-form-item label="接口地址">
            <el-input
              :model-value="config.customApiUrl" placeholder="https://example.com/api/query"
              @update:model-value="(v: any) => update('customApiUrl', v)"
            />
          </el-form-item>
          <el-form-item label="密钥（可留空）">
            <el-input
              :model-value="config.customApiKey" type="password" show-password
              @update:model-value="(v: any) => update('customApiKey', v)"
            />
          </el-form-item>
        </template>
      </section>
    </el-form>

    <template #footer>
      <span class="footer-note">{{ savedNote }}</span>
      <el-button @click="visible = false">关闭</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { getDesktopBridge } from "@/utils/clientInfo";

const visible = defineModel<boolean>({ required: true });

// 只有这些项在脚本里真的有读取点。脚本自带表单里还有个"自动答题"开关，
// 全文没有任何读取点，是装饰品，这里不放。
const AUTOMATION = [
  { key: "autoVideo", label: "自动播放视频与音频", hint: "视频任务点自动播放并等待完成" },
  { key: "autoJump", label: "自动切换到下一章", hint: "一章做完后自动往下走；关掉就停在原地等你" },
  { key: "autoSubmit", label: "自动提交章节测验", hint: "只作用于章节测验；正确率低于下方阈值时仍会暂存不交" },
  { key: "autoExam", label: "考试自动翻下一题", hint: "只作用于考试页面" }
] as const;

// 脚本构造时会把这些项快照下来，之后改动对已打开的窗口无效
const RELOAD_KEYS = [
  "autoVideo", "autoJump", "autoSubmit", "autoExam",
  "interval", "answerIntervalMin", "answerIntervalMax",
  "submitDelayMin", "submitDelayMax", "minAccuracy"
];

const bridge = getDesktopBridge();
const config = ref<Record<string, any>>({});
const saving = ref(false);
const pendingReload = ref(false);
const savedAt = ref(0);

const savedNote = computed(() => (savedAt.value ? "已保存" : ""));

async function load() {
  try {
    config.value = { ...(await bridge?.script?.getConfig()) };
  } catch {
    config.value = {};
  }
}

async function update(key: string, value: unknown) {
  const previous = config.value[key];
  config.value = { ...config.value, [key]: value };
  saving.value = true;
  try {
    // 主进程会把越界值夹回可用范围，所以用它的返回值覆盖本地状态
    config.value = { ...(await bridge?.script?.setConfig({ [key]: value })) };
    if (RELOAD_KEYS.includes(key)) pendingReload.value = true;
    savedAt.value = Date.now();
  } catch {
    config.value = { ...config.value, [key]: previous };
  } finally {
    saving.value = false;
  }
}

watch(visible, (open) => {
  if (open) void load();
  else pendingReload.value = false;
}, { immediate: true });
</script>

<style scoped lang="scss">
.reload-hint {
  margin-bottom: 16px;
}

.group + .group {
  margin-top: 22px;
  padding-top: 18px;
  border-top: 1px solid var(--cpu-border-soft);
}

h4 {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 600;
}

.group-hint {
  margin: 0 0 12px;
  color: var(--cpu-text-secondary);
  font-size: 12.5px;
  line-height: 1.6;
}

.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 9px 0;
}

.switch-label {
  display: flex;
  flex-direction: column;
  gap: 2px;

  strong {
    font-size: 13.5px;
    font-weight: 600;
  }

  small {
    color: var(--cpu-text-secondary);
    font-size: 12px;
    line-height: 1.55;
  }
}

/* 单列：两个 el-input-number 加个"至"塞不进半个对话框宽度，
   多列会把第二个数字框裁掉、并和下一列的控件叠在一起 */
.field-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0;
}

.field-grid :deep(.el-input-number) {
  width: 100%;
  min-width: 0;
}

.range {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;

  :deep(.el-input-number) {
    flex: 1 1 0;
  }

  span {
    flex: none;
    color: var(--cpu-text-secondary);
    font-size: 12px;
  }
}

.footer-note {
  float: left;
  color: var(--cpu-text-secondary);
  font-size: 12px;
  line-height: 32px;
}
</style>
