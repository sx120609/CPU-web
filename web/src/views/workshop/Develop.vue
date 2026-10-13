<template>
  <div class="wk-page wk-page--narrow wk-develop">
    <router-link class="wk-back" to="/workshop">
      <el-icon aria-hidden="true"><ArrowLeft /></el-icon>创意工坊
    </router-link>
    <header class="wk-head">
      <div class="wk-head-copy">
        <h1>做一个自己的作品</h1>
        <p>小游戏、小工具都可以。作品就是一组网页文件，打包成 ZIP 上传。</p>
      </div>
      <el-button type="primary" @click="router.push('/workshop/mine')">去上传</el-button>
    </header>

    <ol class="wk-develop-steps" aria-label="上架步骤">
      <li v-for="(step, index) in steps" :key="step.title" :data-hue="step.hue">
        <span aria-hidden="true">{{ index + 1 }}</span>
        <b>{{ step.title }}</b>
        <small>{{ step.text }}</small>
      </li>
    </ol>

    <section class="wk-group">
      <div class="wk-group-head">
        <div>
          <h2 class="wk-h2">让 AI 帮你写</h2>
          <p class="wk-sub">写下想法，生成一份完整的提示词，交给会写代码的 AI 助手，它会按工坊的规则把作品写出来。</p>
        </div>
      </div>
      <div class="wk-seg" role="group" aria-label="作品类型">
        <button
          v-for="item in agentTypes"
          :key="item.value"
          type="button"
          :aria-pressed="agentType === item.value"
          @click="agentType = item.value"
        >
          {{ item.label }}
        </button>
      </div>
      <el-input
        v-model="requirements"
        class="wk-develop-input"
        type="textarea"
        :rows="4"
        :maxlength="12000"
        aria-label="你的想法"
        :placeholder="placeholders[agentType]"
      />
      <div class="wk-actions">
        <el-button type="primary" @click="copyPrompt">复制提示词</el-button>
        <el-button @click="downloadPrompt">下载为 TXT</el-button>
        <span class="wk-sub" role="status" aria-live="polite">{{ copyStatus }}</span>
      </div>
      <details class="wk-develop-details">
        <summary>查看提示词全文</summary>
        <textarea
          ref="promptField"
          class="wk-develop-code"
          :value="agentPrompt"
          readonly
          rows="14"
          aria-label="完整开发提示词"
        />
      </details>
    </section>

    <section class="wk-group wk-group--flush">
      <div class="wk-group-head">
        <div>
          <h2 class="wk-h2">或者从模板改</h2>
          <p class="wk-sub">模板解压就能运行，里面带着 SDK、界面外壳和一个完整示例。</p>
        </div>
      </div>
      <div class="wk-rows">
        <div v-for="item in templates" :key="item.type" class="wk-row">
          <WorkIcon :slug="item.type" :name="item.name" :type="item.type" :size="40" />
          <div class="wk-row-copy">
            <div class="wk-row-title">{{ item.name }}</div>
            <p class="wk-sub">{{ item.text }}</p>
          </div>
          <a class="wk-develop-download" :href="`/workshop/${item.type}-template.zip`" download>
            <el-icon aria-hidden="true"><Download /></el-icon>下载
          </a>
        </div>
      </div>
    </section>

    <section class="wk-group">
      <h2 class="wk-h2">打包和上传</h2>
      <ol class="wk-develop-list">
        <li>改 <code>manifest.json</code>：作品标识 <code>id</code>、名称、版本号和介绍。标识第一次上传后就固定了，以后靠它认出是同一个作品。</li>
        <li>本地起一个静态服务器，打开 <code>index.html?preview=1</code> 调试。</li>
        <li>把 <code>manifest.json</code>、入口页面和资源直接放在 ZIP 根目录，不要多套一层文件夹。</li>
        <li>在“我的作品”上传，先自己预览：电脑和手机都点一遍，试试暂停和存档。</li>
        <li>提交审核。通过后公开；要更新就用同一个 <code>id</code> 和新的版本号再传一次，审核期间旧版本照常可用。</li>
      </ol>
    </section>

    <section class="wk-group">
      <h2 class="wk-h2">规则和限制</h2>
      <dl class="wk-facts wk-develop-facts">
        <dt>大小</dt>
        <dd>ZIP 最大 20 MB，解压后不超过 60 MB、512 个文件。</dd>
        <dt>运行环境</dt>
        <dd>在隔离的窗口里运行，不能联网请求外部地址，不能读取主站的账号和数据。资源随包上传，用相对路径引用。</dd>
        <dt>存档</dt>
        <dd>每个作品一份 JSON 存档，最大 64 KB。登录用户存在云端，访客和预览存在本机。</dd>
        <dt>排行榜</dt>
        <dd>声明 <code>leaderboard</code> 权限后可以提交分数和读取榜单。分数是 0 以上的整数，越高越靠前，每人只留最高分；用游戏模板的话，结算时自动提交，菜单里自带“排行榜”。访客和预览时的成绩不计入。</dd>
        <dt>SDK</dt>
        <dd>提供主题、语言、暂停与恢复通知和存档读写。可以用任何前端框架，构建成静态网页后接入即可。</dd>
        <dt>改版</dt>
        <dd>公开的版本不能直接修改，新版本要重新审核。</dd>
      </dl>
      <details class="wk-develop-details">
        <summary>manifest.json 示例</summary>
        <pre class="wk-develop-code"><code>{{ manifestExample }}</code></pre>
        <p class="wk-sub">工具把 <code>type</code> 改成 <code>tool</code> 并去掉 <code>game</code>；不需要存档就把 <code>permissions</code> 留空。</p>
      </details>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { ArrowLeft, Download } from "@element-plus/icons-vue";
