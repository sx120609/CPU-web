<template>
  <div class="pdf-tool-panel">
    <div v-if="needsLogin" class="pdf-login-panel">
      <el-icon><Lock /></el-icon>
      <div>
        <h3>登录后使用 PDF 工具</h3>
        <p>管理员已将这个工具设为登录后可用。</p>
      </div>
      <el-button type="primary" @click="goLogin">去登录</el-button>
      <PrivacyPolicyNotice compact />
    </div>

    <template v-else>
      <section class="pdf-toolbar" aria-label="PDF 工具模式">
        <button
          v-for="mode in modeOptions"
          :key="mode.key"
          type="button"
          class="mode-button"
          :class="{ active: activeMode === mode.key }"
          @click="activeMode = mode.key"
        >
          <el-icon><component :is="mode.icon" /></el-icon>
          <span>{{ mode.label }}</span>
          <small>{{ mode.badge }}</small>
        </button>
      </section>

      <section class="pdf-workbench">
        <div class="upload-panel">
          <input
            ref="fileInput"
            class="visually-hidden"
            type="file"
            accept=".pdf,image/png,image/jpeg,image/webp,image/bmp"
            multiple
            @change="handleFileInput"
          >
          <button
            type="button"
            class="drop-zone"
            :class="{ dragging: isDragging }"
            @click="fileInput?.click()"
            @dragenter.prevent="isDragging = true"
            @dragover.prevent="isDragging = true"
            @dragleave.prevent="isDragging = false"
            @drop.prevent="handleDrop"
          >
            <el-icon><UploadFilled /></el-icon>
            <strong>选择 PDF 或图片</strong>
            <span>PDF、PNG、JPG、WebP、BMP</span>
          </button>

          <div class="file-list" :class="{ empty: !files.length }">
            <div v-if="!files.length" class="file-empty">还没有文件</div>
            <div v-for="(item, index) in files" :key="item.id" class="file-row">
              <span class="file-kind" :class="item.kind">{{ item.kind === 'pdf' ? 'PDF' : 'IMG' }}</span>
              <span class="file-main">
                <b>{{ item.file.name }}</b>
                <small>{{ formatBytes(item.file.size) }}<template v-if="item.pages"> · {{ item.pages }} 页</template></small>
              </span>
              <span class="file-actions">
                <button type="button" :disabled="index === 0 || busy" title="上移" @click="moveFile(index, -1)">
                  <el-icon><SortUp /></el-icon>
                </button>
                <button type="button" :disabled="index === files.length - 1 || busy" title="下移" @click="moveFile(index, 1)">
                  <el-icon><SortDown /></el-icon>
                </button>
                <button type="button" :disabled="busy" title="移除" @click="removeFile(item.id)">
                  <el-icon><Close /></el-icon>
                </button>
              </span>
            </div>
          </div>
        </div>

        <div class="settings-panel">
          <div class="panel-heading">
            <div>
              <h3>{{ activeModeMeta.label }}</h3>
              <p>{{ activeModeMeta.summary }}</p>
            </div>
            <span>{{ activeModeMeta.badge }}</span>
          </div>

          <div v-if="singlePdfMode" class="control-grid">
            <label>
              <span>PDF 文件</span>
              <select v-model="selectedPdfId" :disabled="busy">
                <option value="">选择一个 PDF</option>
                <option v-for="item in pdfFiles" :key="item.id" :value="item.id">{{ item.file.name }}</option>
              </select>
            </label>
          </div>

          <div v-if="pageRangeMode" class="control-grid">
            <label>
              <span>页码范围</span>
              <input v-model="pageRange" :disabled="busy" placeholder="例如 1-3,5；留空为全部">
            </label>
          </div>

          <div v-if="activeMode === 'split'" class="control-grid">
            <label>
              <span>导出方式</span>
              <select v-model="splitOutput" :disabled="busy">
                <option value="single">合成一个 PDF</option>
                <option value="zip">逐页 ZIP</option>
              </select>
            </label>
          </div>

          <div v-if="activeMode === 'rotate'" class="control-grid">
            <label>
              <span>旋转角度</span>
              <select v-model.number="rotateAngle" :disabled="busy">
                <option :value="90">顺时针 90°</option>
                <option :value="180">180°</option>
                <option :value="270">逆时针 90°</option>
              </select>
            </label>
          </div>

          <div v-if="activeMode === 'compress'" class="control-grid two">
            <label>
              <span>清晰度</span>
              <input v-model.number="compressQuality" :disabled="busy" type="range" min="45" max="92" step="1">
            </label>
            <label>
              <span>渲染倍率</span>
              <select v-model.number="compressScale" :disabled="busy">
                <option :value="0.9">小文件</option>
                <option :value="1.15">均衡</option>
                <option :value="1.45">更清晰</option>
              </select>
            </label>
          </div>

          <div v-if="activeMode === 'pdf_to_images'" class="control-grid two">
            <label>
              <span>图片格式</span>
              <select v-model="imageOutputFormat" :disabled="busy">
                <option value="png">PNG</option>
                <option value="jpg">JPG</option>
              </select>
            </label>
            <label>
              <span>渲染倍率</span>
              <select v-model.number="imageScale" :disabled="busy">
                <option :value="1">1x</option>
                <option :value="1.5">1.5x</option>
                <option :value="2">2x</option>
              </select>
            </label>
          </div>

          <div v-if="activeMode === 'images_to_pdf'" class="control-grid">
            <label>
              <span>页面尺寸</span>
              <select v-model="imagePdfFit" :disabled="busy">
                <option value="natural">按图片原尺寸</option>
                <option value="a4">适配 A4 页面</option>
              </select>
            </label>
          </div>

          <button type="button" class="run-button" :disabled="!canRun || busy" @click="runTool">
            <el-icon><Download /></el-icon>
            <span>{{ busy ? progressText || '处理中' : activeModeMeta.action }}</span>
          </button>

          <div class="result-strip" :class="{ active: resultText }">
            <el-icon><DocumentChecked /></el-icon>
            <span>{{ resultText || requirementText }}</span>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  Close,
  CopyDocument,
  Document,
  DocumentChecked,
  Download,
  Files,
  Lock,
  Picture,
  Rank,
  RefreshLeft,
  Scissor,
  SortDown,
  SortUp,
  UploadFilled,
} from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import type JSZip from "jszip";
import type { PDFDocument as PdfDocumentInstance } from "pdf-lib";
import { getToken } from "@/api/request";
import PrivacyPolicyNotice from "@/components/common/PrivacyPolicyNotice.vue";

