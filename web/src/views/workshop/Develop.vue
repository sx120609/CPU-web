<template>
  <div class="pk-page pk-page--wide workshop-guide">
    <header class="pk-head">
      <router-link class="pk-back" to="/workshop">← 创意工坊</router-link>
      <div class="pk-title">
        <span class="pk-tile" aria-hidden="true">🛠</span>
        <div class="pk-title-copy">
          <h1>把创意变成作品</h1>
          <p>选择模板，制作自己的小游戏或工具，提交审核后分享给大家。</p>
        </div>
      </div>
    </header>
    <section class="guide-card agent-guide">
      <h2>让 Agent 帮你开发</h2>
      <p>
        选择作品类型，填写想法。生成的完整中文提示词包含当前 SDK
        类型、权限边界和交付检查，可直接交给开发 Agent。模板 ZIP
        内也附有同源提示词和类型说明。
      </p>
      <label for="agent-type">作品类型</label>
      <el-select id="agent-type" v-model="agentType" aria-label="作品类型">
        <el-option label="游戏" value="game" />
        <el-option label="工具" value="tool" />
        <el-option label="站点扩展" value="extension" />
      </el-select>
      <label for="agent-requirements">你的需求</label>
      <el-input
        id="agent-requirements"
        v-model="requirements"
        type="textarea"
        :rows="4"
        :maxlength="12000"
        placeholder="例如：制作支持触摸和键盘的拼图游戏，保存进度，深浅主题自适应。"
      />
      <div class="agent-actions">
        <el-button type="primary" @click="copyPrompt">复制完整提示词</el-button>
        <el-button @click="downloadPrompt">下载提示词 TXT</el-button>
      </div>
      <p role="status" aria-live="polite">{{ copyStatus }}</p>
      <details>
        <summary>查看 / 手动复制完整提示词</summary>
        <textarea
          ref="promptField"
          class="agent-prompt"
          :value="agentPrompt"
          readonly
          rows="16"
          aria-label="完整开发提示词"
        />
      </details>
    </section>
    <div class="guide-templates">
      <section class="guide-card">
        <h2>游戏模板</h2>
        <p>
          参考站内小游戏的菜单、暂停、结算和设置风格，包含一个可以直接试玩的
          Canvas 游戏。替换玩法与素材即可开始创作。
        </p>
        <a class="pk-link" href="/workshop/game-template.zip" download
          >下载游戏模板 ZIP ↓</a
        >
      </section>
      <section class="guide-card">
        <h2>工具模板</h2>
        <p>
          包含输入、处理进度、取消和结果区域，以及一个文本分析工具示例。适合计算器、文字处理等浏览器工具。
        </p>
        <a class="pk-link" href="/workshop/tool-template.zip" download
          >下载工具模板 ZIP ↓</a
        >
      </section>
      <section class="guide-card">
        <h2>站点扩展模板</h2>
        <p>
          为公开页面制作开屏内容或主动打开的小工具。权限按需申请，发布与启用分别审核管理。
        </p>
        <a class="pk-link" href="/workshop/extension-template.zip" download
          >下载站点扩展模板 ZIP ↓</a
        >
      </section>
    </div>
    <section class="guide-card">
      <h2>从模板到上架</h2>
      <ol>
        <li>
          下载并解压模板，修改
          <code>manifest.json</code>
          中的作品标识、名称、版本和介绍。作品标识首次上传后用于关联后续版本。
        </li>
        <li>
          修改 <code>main.js</code> 和页面资源。可用本地静态服务器打开
          <code>index.html?preview=1</code> 调试模板。
        </li>
        <li>
          将 <code>manifest.json</code>、入口页面和资源直接放在 ZIP
          根目录，避免多包一层文件夹。
        </li>
        <li>
          在“我的作品”上传
          ZIP，先打开私有预览，确认桌面和手机上的操作、暂停和存档。
        </li>
        <li>
          提交审核。站长通过后，作品即可在工坊中公开使用。更新时使用相同标识和新的版本号重新上传。
        </li>
      </ol>
      <router-link class="pk-link" to="/workshop/mine"
        >前往我的作品 →</router-link
      >
    </section>
    <section class="guide-card">
      <h2>统一作品描述</h2>
      <pre><code>{{ manifestExample }}</code></pre>
      <p>
        工具将 <code>type</code> 改为 <code>tool</code> 并省略
        <code>game</code>。不需要保存设置或进度时，将
        <code>permissions</code> 设为空数组。
      </p>
    </section>
    <section class="guide-card">
      <h2>平台提供什么</h2>
      <ul>
        <li>
          统一 SDK 提供主题、语言、暂停/恢复通知，以及每个作品独立的 JSON
          存档，最多 64 KB。
        </li>
        <li>
          正式作品的登录用户使用云端存档；访客和审核预览使用隔离的本机存档。
        </li>
        <li>
          游戏与工具使用不同的界面框架，均可自定义主体内容；也可使用其他框架，构建成静态网页后接入
          SDK。
        </li>
        <li>
          资源随包上传，使用相对路径。第一版不开放外部网络、服务器代码和主站个人数据接口。
        </li>
        <li>
          作品包最大 20 MB，解压后总计不超过 60 MB、512
          个文件。模板中的本地预览方式不等于平台权限，提交前仍需在网站预览。
        </li>
      </ul>
      <p>
        公开版本内容不能直接修改。新版本需重新审核，审核期间原版本继续可用。排行榜和云端成就尚不属于第一版第三方
        SDK。
      </p>
    </section>
  </div>