import type { WorkshopType } from "@/api/workshop";
import { createAgentPrompt } from "../../../../workshop-sdk/src/agent-prompt.js";
import sdkTypes from "../../../../workshop-sdk/src/sdk.d.ts?raw";
import shellTypes from "../../../../workshop-sdk/src/shells.d.ts?raw";
import WorkIcon from "./WorkIcon.vue";
import "./workshop.css";

const router = useRouter();
const steps = [
  { title: "写出来", text: "交给 AI，或者下载模板自己改", hue: "violet" },
  { title: "上传试用", text: "传 ZIP，只有自己能看到", hue: "blue" },
  { title: "提交审核", text: "管理员通过后公开", hue: "green" },
];
const agentTypes: { value: WorkshopType; label: string }[] = [
  { value: "game", label: "游戏" },
  { value: "tool", label: "工具" },
  { value: "extension", label: "扩展" },
];
const placeholders: Record<WorkshopType, string> = {
  game: "例如：做一个拼图游戏，支持触屏和键盘，能保存进度，深色浅色都好看。",
  tool: "例如：做一个绩点计算器，填学分和成绩，算出平均绩点，数据只留在本机。",
  extension: "例如：打开网站时显示一条今日校园冷知识，五秒后可以关掉。",
};
const templates: { type: WorkshopType; name: string; text: string }[] = [
  { type: "game", name: "游戏模板", text: "带菜单、暂停、结算和设置，附一个能直接玩的 Canvas 小游戏。" },
  { type: "tool", name: "工具模板", text: "带输入、处理进度和结果区，附一个文本统计工具。" },
  { type: "extension", name: "扩展模板", text: "给网站做开屏内容或点开才出现的小工具，启用位置由管理员决定。" },
];
const agentType = ref<WorkshopType>("game");
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
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
    await navigator.clipboard.writeText(value);
    copyStatus.value = "已复制";
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
    if (copied) copyStatus.value = "已复制";
    else {
      const target = promptField.value;
      target?.closest("details")?.setAttribute("open", "");
      target?.focus();
      target?.select();
      copyStatus.value = "浏览器不支持自动复制，请复制下面选中的文字，或下载 TXT";
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
.wk-develop-steps {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.wk-develop-steps li {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
  padding: 12px 14px;
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-hue-bg);
  color: var(--cpu-hue-ink);
}
.wk-develop-steps span { font-size: var(--cpu-fs-xxl); font-weight: 700; line-height: 1.2; opacity: 0.55; }
.wk-develop-steps b { font-size: var(--cpu-fs-m); font-weight: 600; }
.wk-develop-steps small { font-size: var(--cpu-fs-xs); opacity: 0.85; }
.wk-develop-input { margin: 12px 0; }
.wk-develop-details { margin-top: 12px; }
.wk-develop-details summary {
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-s);
  cursor: pointer;
}
.wk-develop-code {
  display: block;
  box-sizing: border-box;
  width: 100%;
  margin: 10px 0 0;
  padding: 12px;
  overflow-x: auto;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-m);
  background: var(--cpu-surface-soft);
  color: var(--cpu-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: var(--cpu-fs-xs);
  line-height: 1.6;
  resize: vertical;
}
.wk-develop-download {
  display: inline-flex;
  min-height: 32px;
  align-items: center;
  gap: 4px;
  padding: 0 14px;
  border-radius: var(--cpu-radius-pill);
  background: var(--cpu-primary-soft);
  color: var(--cpu-primary);
  font-size: var(--cpu-fs-s);
  font-weight: 600;
  text-decoration: none;
}
.wk-develop-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 10px 0 0;
  padding-left: 20px;
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-s);
  line-height: 1.7;
}
.wk-develop-facts { margin-top: 10px; }
.wk-develop code {
  padding: 1px 5px;
  border-radius: var(--cpu-radius-s);
  background: var(--cpu-surface-subtle);
  color: var(--cpu-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.92em;
  overflow-wrap: anywhere;
}
.wk-develop pre code { padding: 0; background: none; }
@media (max-width: 600px) {
  .wk-develop-steps { grid-template-columns: minmax(0, 1fr); }
  .wk-develop-steps li { flex-direction: row; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; }
  .wk-develop-steps span { font-size: var(--cpu-fs-xl); }
  .wk-develop-steps small { flex-basis: 100%; }
}
</style>