type PdfMode = "merge" | "split" | "compress" | "images_to_pdf" | "pdf_to_images" | "extract_text" | "rotate";
type LocalFileKind = "pdf" | "image";

interface LocalFile {
  id: string;
  file: File;
  kind: LocalFileKind;
  pages?: number;
}

const props = defineProps<{ requireLogin?: boolean }>();
const route = useRoute();
const router = useRouter();
const fileInput = ref<HTMLInputElement | null>(null);
const files = ref<LocalFile[]>([]);
const activeMode = ref<PdfMode>("merge");
const selectedPdfId = ref("");
const pageRange = ref("");
const splitOutput = ref<"single" | "zip">("single");
const rotateAngle = ref(90);
const compressQuality = ref(72);
const compressScale = ref(1.15);
const imageOutputFormat = ref<"png" | "jpg">("png");
const imageScale = ref(1.5);
const imagePdfFit = ref<"natural" | "a4">("natural");
const busy = ref(false);
const isDragging = ref(false);
const progressText = ref("");
const resultText = ref("");
const pdfWorkerSrc = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).toString();

let pdfLibPromise: Promise<typeof import("pdf-lib")> | null = null;
let pdfJsPromise: Promise<typeof import("pdfjs-dist")> | null = null;
let jsZipPromise: Promise<typeof JSZip> | null = null;

