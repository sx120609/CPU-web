<template>
  <el-dialog
    :model-value="modelValue"
    :title="platform === 'windows' ? 'Windows 下载提示' : '安卓/鸿蒙下载提示'"
    width="min(620px, calc(100vw - 32px))"
    append-to-body
    class="download-guide-dialog"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div v-if="platform === 'windows'" class="download-guide-content">
      <p>
        Edge 第一次遇到新的安装包时，可能会显示“通常不会下载”或 SmartScreen 安全检查。
        这是浏览器对未签名新文件的提醒，不代表下载失败。
      </p>

      <section class="edge-keep-card" aria-label="Edge 保留下载操作示意">
        <div class="edge-keep-head">
          <strong>最容易漏掉的一步</strong>
          <span>不要直接点击“删除”</span>
        </div>
        <div class="edge-download-mock">
          <span class="edge-file-mark" aria-hidden="true">↓</span>
          <span class="edge-file-name">药大拾间桌面端…安装版.exe</span>
          <span class="edge-delete-button">
            <span>删除</span>
            <b aria-hidden="true">⌄</b>
          </span>
        </div>
        <div class="edge-arrow-tip">
          <span aria-hidden="true">↑</span>
          <strong>先点“删除”右边这一小格里的向下箭头</strong>
        </div>
        <div class="edge-keep-path" aria-label="操作顺序">
          <span>小箭头 ⌄</span><i aria-hidden="true">→</i><span>保留</span><i aria-hidden="true">→</i><span>仍然保留</span>
        </div>
      </section>

      <ol>
        <li>点击 Edge 右上角带黄色警告的“下载”图标；找不到时可按 <kbd>Ctrl</kbd> + <kbd>J</kbd>。</li>
        <li>找到安装包，在它右下角点击<strong>“删除”按钮最右侧的小箭头 ⌄</strong>，不要点“删除”文字本身。</li>
        <li>在展开的菜单中点<strong>“保留”</strong>；下一层确认页再点<strong>“仍然保留”</strong>。</li>
        <li>安装时若出现“Windows 已保护你的电脑”，依次点击“更多信息”→“仍要运行”。</li>
      </ol>

      <p class="download-guide-note">
        操作前请核对下载页面来自 <code>cpu.lizmt.cn</code>，文件名应以“药大拾间桌面端”或
        “CPU-Web-Desktop”开头。浏览器界面会随 Edge 版本略有变化，但入口都在该文件的警告菜单中。
      </p>
    </div>

    <div v-else class="download-guide-content">
      <p>
        安卓/鸿蒙卓易通下载的是 APK 安装包，浏览器和系统可能会提示“未知来源”或进行安全检查。
      </p>
      <ol>
        <li>下载完成后打开 APK；若系统禁止安装，点击“设置”，只为当前浏览器开启“允许安装未知来源应用”。</li>
        <li>返回安装界面继续；若出现“仍要安装”或“继续”，先确认文件来自药大拾间官网，再按提示确认。</li>
        <li>鸿蒙设备按系统提示完成安全检查即可；安装完成后可关闭刚才授予的“允许此来源”权限。</li>
      </ol>
      <p class="download-guide-note">
        只从 <code>cpu.lizmt.cn</code> 下载并核对应用名称。无需关闭系统安全功能，也不要为陌生应用授予安装权限。
      </p>
    </div>

    <template #footer>
      <el-button type="primary" @click="emit('update:modelValue', false)">我知道怎么操作了</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
export type DownloadGuidePlatform = "android" | "windows";

withDefaults(defineProps<{
  modelValue: boolean;
  platform?: DownloadGuidePlatform;
}>(), {
  platform: "windows",
});

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
.download-guide-content ol { display: grid; gap: 9px; padding-left: 22px; }
.download-guide-content li::marker { color: var(--cpu-primary); font-weight: 800; }
.download-guide-content strong { color: var(--cpu-text); }

.edge-keep-card {
  display: grid;
  gap: 10px;
  padding: 14px;
  border: 1px solid color-mix(in srgb, var(--cpu-primary) 28%, var(--cpu-border-soft));
  border-radius: 14px;
  background: color-mix(in srgb, var(--cpu-primary) 6%, var(--cpu-surface));
}

.edge-keep-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.edge-keep-head span {
  color: var(--cpu-danger, #c85d5d);
  font-size: 12px;
  font-weight: 700;
}

.edge-download-mock {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-height: 54px;
  padding: 9px 10px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 11px;
  background: var(--cpu-surface);
}

.edge-file-mark {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: var(--cpu-surface-soft);
  color: var(--cpu-primary);
  font-size: 20px;
  font-weight: 800;
}

.edge-file-name {
  min-width: 0;
  overflow: hidden;
  color: var(--cpu-text);
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.edge-delete-button {
  display: grid;
  grid-template-columns: auto 34px;
  align-items: stretch;
  overflow: hidden;
  border: 1px solid var(--cpu-border);
  border-radius: 9px;
  background: var(--cpu-surface-soft);
  color: var(--cpu-text-secondary);
}

.edge-delete-button > span,
.edge-delete-button > b {
  display: grid;
  place-items: center;
  min-height: 34px;
}

.edge-delete-button > span { padding: 0 12px; }
.edge-delete-button > b {
  border-left: 1px solid var(--cpu-primary);
  background: color-mix(in srgb, var(--cpu-primary) 14%, var(--cpu-surface));
  color: var(--cpu-primary-dark);
  font-size: 22px;
}

.edge-arrow-tip {
  display: flex;
  justify-content: flex-end;
  gap: 7px;
  padding-right: 2px;
  color: var(--cpu-primary-dark);
  font-size: 12px;
}

.edge-arrow-tip > span { font-size: 20px; line-height: 1; }

.edge-keep-path {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 7px;
}

.edge-keep-path span {
  padding: 4px 9px;
  border-radius: 999px;
  background: var(--cpu-primary);
  color: var(--cpu-on-primary, #fff);
  font-size: 12px;
  font-weight: 750;
}

.edge-keep-path i { color: var(--cpu-text-muted); font-style: normal; }

kbd {
  padding: 1px 5px;
  border: 1px solid var(--cpu-border);
  border-bottom-width: 2px;
  border-radius: 5px;
  background: var(--cpu-surface-soft);
  color: var(--cpu-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}

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

@media (max-width: 520px) {
  .edge-keep-head { align-items: flex-start; flex-direction: column; gap: 2px; }
  .edge-download-mock { grid-template-columns: 30px minmax(0, 1fr); }
  .edge-delete-button { grid-column: 1 / -1; justify-self: end; }
}
</style>