</template>

<script setup lang="ts">
import "@/styles/page-kit.css";
import { computed, ref } from "vue";
import { ElButton, ElInput, ElOption, ElSelect } from "element-plus";
import { createAgentPrompt } from "../../../../workshop-sdk/src/agent-prompt.js";
import sdkTypes from "../../../../workshop-sdk/src/sdk.d.ts?raw";
import shellTypes from "../../../../workshop-sdk/src/shells.d.ts?raw";

const agentType = ref<"game" | "tool" | "extension">("game");
const requirements = ref("");
const copyStatus = ref("");
const promptField = ref<HTMLTextAreaElement>();
const agentPrompt = computed(() =>
  createAgentPrompt({
    type: agentType.value,
    requirements: requirements.value,
    sdkTypes,
    shellTypes,
  }),
);
async function copyPrompt() {
  const value = agentPrompt.value;
  try {
    if (!navigator.clipboard?.writeText)
      throw new Error("Clipboard unavailable");
    await navigator.clipboard.writeText(value);
    copyStatus.value = "已复制完整提示词。";
  } catch {
    // Legacy clipboard also works in many HTTP/LAN browsers.
    const field = document.createElement("textarea");
    field.value = value;
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);
    field.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      /* Manual copy below. */
    }
    field.remove();
    if (copied) copyStatus.value = "已复制完整提示词。";
    else {
      const field = promptField.value;
      field?.closest("details")?.setAttribute("open", "");
      field?.focus();
      field?.select();
      copyStatus.value =
        "浏览器不支持自动复制，请复制已选中的文本，或下载 TXT。";
    }
  }
}
function downloadPrompt() {
  const url = URL.createObjectURL(
    new Blob([agentPrompt.value], { type: "text/plain;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `cpu-workshop-${agentType.value}-agent-prompt.txt`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const manifestExample = JSON.stringify(
  {
    schemaVersion: 1,
    id: "my-first-game",
    type: "game",
    name: "我的小游戏",
    version: "1.0.0",
    description: "介绍玩法、操作方式和注意事项。",
    entry: "index.html",
    permissions: ["storage"],
    game: {
      orientation: "portrait",
      controls: ["pointer", "touch"],
      aspectRatio: 0.625,
    },
  },
  null,
  2,
);
</script>

<style scoped>
.agent-guide {
  margin-bottom: 16px;
}
.agent-guide label {
  display: block;
  margin-top: 12px;
}
.agent-guide textarea {
  box-sizing: border-box;
  width: 100%;
  padding: 10px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-m);
  background: var(--cpu-surface-soft);
  color: var(--cpu-text);
  font: inherit;
}
.agent-guide textarea {
  resize: vertical;
}
.agent-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 12px;
}
.agent-guide .el-select {
  width: 100%;
}
.agent-actions .el-button + .el-button {
  margin-left: 0;
}
.agent-prompt {
  margin-top: 12px;
  font-family: monospace !important;
}
.guide-templates {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.guide-card {
  padding: 24px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-card);
  line-height: 1.8;
}
.guide-card h2 {
  margin: 0 0 12px;
  color: var(--cpu-text);
  font-size: var(--cpu-fs-l);
}
.guide-card p {
  color: var(--cpu-text-secondary);
}
.guide-card li + li {
  margin-top: 10px;
}
.guide-card pre {
  padding: 16px;
  background: var(--cpu-surface-soft);
  border-radius: var(--cpu-radius-m);
  overflow-x: auto;
  font-size: 13px;
  line-height: 1.6;
}
.guide-card code {
  overflow-wrap: anywhere;
}
@media (max-width: 640px) {
  .guide-templates {
    grid-template-columns: 1fr;
  }
  .guide-card {
    padding: 18px;
  }
}
</style>