const modeOptions: Array<{
  key: PdfMode;
  label: string;
  badge: string;
  summary: string;
  action: string;
  icon: unknown;
}> = [
  { key: "merge", label: "合并", badge: "PDF x2", summary: "按左侧顺序合成一个 PDF。", action: "合并并下载", icon: Files },
  { key: "split", label: "拆分", badge: "页码", summary: "按页码导出一个 PDF 或逐页打包。", action: "拆分并下载", icon: Scissor },
  { key: "compress", label: "压缩", badge: "图片版", summary: "将每页重新渲染后生成更小的 PDF。", action: "压缩并下载", icon: CopyDocument },
  { key: "images_to_pdf", label: "图片转 PDF", badge: "IMG", summary: "把图片按顺序生成 PDF。", action: "生成 PDF", icon: Picture },
  { key: "pdf_to_images", label: "PDF 转图片", badge: "ZIP", summary: "把 PDF 页面导出为图片压缩包。", action: "导出图片", icon: Document },
  { key: "extract_text", label: "提取文字", badge: "TXT", summary: "提取 PDF 文本并保存为 TXT。", action: "提取文字", icon: Rank },
  { key: "rotate", label: "旋转", badge: "90°", summary: "按页码批量旋转 PDF 页面。", action: "旋转并下载", icon: RefreshLeft },
];

const needsLogin = computed(() => Boolean(props.requireLogin && !getToken()));
const activeModeMeta = computed(() => modeOptions.find((item) => item.key === activeMode.value) ?? modeOptions[0]);
const pdfFiles = computed(() => files.value.filter((item) => item.kind === "pdf"));
const imageFiles = computed(() => files.value.filter((item) => item.kind === "image"));
const activePdf = computed(() => {
  if (!pdfFiles.value.length) return null;
  return pdfFiles.value.find((item) => item.id === selectedPdfId.value) ?? pdfFiles.value[0];
});
const singlePdfMode = computed(() => ["split", "compress", "pdf_to_images", "extract_text", "rotate"].includes(activeMode.value));
const pageRangeMode = computed(() => ["split", "pdf_to_images", "extract_text", "rotate"].includes(activeMode.value));
const canRun = computed(() => {
  if (activeMode.value === "merge") return pdfFiles.value.length >= 2;
  if (activeMode.value === "images_to_pdf") return imageFiles.value.length >= 1;
  return Boolean(activePdf.value);
});
const requirementText = computed(() => {
  if (activeMode.value === "merge") return "至少添加 2 个 PDF。";
  if (activeMode.value === "images_to_pdf") return "至少添加 1 张图片。";
  return "选择一个 PDF 后即可处理。";
});

function goLogin() {
  router.push({ name: "login", query: { redirect: route.fullPath } });
}

function handleFileInput(event: Event) {
  const input = event.target as HTMLInputElement;
  addFiles(Array.from(input.files ?? []));
  input.value = "";
}

function handleDrop(event: DragEvent) {
  isDragging.value = false;
  addFiles(Array.from(event.dataTransfer?.files ?? []));
}

function addFiles(nextFiles: File[]) {
  const existing = new Set(files.value.map((item) => fileSignature(item.file)));
  const additions: LocalFile[] = [];
  for (const file of nextFiles) {
    const kind = detectFileKind(file);
    if (!kind) continue;
    const signature = fileSignature(file);
    if (existing.has(signature)) continue;
    existing.add(signature);
    const item = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, file, kind };
    additions.push(item);
    if (kind === "pdf") void inspectPdfPages(item);
  }
  if (!additions.length && nextFiles.length) {
    ElMessage.warning("请选择 PDF 或常见图片文件");
    return;
  }
  files.value = [...files.value, ...additions];
  if (!selectedPdfId.value && additions.some((item) => item.kind === "pdf")) {
    selectedPdfId.value = additions.find((item) => item.kind === "pdf")?.id ?? "";
  }
}

function removeFile(id: string) {
  files.value = files.value.filter((item) => item.id !== id);
  if (selectedPdfId.value === id) selectedPdfId.value = pdfFiles.value[0]?.id ?? "";
}

function moveFile(index: number, direction: -1 | 1) {
  const target = index + direction;
  if (target < 0 || target >= files.value.length) return;
  const copy = [...files.value];
  const [item] = copy.splice(index, 1);
  copy.splice(target, 0, item);
  files.value = copy;
}

async function inspectPdfPages(item: LocalFile) {
  try {
    const pdf = await loadPdfJs(item.file);
    item.pages = pdf.numPages;
    await pdf.destroy();
  } catch {
    item.pages = undefined;
  }
}

function detectFileKind(file: File): LocalFileKind | "" {
  const name = file.name.toLowerCase();
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (file.type.startsWith("image/") || /\.(png|jpe?g|webp|bmp)$/i.test(name)) return "image";
  return "";
}

