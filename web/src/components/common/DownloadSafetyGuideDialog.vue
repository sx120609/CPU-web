<template>
  <el-dialog
    :model-value="modelValue"
    title="Windows 下载提示"
    width="min(560px, calc(100vw - 32px))"
    append-to-body
    class="download-guide-dialog"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="download-guide-content">
      <p>
        Windows 浏览器第一次遇到新的安装包时，可能会显示“通常不会下载”或安全检查提示。
        这是浏览器对新文件的提醒，不代表安装包下载失败。
      </p>
      <ol>
        <li>在 Edge 右上角打开下载列表，找到刚刚下载的 Windows 安装包。</li>
        <li>点击文件右侧的警告按钮或“…”菜单，选择“保留”；如果再次确认，选择“仍要保留”。</li>
        <li>打开安装包时若出现“Windows 已保护你的电脑”，点击“更多信息”，确认文件来源后再点“仍要运行”。</li>
      </ol>
      <p class="download-guide-note">
        操作前请核对文件来自 <code>cpu.lizmt.cn</code>，文件名应以药大拾间或
        CPU-Web-Desktop 开头。不要根据其他网站或陌生弹窗的指引放行文件。
      </p>
    </div>
    <template #footer>
      <el-button type="primary" @click="emit('update:modelValue', false)">知道了</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ (event: "update:modelValue", value: boolean): void }>();
</script>

<style scoped>
.download-guide-content {
  display: grid;
  gap: 16px;
  color: var(--cpu-text-secondary);
  font-size: 14px;
  line-height: 1.75;
}

.download-guide-content p,
.download-guide-content ol { margin: 0; }
.download-guide-content ol { display: grid; gap: 10px; padding-left: 22px; }
.download-guide-content li::marker { color: var(--cpu-primary); font-weight: 800; }

.download-guide-note {
  padding: 11px 13px;
  border: 1px solid color-mix(in srgb, var(--cpu-primary) 22%, var(--cpu-border-soft));
  border-radius: 10px;
  background: color-mix(in srgb, var(--cpu-primary) 7%, var(--cpu-surface));
  color: var(--cpu-text-muted);
  font-size: 12px;
  line-height: 1.65;
}

.download-guide-note code {
  padding: 1px 5px;
  border-radius: 5px;
  background: var(--cpu-surface-soft);
  color: var(--cpu-primary-dark);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
</style>
