<template>
  <el-dialog
    :model-value="modelValue"
    :title="platform === 'windows' ? 'Windows 下载提示' : '安卓/鸿蒙下载提示'"
    width="min(680px, calc(100vw - 32px))"
    append-to-body
    class="download-guide-dialog"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div v-if="platform === 'windows'" class="download-guide-content">
      <p>
        Edge 第一次遇到新的安装包时，可能会连续显示两层安全提醒。
        <strong>先处理“通常不会下载”，再处理“打开前请确保信任”</strong>；看到提醒不代表下载失败。
      </p>

      <section class="edge-stage" aria-label="第一层：通常不会下载">
        <div class="edge-stage-heading">
          <span class="edge-stage-number">1</span>
          <div>
            <strong>先找到“通常不会下载”</strong>
            <small>这是下载列表里的第一层提醒</small>
          </div>
        </div>

        <div class="edge-warning-mock">
          <span class="edge-warning-mark" aria-hidden="true">!</span>
          <span class="edge-warning-copy">
            <strong>通常不会下载 药大拾间桌面端…安装版.exe</strong>
            <small>请在打开前确保信任正在下载的文件或其源。</small>
          </span>
          <span class="edge-more-button" aria-label="更多操作">…</span>
        </div>

        <div class="edge-action-tip">
          <strong>把鼠标移到这条下载记录上</strong>，点击右侧的 <b>…</b>，然后选择<strong>“保留”</strong>。
        </div>
        <div class="edge-keep-path" aria-label="第一层操作顺序">
          <span>通常不会下载</span><i aria-hidden="true">→</i><span>… 更多操作</span><i aria-hidden="true">→</i><span>保留</span>
        </div>
      </section>

      <div class="edge-stage-connector">
        <span aria-hidden="true">↓</span>
        <strong>完成第一层后，Edge 才会显示下面的确认界面</strong>
      </div>

      <section class="edge-stage" aria-label="第二层：打开前请确保信任">
        <div class="edge-stage-heading">
          <span class="edge-stage-number">2</span>
          <div>
            <strong>再处理“打开前请确保信任”</strong>
            <small>不要直接点击“删除”</small>
          </div>
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
          <strong>点“删除”右侧独立小格里的向下箭头，不要点“删除”文字</strong>
        </div>
        <div class="edge-keep-path" aria-label="第二层操作顺序">
          <span>删除右侧小箭头 ⌄</span><i aria-hidden="true">→</i><span>保留</span><i aria-hidden="true">→</i><span>仍然保留</span>
        </div>
      </section>

      <ol>
        <li>点击 Edge 右上角带黄色警告的“下载”图标；找不到时可按 <kbd>Ctrl</kbd> + <kbd>J</kbd>。</li>
        <li>在<strong>“通常不会下载”</strong>的记录上点击右侧<strong>“…”</strong>，选择<strong>“保留”</strong>。</li>
        <li>出现<strong>“打开前请确保信任”</strong>后，点击“删除”右侧的小箭头，再按页面提示选择<strong>“保留”或“仍然保留”</strong>。</li>
        <li>安装时若出现“Windows 已保护你的电脑”，依次点击“更多信息”→“仍要运行”。</li>
      </ol>

      <p class="download-guide-note">
        操作前请核对下载页面来自 <code>cputime.cn</code>，文件名应以“药大拾间桌面端”或
        “CPU-Web-Desktop”开头。Edge 不同版本的按钮位置可能略有变化，但顺序都是
        <strong>“通常不会下载”→“保留”→二次确认</strong>。
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
        只从 <code>cputime.cn</code> 下载并核对应用名称。无需关闭系统安全功能，也不要为陌生应用授予安装权限。
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

.edge-stage {
  display: grid;
  gap: 11px;
  padding: 14px;
  border: 1px solid color-mix(in srgb, var(--cpu-primary) 28%, var(--cpu-border-soft));
  border-radius: 14px;
  background: color-mix(in srgb, var(--cpu-primary) 6%, var(--cpu-surface));
}

.edge-stage-heading {
  display: flex;
  align-items: center;
  gap: 10px;
}

.edge-stage-heading > div {
  display: grid;
  gap: 1px;
}

.edge-stage-heading small {
  color: var(--cpu-text-muted);
  font-size: 12px;
}

.edge-stage-number {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  border-radius: 9px;
  background: var(--cpu-primary);
  color: var(--cpu-on-primary, #fff);
  font-weight: 800;
}

.edge-warning-mock {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) 36px;
  align-items: center;
  gap: 10px;
  min-height: 62px;
  padding: 10px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 11px;
  background: var(--cpu-surface);
}

.edge-warning-mark,
.edge-file-mark {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: var(--cpu-surface-soft);
  color: var(--cpu-primary);
  font-size: 18px;
  font-weight: 800;
}

.edge-warning-mark {
  color: var(--cpu-warning, #b97920);
}

.edge-warning-copy {
  display: grid;
  min-width: 0;
  gap: 1px;
}

.edge-warning-copy strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.edge-warning-copy small {
  color: var(--cpu-text-muted);
  font-size: 11px;
}

.edge-more-button {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 1px solid var(--cpu-border);
  border-radius: 9px;
  background: var(--cpu-surface-soft);
  color: var(--cpu-text);
  font-size: 20px;
  font-weight: 800;
}

.edge-action-tip {
  padding: 9px 11px;
  border-radius: 9px;
  background: var(--cpu-surface-soft);
  color: var(--cpu-text-secondary);
  font-size: 12px;
}

.edge-action-tip b {
  display: inline-grid;
  place-items: center;
  min-width: 26px;
  margin: 0 2px;
  border: 1px solid var(--cpu-border);
  border-radius: 6px;
  background: var(--cpu-surface);
  color: var(--cpu-text);
  font-size: 16px;
}

.edge-stage-connector {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--cpu-primary-dark);
  font-size: 12px;
}

.edge-stage-connector span {
  font-size: 20px;
  line-height: 1;
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
  font-family: var(--cpu-font-mono);
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
  font-family: var(--cpu-font-mono);
}

@media (max-width: 520px) {
  .edge-warning-mock { grid-template-columns: 30px minmax(0, 1fr) 34px; }
  .edge-warning-copy small { display: none; }
  .edge-download-mock { grid-template-columns: 30px minmax(0, 1fr); }
  .edge-delete-button { grid-column: 1 / -1; justify-self: end; }
  .edge-arrow-tip { justify-content: flex-start; }
}
</style>