function fileSignature(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

async function runTool() {
  if (!canRun.value || busy.value) return;
  busy.value = true;
  resultText.value = "";
  progressText.value = "处理中";
  try {
    if (activeMode.value === "merge") await mergePdfs();
    else if (activeMode.value === "split") await splitPdf();
    else if (activeMode.value === "compress") await compressPdf();
    else if (activeMode.value === "images_to_pdf") await imagesToPdf();
    else if (activeMode.value === "pdf_to_images") await pdfToImages();
    else if (activeMode.value === "extract_text") await extractText();
    else if (activeMode.value === "rotate") await rotatePdf();
    ElMessage.success("处理完成");
  } catch (error) {
    const message = error instanceof Error ? error.message : "处理失败";
    ElMessage.error(message);
    resultText.value = message;
  } finally {
    busy.value = false;
    progressText.value = "";
  }
}

async function mergePdfs() {
  const { PDFDocument } = await getPdfLib();
  const output = await PDFDocument.create();
  for (let index = 0; index < pdfFiles.value.length; index += 1) {
    const item = pdfFiles.value[index];
    progressText.value = `合并 ${index + 1}/${pdfFiles.value.length}`;
    const source = await PDFDocument.load(await item.file.arrayBuffer(), { ignoreEncryption: true });
    const pages = await output.copyPages(source, source.getPageIndices());
    pages.forEach((page) => output.addPage(page));
  }
  const bytes = await output.save();
  downloadBytes(bytes, "合并文件.pdf", "application/pdf");
  resultText.value = `已合并 ${pdfFiles.value.length} 个 PDF。`;
}

async function splitPdf() {
  const item = requireActivePdf();
  const { PDFDocument } = await getPdfLib();
  const source = await PDFDocument.load(await item.file.arrayBuffer(), { ignoreEncryption: true });
  const indexes = parsePageSelection(pageRange.value, source.getPageCount());
  if (splitOutput.value === "single") {
    const output = await PDFDocument.create();
    const pages = await output.copyPages(source, indexes);
    pages.forEach((page) => output.addPage(page));
    downloadBytes(await output.save(), `${baseName(item.file.name)}-选定页面.pdf`, "application/pdf");
    resultText.value = `已导出 ${indexes.length} 页。`;
    return;
  }

  const zip = await createZip();
  for (let i = 0; i < indexes.length; i += 1) {
    progressText.value = `拆分 ${i + 1}/${indexes.length}`;
    const output = await PDFDocument.create();
    const [page] = await output.copyPages(source, [indexes[i]]);
    output.addPage(page);
    zip.file(`${baseName(item.file.name)}-第${indexes[i] + 1}页.pdf`, await output.save());
  }
  downloadBlob(await zip.generateAsync({ type: "blob" }), `${baseName(item.file.name)}-拆分页.zip`);
  resultText.value = `已打包 ${indexes.length} 个页面 PDF。`;
}

async function rotatePdf() {
  const item = requireActivePdf();
  const { PDFDocument, degrees } = await getPdfLib();
  const doc = await PDFDocument.load(await item.file.arrayBuffer(), { ignoreEncryption: true });
  const pages = doc.getPages();
  const indexes = parsePageSelection(pageRange.value, pages.length);
  for (const index of indexes) {
    const page = pages[index];
    const current = page.getRotation().angle;
    page.setRotation(degrees((current + Number(rotateAngle.value)) % 360));
  }
  downloadBytes(await doc.save(), `${baseName(item.file.name)}-旋转.pdf`, "application/pdf");
  resultText.value = `已旋转 ${indexes.length} 页。`;
}

async function compressPdf() {
  const item = requireActivePdf();
  const { PDFDocument } = await getPdfLib();
  const source = await loadPdfJs(item.file);
  const output = await PDFDocument.create();
  for (let pageNumber = 1; pageNumber <= source.numPages; pageNumber += 1) {
    progressText.value = `压缩 ${pageNumber}/${source.numPages}`;
    const page = await source.getPage(pageNumber);
    const naturalViewport = page.getViewport({ scale: 1 });
    const canvas = await renderPdfPage(page, Number(compressScale.value));
    const blob = await canvasToBlob(canvas, "image/jpeg", Number(compressQuality.value) / 100);
    const image = await output.embedJpg(await blob.arrayBuffer());
    const pdfPage = output.addPage([naturalViewport.width, naturalViewport.height]);
    pdfPage.drawImage(image, { x: 0, y: 0, width: naturalViewport.width, height: naturalViewport.height });
    page.cleanup();
  }
  await source.destroy();
  downloadBytes(await output.save(), `${baseName(item.file.name)}-压缩.pdf`, "application/pdf");
  resultText.value = "已生成压缩 PDF。";
}

async function imagesToPdf() {
  const { PDFDocument } = await getPdfLib();
  const output = await PDFDocument.create();
  for (let index = 0; index < imageFiles.value.length; index += 1) {
    const item = imageFiles.value[index];
    progressText.value = `写入图片 ${index + 1}/${imageFiles.value.length}`;
    await addImagePage(output, item.file);
  }
  downloadBytes(await output.save(), "图片合成.pdf", "application/pdf");
  resultText.value = `已合成 ${imageFiles.value.length} 张图片。`;
}

async function pdfToImages() {
  const item = requireActivePdf();
  const source = await loadPdfJs(item.file);
  const indexes = parsePageSelection(pageRange.value, source.numPages);
  const zip = await createZip();
  const mime = imageOutputFormat.value === "jpg" ? "image/jpeg" : "image/png";
  const ext = imageOutputFormat.value === "jpg" ? "jpg" : "png";
  for (let i = 0; i < indexes.length; i += 1) {
    progressText.value = `导出图片 ${i + 1}/${indexes.length}`;
    const page = await source.getPage(indexes[i] + 1);
    const canvas = await renderPdfPage(page, Number(imageScale.value));
    const blob = await canvasToBlob(canvas, mime, 0.9);
    zip.file(`${baseName(item.file.name)}-第${indexes[i] + 1}页.${ext}`, blob);
    page.cleanup();
  }
  await source.destroy();
  downloadBlob(await zip.generateAsync({ type: "blob" }), `${baseName(item.file.name)}-图片.zip`);
  resultText.value = `已导出 ${indexes.length} 张图片。`;
}

async function extractText() {
  const item = requireActivePdf();
  const source = await loadPdfJs(item.file);
  const indexes = parsePageSelection(pageRange.value, source.numPages);
  const chunks: string[] = [];
  for (let i = 0; i < indexes.length; i += 1) {
    progressText.value = `提取 ${i + 1}/${indexes.length}`;
    const page = await source.getPage(indexes[i] + 1);
    const content = await page.getTextContent();
    const text = content.items
      .map((part: unknown) => typeof (part as { str?: unknown }).str === "string" ? (part as { str: string }).str : "")
      .filter(Boolean)
      .join(" ");
    chunks.push(`--- 第 ${indexes[i] + 1} 页 ---\n${text}`);
    page.cleanup();
  }
  await source.destroy();
  downloadBlob(new Blob([chunks.join("\n\n")], { type: "text/plain;charset=utf-8" }), `${baseName(item.file.name)}-文字.txt`);
  resultText.value = `已提取 ${indexes.length} 页文字。`;
}

function requireActivePdf() {
  if (!activePdf.value) throw new Error("请先选择一个 PDF");
  return activePdf.value;
}

async function addImagePage(doc: PdfDocumentInstance, file: File) {
  let bytes = await file.arrayBuffer();
  let image;
  const lower = file.name.toLowerCase();
  if (file.type === "image/png" || lower.endsWith(".png")) {
    image = await doc.embedPng(bytes);
  } else if (file.type === "image/jpeg" || /\.(jpg|jpeg)$/i.test(lower)) {
    image = await doc.embedJpg(bytes);
  } else {
    bytes = await rasterizeImageFile(file);
    image = await doc.embedJpg(bytes);
  }

  if (imagePdfFit.value === "a4") {
    const page = doc.addPage([595.28, 841.89]);
    const ratio = Math.min(515.28 / image.width, 761.89 / image.height);
    const width = image.width * ratio;
    const height = image.height * ratio;
    page.drawImage(image, { x: (595.28 - width) / 2, y: (841.89 - height) / 2, width, height });
    return;
  }

  const page = doc.addPage([image.width, image.height]);
  page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
}

async function rasterizeImageFile(file: File) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器无法处理图片");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvasToBlob(canvas, "image/jpeg", 0.92).then((blob) => blob.arrayBuffer());
}

