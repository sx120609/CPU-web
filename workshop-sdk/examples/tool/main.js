import { createWorkshopSDK, createLocalPreviewSDK } from "./workshop/sdk.js";
import { createToolShell } from "./workshop/shells.js";

const sdk =
  new URLSearchParams(location.search).get("preview") === "1"
    ? createLocalPreviewSDK({ appId: "text-lens", name: "文本透镜", type: "tool" })
    : createWorkshopSDK();
const input = document.createElement("section");
const label = document.createElement("label");
label.textContent = "输入或粘贴文本";
const textarea = document.createElement("textarea");
textarea.rows = 9;
textarea.maxLength = 100000;
textarea.placeholder = "在这里放入你的文稿…";
label.append(textarea);
const notice = document.createElement("p");
notice.className = "cw-tool-notice";
notice.textContent = "内容仅在此页面分析。下方可选择将草稿保存到作品存档。最多 100,000 字符。";
const saveLabel = document.createElement("label");
const saveDraft = document.createElement("input");
saveDraft.type = "checkbox";
saveLabel.append(saveDraft, document.createTextNode(" 保存这份草稿"));
input.append(label, notice, saveLabel);
const output = document.createElement("section");
output.className = "cw-output";
output.setAttribute("aria-label", "分析结果");
output.hidden = true;
const shell = createToolShell({
  container: document.querySelector("#app"),
  sdk,
  title: "文本透镜",
  description: "看清文稿的字数、结构与阅读时长。",
  input,
  output,
  actionLabel: "分析文本",
  async run({ signal, onProgress }) {
    const text = textarea.value;
    if (!text.trim()) throw new Error("请先输入文本");
    onProgress(0.2, "正在统计…");
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (signal.aborted) return;
    const chinese = (text.match(/\p{Script=Han}/gu) || []).length;
    const words = (text.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || []).length;
    const paragraphs = text.split(/\n\s*\n/).filter((part) => part.trim()).length;
    const characters = Array.from(text.replace(/\s/g, "")).length;
    const minutes = Math.max(1, Math.ceil(chinese / 300 + words / 200));
    onProgress(0.8, "正在生成结果…");
    output.replaceChildren();
    const stats = document.createElement("div");
    stats.className = "cw-stats";
    for (const [name, value] of [
      ["非空白字符", characters],
      ["中文字符", chinese],
      ["英文单词", words],
      ["段落", paragraphs],
    ]) {
      const item = document.createElement("div");
      item.className = "cw-stat";
      const title = document.createElement("small");
      title.textContent = name;
      const number = document.createElement("strong");
      number.textContent = String(value);
      item.append(title, number);
      stats.append(item);
    }
    const reading = document.createElement("p");
    reading.textContent = `预计阅读 ${minutes} 分钟（中文按 300 字/分钟、英文按 200 词/分钟估算）。`;
    output.append(stats, reading);
    output.hidden = false;
    const env = await sdk.getEnvironment();
    if (signal.aborted) return;
    if (env.storageAvailable) {
      if (saveDraft.checked && new TextEncoder().encode(JSON.stringify(text)).length > 60 * 1024) {
        const warning = document.createElement("p");
        warning.textContent = "草稿超过存档容量，分析结果已生成，请缩短草稿后保存。";
        output.append(warning);
      } else {
        await sdk.updateSave((value) => ({
          ...(value && typeof value === "object" && !Array.isArray(value) ? value : {}),
          draft: saveDraft.checked ? text : null,
        }));
      }
    } else if (saveDraft.checked) {
      const warning = document.createElement("p");
      warning.textContent = "当前无法保存草稿，分析结果已生成。";
      output.append(warning);
    }
    onProgress(1);
  },
});
(async () => {
  try {
    const env = await sdk.getEnvironment();
    saveDraft.disabled = !env.storageAvailable;
    if (env.storageAvailable) {
      const saved = await sdk.getSave();
      if (typeof saved?.draft === "string") {
        textarea.value = saved.draft.slice(0, 100000);
        saveDraft.checked = true;
      }
    }
  } catch {
    /* Shell shows connection errors. */
  }
})();
window.addEventListener(
  "pagehide",
  () => {
    shell.destroy();
    sdk.destroy();
  },
  { once: true },
);
