<template>
  <section class="th-group">
    <h2 class="th-h2">开放与准入</h2>
    <div v-if="!form" class="th-empty"><p>加载中…</p></div>
    <form v-else class="th-form th-config" @submit.prevent="save">
      <el-checkbox v-model="form.open">向来访者开放（关闭时只有洞主和核心管理员能开启会话，已有会话不受影响）</el-checkbox>
      <el-checkbox v-model="form.studentOnly">仅限学校统一身份认证登录的同学</el-checkbox>

      <h2 class="th-h2 th-config-title">心理发展中心求助渠道</h2>
      <p class="th-sub">高危转介后会常驻显示在来访者的对话框上方，树洞首页底部也会显示。</p>
      <div class="th-field">
        <label for="th-config-name">机构名称</label>
        <el-input id="th-config-name" v-model="form.centerName" maxlength="40" />
      </div>
      <div class="th-field">
        <label for="th-config-hotline">热线电话</label>
        <el-input id="th-config-hotline" v-model="form.centerHotline" maxlength="120" placeholder="请填写经心理中心确认的号码" />
      </div>
      <div class="th-field">
        <label for="th-config-location">地点</label>
        <el-input id="th-config-location" v-model="form.centerLocation" maxlength="120" />
      </div>
      <div class="th-field">
        <label for="th-config-hours">开放时间</label>
        <el-input id="th-config-hours" v-model="form.centerHours" maxlength="120" />
      </div>
      <div class="th-field">
        <label for="th-config-guide">引导文案</label>
        <el-input id="th-config-guide" v-model="form.crisisGuide" type="textarea" :rows="3" maxlength="400" show-word-limit />
      </div>
      <div class="th-field">
        <label for="th-config-emergency">紧急提示</label>
        <el-input id="th-config-emergency" v-model="form.emergencyNote" type="textarea" :rows="2" maxlength="200" show-word-limit />
      </div>
      <div class="th-actions">
        <el-button type="primary" native-type="submit" :loading="saving">保存设置</el-button>
      </div>
    </form>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { treeholeApi, type TreeholeConfig } from "@/api/treehole";

const form = ref<TreeholeConfig | null>(null);
const saving = ref(false);

async function save() {
  if (!form.value) return;
  saving.value = true;
  try {
    form.value = await treeholeApi.saveConfig(form.value);
    ElMessage.success("设置已保存");
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  form.value = await treeholeApi.config();
});
</script>

<style scoped>
.th-config { max-width: 560px; margin-top: 8px; }
.th-config-title { margin-top: 12px; }
</style>