async function loadPdfJs(file: File) {
  const pdfjsLib = await getPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  return pdfjsLib.getDocument({ data }).promise;
}

function getPdfLib() {
  pdfLibPromise ??= import("pdf-lib");
  return pdfLibPromise;
}

async function getPdfJs() {
  const pdfjsLib = await (pdfJsPromise ??= import("pdfjs-dist"));
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;
  return pdfjsLib;
}

async function createZip() {
  const Zip = await (jsZipPromise ??= import("jszip").then((module) => module.default));
  return new Zip();
}

async function renderPdfPage(page: Awaited<ReturnType<Awaited<ReturnType<typeof loadPdfJs>>["getPage"]>>, scale: number) {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器无法渲染 PDF");
  await page.render({ canvasContext: context, viewport }).promise;
  return canvas;
}

function parsePageSelection(input: string, total: number) {
  const text = input.trim();
  if (!text) return Array.from({ length: total }, (_, index) => index);
  const selected = new Set<number>();
  for (const part of text.split(",")) {
    const token = part.trim();
    if (!token) continue;
    const range = token.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (!validPage(start, total) || !validPage(end, total) || start > end) throw new Error("页码范围不正确");
      for (let page = start; page <= end; page += 1) selected.add(page - 1);
      continue;
    }
    const page = Number(token);
    if (!validPage(page, total)) throw new Error("页码范围不正确");
    selected.add(page - 1);
  }
  if (!selected.size) throw new Error("页码范围不正确");
  return Array.from(selected).sort((a, b) => a - b);
}

