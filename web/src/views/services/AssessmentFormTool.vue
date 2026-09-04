<template>
  <main class="assessment-page">
    <button class="back-link" type="button" @click="router.push('/services/tools')">← 返回校园小工具</button>

    <section class="hero-card">
      <div class="hero-icon"><Monitor /></div>
      <div class="hero-copy">
        <span class="eyebrow">药大拾间 · Windows 小工具</span>
        <h1>综测填表工具</h1>
        <p>把活动、任职、获奖、志愿服务和证明材料按步骤填入，程序会自动整理并生成排版完成的 Word。</p>
        <div class="hero-tags">
          <span>仅支持 Windows 10/11</span>
          <span>材料只在本机处理</span>
          <span>草稿自动保存</span>
        </div>
      </div>
      <div class="download-panel">
        <strong>{{ download.available ? `最新版 v${download.version || '—'}` : '正在获取最新版' }}</strong>
        <small v-if="download.size">安装包约 {{ formatSize(download.size) }}</small>
        <small v-else>下载 ZIP 后解压，双击程序即可使用</small>
        <a
          v-if="download.available"
          class="primary-action"
          :href="download.url"
          rel="noopener noreferrer"
        >下载 Windows 版</a>
        <button v-else class="primary-action is-disabled" type="button" :disabled="loading" @click="loadDownload">
          {{ loading ? "正在连接企业盘…" : "重试获取下载" }}
        </button>
      </div>
    </section>

    <section class="content-grid">
      <article class="info-card">
        <span class="card-index">01</span>
        <h2>怎么用</h2>
        <ol>
          <li>下载 ZIP 并完整解压，不要直接在压缩包里运行。</li>
          <li>双击“综测填表工具.exe”，浏览器会自动打开填写页面。</li>
          <li>按基本信息、劳育信息、加分项目的顺序填写，最后生成 Word。</li>
        </ol>
      </article>
      <article class="info-card">
        <span class="card-index">02</span>
        <h2>宿舍号怎么填</h2>
        <p>请填写“楼栋-房间号”，例如 <b>H6-313</b>、<b>F2-608</b>、<b>C2-306</b>。不要只写 313，也不要填床位号。</p>
        <p>匹配成功后会自动计算宿舍卫生分，并把对应评分明细制成证明页放入 Word。</p>
      </article>
      <article class="info-card">
        <span class="card-index">03</span>
        <h2>隐私与更新</h2>
        <p>姓名、学号、草稿和所选材料保存在使用者自己的电脑，不会上传到药大拾间。</p>
        <p>程序启动后会静默检查新版本；发现更新时显示提示，用户可自行决定是否下载。</p>
      </article>
    </section>

    <section class="notice-card">
      <InfoFilled />
      <div>
        <strong>使用范围说明</strong>
        <p>本工具仅帮助快速整理和排版材料，不代替学院或班级审核；最终计分和材料有效性以当学年通知与审核结果为准。</p>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { InfoFilled, Monitor } from "@element-plus/icons-vue";
import { onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { getAssessmentFormDownload, type DesktopDownloadInfo } from "@/api/site";

const router = useRouter();
const loading = ref(false);
const download = reactive<DesktopDownloadInfo>({ available: false, url: "", version: "", password: "" });

function formatSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function loadDownload() {
  loading.value = true;
  try {
    Object.assign(download, await getAssessmentFormDownload());
  } finally {
    loading.value = false;
  }
}

onMounted(loadDownload);
</script>

<style scoped>
.assessment-page { display: flex; flex-direction: column; gap: 16px; color: var(--cpu-text); }
.back-link { width: fit-content; border: 0; padding: 2px 0; background: transparent; color: var(--cpu-text-secondary); cursor: pointer; font: inherit; }
.back-link:hover { color: var(--cpu-primary); }
.hero-card, .info-card, .notice-card { border: 1px solid var(--cpu-border-soft); background: var(--cpu-card); box-shadow: var(--cpu-shadow-sm); }
.hero-card { display: grid; grid-template-columns: auto minmax(0, 1fr) minmax(250px, 310px); gap: 24px; align-items: center; padding: 30px; border-radius: 18px; overflow: hidden; }
.hero-icon { width: 72px; height: 72px; display: grid; place-items: center; border-radius: 20px; background: #e5f6f1; color: #087b69; }
.hero-icon svg { width: 35px; height: 35px; }
.eyebrow { color: #087b69; font-size: 12px; font-weight: 750; letter-spacing: .08em; }
.hero-copy h1 { margin: 8px 0 10px; font-size: clamp(28px, 4vw, 42px); line-height: 1.1; }
.hero-copy p { max-width: 680px; margin: 0; color: var(--cpu-text-secondary); line-height: 1.75; }
.hero-tags { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 16px; }
.hero-tags span { padding: 6px 10px; border-radius: 999px; background: var(--cpu-surface-subtle); color: var(--cpu-text-secondary); font-size: 12px; }
.download-panel { display: flex; flex-direction: column; gap: 8px; padding: 20px; border-radius: 14px; background: linear-gradient(145deg, #eef9f6, #f8fbfa); }
.download-panel strong { font-size: 18px; }
.download-panel small { min-height: 18px; color: var(--cpu-text-secondary); }
.primary-action { display: grid; min-height: 46px; margin-top: 8px; padding: 0 18px; place-items: center; border: 0; border-radius: 10px; background: #087b69; color: #fff; cursor: pointer; font: inherit; font-weight: 750; text-decoration: none; }
.primary-action:hover { background: #066657; }
.primary-action.is-disabled { opacity: .72; }
.content-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.info-card { position: relative; min-height: 230px; padding: 24px; border-radius: 14px; }
.card-index { color: #0b8b78; font-size: 12px; font-weight: 800; letter-spacing: .1em; }
.info-card h2 { margin: 9px 0 14px; font-size: 18px; }
.info-card p, .info-card li { color: var(--cpu-text-secondary); font-size: 13px; line-height: 1.8; }
.info-card p { margin: 0 0 10px; }
.info-card ol { margin: 0; padding-left: 20px; }
.notice-card { display: flex; gap: 14px; align-items: flex-start; padding: 18px 20px; border-radius: 12px; }
.notice-card > svg { width: 22px; flex: 0 0 auto; color: #b7791f; }
.notice-card p { margin: 4px 0 0; color: var(--cpu-text-secondary); font-size: 13px; line-height: 1.7; }
@media (max-width: 900px) {
  .hero-card { grid-template-columns: auto minmax(0, 1fr); }
  .download-panel { grid-column: 1 / -1; }
  .content-grid { grid-template-columns: 1fr; }
  .info-card { min-height: auto; }
}
@media (max-width: 560px) {
  .hero-card { grid-template-columns: 1fr; padding: 22px; }
  .hero-icon { width: 58px; height: 58px; }
}
</style>