function validPage(page: number, total: number) {
  return Number.isInteger(page) && page >= 1 && page <= total;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("图片导出失败"));
    }, type, quality);
  });
}

function downloadBytes(bytes: Uint8Array, filename: string, type: string) {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  downloadBlob(new Blob([buffer], { type }), filename);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = safeDownloadName(filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function baseName(name: string) {
  return safeDownloadName(name.replace(/\.[^.]+$/, "")) || "PDF";
}

function safeDownloadName(name: string) {
  return name
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "download";
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}
</script>

<style scoped>
.pdf-tool-panel {
  display: grid;
  gap: 14px;
}

.pdf-login-panel {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) auto;
  gap: 14px;
  align-items: center;
  border: 1px solid #dbeafe;
  background: #f8fbff;
  border-radius: 10px;
  padding: 16px;
}

.pdf-login-panel > .el-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  color: #2563eb;
  background: #eff6ff;
  font-size: 24px;
}

.pdf-login-panel h3 {
  margin: 0;
  color: #111827;
  font-size: 16px;
}

.pdf-login-panel p {
  margin: 4px 0 0;
  color: #64748b;
  font-size: 13px;
}

.pdf-toolbar {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(124px, 1fr));
  gap: 8px;
}

.mode-button {
  min-height: 76px;
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  grid-template-rows: auto auto;
  gap: 4px 8px;
  align-items: center;
  border: 1px solid #e5eaf3;
  border-radius: 8px;
  background: #fff;
  color: #334155;
  cursor: pointer;
  font: inherit;
  text-align: left;
  padding: 11px 12px;
  transition: border-color 0.16s, box-shadow 0.16s, transform 0.16s;
}

.mode-button:hover,
.mode-button.active {
  border-color: #0f766e;
  box-shadow: 0 8px 20px rgba(15, 118, 110, 0.1);
}

.mode-button.active {
  background: #f0fdfa;
}

.mode-button .el-icon {
  grid-row: 1 / span 2;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  background: #f8fafc;
  color: #0f766e;
  font-size: 17px;
}

.mode-button span {
  color: #0f172a;
  font-size: 13px;
  font-weight: 700;
  min-width: 0;
}

.mode-button small {
  color: #94a3b8;
  font-size: 11px;
}

.pdf-workbench {
  display: grid;
  grid-template-columns: minmax(280px, 0.95fr) minmax(320px, 1.05fr);
  gap: 14px;
  align-items: start;
}

.upload-panel,
.settings-panel {
  border: 1px solid #e5eaf3;
  border-radius: 10px;
  background: #fff;
  padding: 14px;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}

.drop-zone {
  width: 100%;
  min-height: 132px;
  display: grid;
  place-items: center;
  gap: 7px;
  border: 1px dashed #b7c7d8;
  border-radius: 10px;
  background: #f8fafc;
  color: #475569;
  cursor: pointer;
  font: inherit;
  padding: 18px;
}

.drop-zone.dragging {
  border-color: #0f766e;
  background: #f0fdfa;
}

.drop-zone .el-icon {
  color: #0f766e;
  font-size: 28px;
}

.drop-zone strong {
  color: #0f172a;
  font-size: 15px;
}

.drop-zone span {
  color: #64748b;
  font-size: 12px;
}

.file-list {
  display: grid;
  gap: 8px;
  margin-top: 12px;
  max-height: 390px;
  overflow-y: auto;
}

.file-list.empty {
  border: 1px dashed #e5eaf3;
  border-radius: 8px;
}

.file-empty {
  padding: 22px;
  color: #94a3b8;
  text-align: center;
  font-size: 13px;
}

.file-row {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  min-height: 62px;
  padding: 9px;
  border: 1px solid #edf2f7;
  border-radius: 8px;
  background: #fff;
}

.file-kind {
  width: 44px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  color: #0f766e;
  background: #ccfbf1;
  font-size: 11px;
  font-weight: 800;
}

.file-kind.image {
  color: #92400e;
  background: #fef3c7;
}

.file-main {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.file-main b {
  color: #0f172a;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-main small {
  color: #64748b;
  font-size: 12px;
}

.file-actions {
  display: flex;
  gap: 4px;
}

.file-actions button {
  width: 30px;
  height: 30px;
  border: 1px solid #e5eaf3;
  border-radius: 8px;
  background: #fff;
  color: #64748b;
  cursor: pointer;
}

.file-actions button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.settings-panel {
  display: grid;
  gap: 14px;
}

.panel-heading {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
  padding-bottom: 12px;
  border-bottom: 1px solid #eef2f7;
}

.panel-heading h3 {
  margin: 0;
  color: #0f172a;
  font-size: 17px;
}

.panel-heading p {
  margin: 5px 0 0;
  color: #64748b;
  font-size: 13px;
  line-height: 1.6;
}

.panel-heading > span {
  flex: 0 0 auto;
  border-radius: 999px;
  background: #fffbeb;
  color: #b45309;
  padding: 5px 9px;
  font-size: 12px;
  font-weight: 700;
}

.control-grid {
  display: grid;
  gap: 10px;
}

.control-grid.two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.control-grid label {
  display: grid;
  gap: 6px;
  color: #334155;
  font-size: 13px;
  font-weight: 650;
}

.control-grid input,
.control-grid select {
  width: 100%;
  min-height: 40px;
  border: 1px solid #dbe3ed;
  border-radius: 8px;
  background: #fff;
  color: #0f172a;
  font: inherit;
  padding: 8px 10px;
  outline: none;
}

.control-grid input:focus,
.control-grid select:focus {
  border-color: #0f766e;
  box-shadow: 0 0 0 2px rgba(15, 118, 110, 0.11);
}

.run-button {
  min-height: 46px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px solid #0f766e;
  border-radius: 8px;
  background: #0f766e;
  color: #fff;
  cursor: pointer;
  font: inherit;
  font-weight: 750;
}

.run-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.result-strip {
  min-height: 42px;
  display: flex;
  gap: 8px;
  align-items: center;
  border-radius: 8px;
  background: #f8fafc;
  color: #64748b;
  padding: 10px 12px;
  font-size: 13px;
}

.result-strip.active {
  color: #0f766e;
  background: #f0fdfa;
}

@media (max-width: 900px) {
  .pdf-workbench {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .pdf-toolbar {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .mode-button {
    min-height: 72px;
    padding: 10px;
  }

  .file-row {
    grid-template-columns: 40px minmax(0, 1fr);
  }

  .file-actions {
    grid-column: 2;
  }

  .control-grid.two {
    grid-template-columns: 1fr;
  }

  .pdf-login-panel {
    grid-template-columns: 1fr;
  }
}
</style>
