import path from "node:path";
import { readFile } from "node:fs/promises";
import { prisma } from "../prisma";
import { getSiteConfig } from "./siteSettings";

const IMAGE_MARKDOWN_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const IMAGE_REVIEW_MAX_INLINE_BYTES = 6 * 1024 * 1024;
const IMAGE_REVIEW_POLL_INTERVAL_MS = 20_000;
const IMAGE_REVIEW_BATCH_SIZE = 3;

let pollerStarted = false;
let pollerRunning = false;

type Viewer = {
  userId?: number | null;
  role?: string | null;
} | null | undefined;

type ImageReviewDecision = {
  approved: boolean;
  reason: string;
  detail: string;
  riskLevel: "low" | "medium" | "high";
  model: string;
  endpoint: string;
};

export function startForumImageModerationPoller() {
  if (pollerStarted) return;
  pollerStarted = true;
  const tick = () => {
    if (pollerRunning) return;
    pollerRunning = true;
    moderatePendingForumImages()
      .catch((error) => {
        console.warn("[image-review] moderation tick failed", error);
      })
      .finally(() => {
        pollerRunning = false;
      });
  };
  setTimeout(tick, 5_000);
  setInterval(tick, IMAGE_REVIEW_POLL_INTERVAL_MS);
}

export function shouldRunImageReview() {
  const config = getSiteConfig();
  return Boolean(
    config.imageReviewEnabled
    && config.imageReviewApiKey.trim()
    && config.imageReviewModel.trim()
    && config.imageReviewApiUrl.trim(),
  );
}

export async function registerForumImageAsset(input: {
  url: string;
  localPath?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  createdById?: number | null;
}) {
  const normalizedUrl = normalizeForumImageUrl(input.url);
  if (!normalizedUrl) return null;
  const localPath = normalizeLocalUploadPath(input.localPath) || resolveForumImageLocalPath(normalizedUrl);
  if (!localPath) return null;
  const existing = await prisma.forumImageAsset.findUnique({
    where: { url: normalizedUrl },
    select: { id: true, status: true },
  });
  if (existing) {
    return prisma.forumImageAsset.update({
      where: { id: existing.id },
      data: {
        localPath,
        mimeType: input.mimeType ?? undefined,
        fileSize: input.fileSize ?? undefined,
        createdById: input.createdById ?? undefined,
      },
    });
  }
  const enabled = shouldRunImageReview();
  return prisma.forumImageAsset.create({
    data: {
      url: normalizedUrl,
      localPath,
      mimeType: input.mimeType || null,
      fileSize: input.fileSize ?? null,
      createdById: input.createdById ?? null,
      status: enabled ? "pending" : "approved",
      reviewedAt: enabled ? null : new Date(),
      reason: enabled ? null : "图片审核未启用",
      reviewModel: enabled ? null : "bypass",
      reviewEndpoint: enabled ? null : "disabled",
    },
  });
}

export async function ensureForumImageAssetsForContent(content: string, createdById?: number | null) {
  const urls = extractForumImageUrls(content);
  if (!urls.length) return [];
  const tasks = urls.map((url) => registerForumImageAsset({ url, createdById: createdById ?? null }));
  return Promise.all(tasks);
}

export async function moderatePendingForumImages() {
  if (!shouldRunImageReview()) return { processed: 0 };
  const now = new Date();
  const list = await prisma.forumImageAsset.findMany({
    where: {
      OR: [
        { status: "pending" },
        { status: "error", nextRetryAt: { lte: now } },
      ],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: IMAGE_REVIEW_BATCH_SIZE,
  });
  let processed = 0;
  for (const asset of list) {
    await moderateSingleForumImage(asset);
    processed += 1;
  }
  return { processed };
}

export async function decorateTopicForViewerWithImageModeration(topic: any, viewer?: Viewer) {
  return {
    ...topic,
    content: await renderModeratedContent(topic.content, viewer),
  };
}

export async function decorateReplyForViewerWithImageModeration(reply: any, viewer?: Viewer) {
  return {
    ...reply,
    content: await renderModeratedContent(reply.content, viewer),
  };
}

export async function renderModeratedContent(content: string, _viewer?: Viewer) {
  const matches = collectImageMarkdownMatches(content);
  if (!matches.length) return content;
  const localUrls = Array.from(new Set(matches.map((item) => normalizeForumImageUrl(item.url)).filter(Boolean) as string[]));
  if (!localUrls.length) return content;

  const rows = await prisma.forumImageAsset.findMany({
    where: { url: { in: localUrls } },
    select: { url: true, status: true, reason: true },
  });
  const rowMap = new Map(rows.map((row) => [row.url, row]));
  const missing = localUrls.filter((url) => !rowMap.has(url));
  if (missing.length) {
    await Promise.all(missing.map((url) => registerForumImageAsset({ url })));
    missing.forEach((url) => rowMap.set(url, { url, status: "pending", reason: null } as any));
  }

  let rendered = "";
  let lastIndex = 0;
  for (const match of matches) {
    rendered += content.slice(lastIndex, match.index);
    const normalizedUrl = normalizeForumImageUrl(match.url);
    const row = normalizedUrl ? rowMap.get(normalizedUrl) : null;
    rendered += rewriteImageMarkdown(match.raw, row?.status, row?.reason);
    lastIndex = match.index + match.raw.length;
  }
  rendered += content.slice(lastIndex);
  return rendered;
}

function rewriteImageMarkdown(raw: string, status?: string | null, reason?: string | null) {
  if (!shouldRunImageReview() && status !== "rejected") return raw;
  if (!status || status === "approved") return raw;
  if (status === "rejected") {
    return [
      "> 图片因违规暂时无法查看。",
      `> 原因：${String(reason || "未通过图片审核")}`,
    ].join("\n");
  }
  return "> 图片审核中，暂时不可查看。";
}

function collectImageMarkdownMatches(content: string) {
  const items: Array<{ raw: string; alt: string; url: string; index: number }> = [];
  for (const match of content.matchAll(IMAGE_MARKDOWN_RE)) {
    items.push({
      raw: match[0],
      alt: match[1] || "",
      url: match[2] || "",
      index: match.index ?? 0,
    });
  }
  return items;
}

function extractForumImageUrls(content: string) {
  return Array.from(new Set(
    collectImageMarkdownMatches(content)
      .map((item) => normalizeForumImageUrl(item.url))
      .filter(Boolean) as string[],
  ));
}

function normalizeForumImageUrl(input: string | null | undefined) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  if (raw.startsWith("/uploads/")) return raw.split("?")[0];
  if (!/^https?:\/\//i.test(raw)) return "";
  try {
    const url = new URL(raw);
    return url.pathname.startsWith("/uploads/") ? url.pathname : "";
  } catch {
    return "";
  }
}

function resolveForumImageLocalPath(url: string) {
  const normalized = normalizeForumImageUrl(url);
  if (!normalized.startsWith("/uploads/")) return "";
  const uploadRoot = path.resolve(process.cwd(), "uploads");
  const relative = normalized.replace(/^\/uploads\/+/, "");
  const absolute = path.resolve(uploadRoot, relative);
  if (!(absolute === uploadRoot || absolute.startsWith(uploadRoot + path.sep))) return "";
  return absolute;
}

function normalizeLocalUploadPath(input: string | null | undefined) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  return path.resolve(raw);
}

async function moderateSingleForumImage(asset: {
  id: number;
  url: string;
  localPath: string;
  mimeType: string | null;
  attemptCount: number;
}) {
  const now = new Date();
  await prisma.forumImageAsset.update({
    where: { id: asset.id },
    data: {
      lastAttemptAt: now,
      attemptCount: { increment: 1 },
      status: "pending",
      lastError: null,
    },
  });
  try {
    const buffer = await readFile(asset.localPath);
    if (!buffer.length || buffer.length > IMAGE_REVIEW_MAX_INLINE_BYTES) {
      throw new Error(buffer.length ? "图片文件过大，无法送审" : "图片文件为空");
    }
    const mimeType = resolveMimeType(asset.mimeType, asset.localPath, buffer);
    if (!mimeType) throw new Error("图片格式暂不支持审核");
    const decision = await requestImageReview({
      url: asset.url,
      localPath: asset.localPath,
      mimeType,
      dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`,
    });
    await prisma.forumImageAsset.update({
      where: { id: asset.id },
      data: {
        status: decision.approved ? "approved" : "rejected",
        reason: decision.reason,
        detail: decision.detail,
        reviewModel: decision.model,
        reviewEndpoint: decision.endpoint,
        reviewedAt: new Date(),
        nextRetryAt: null,
        lastError: null,
      },
    });
  } catch (error: any) {
    const delayMinutes = Math.min(60, Math.max(3, asset.attemptCount * 5 || 3));
    await prisma.forumImageAsset.update({
      where: { id: asset.id },
      data: {
        status: "error",
        lastError: String(error?.message || error || "图片审核失败").slice(0, 500),
        nextRetryAt: new Date(Date.now() + delayMinutes * 60 * 1000),
      },
    });
  }
}

async function requestImageReview(input: {
  url: string;
  localPath: string;
  mimeType: string;
  dataUrl: string;
}): Promise<ImageReviewDecision> {
  const config = getSiteConfig();
  const endpoint = normalizeImageReviewApiUrl(config.imageReviewApiUrl);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.imageReviewApiKey}`,
    },
    body: JSON.stringify({
      model: config.imageReviewModel,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: config.imageReviewSystemPrompt },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: renderPromptTemplate(config.imageReviewUserPrompt, {
                imageUrl: input.url,
                mimeType: input.mimeType,
                fileName: path.basename(input.localPath),
              }),
            },
            {
              type: "image_url",
              image_url: {
                url: input.dataUrl,
                detail: "low",
              },
            },
          ],
        },
      ],
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`图片审核请求失败：${response.status}${text ? ` ${text.slice(0, 200)}` : ""}`);
  }
  const json: any = await response.json();
  const content = extractChatCompletionContent(json);
  const parsed = parseImageReviewJson(content);
  return {
    approved: Boolean(parsed.approved),
    reason: String(parsed.reason || (parsed.approved ? "图片审核通过" : "图片未通过审核")).slice(0, 120),
    detail: String(parsed.detail || "").slice(0, 1200),
    riskLevel: normalizeRiskLevel(parsed.risk_level),
    model: config.imageReviewModel,
    endpoint,
  };
}

function normalizeImageReviewApiUrl(input: string) {
  const raw = String(input || "").trim();
  if (!raw) return "https://api.openai.com/v1/chat/completions";
  if (/\/chat\/completions\/?$/i.test(raw)) return raw.replace(/\/+$/, "");
  if (/\/v1\/?$/i.test(raw)) return `${raw.replace(/\/+$/, "")}/chat/completions`;
  if (/^https?:\/\/[^/]+$/i.test(raw)) return `${raw.replace(/\/+$/, "")}/v1/chat/completions`;
  return raw.replace(/\/+$/, "");
}

function extractChatCompletionContent(json: any) {
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item?.text === "string") return item.text;
        if (typeof item?.content === "string") return item.content;
        return "";
      })
      .join("\n");
  }
  return "";
}

function parseImageReviewJson(content: string) {
  if (!content || typeof content !== "string") throw new Error("图片审核返回为空");
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        /* ignore */
      }
    }
    throw new Error("图片审核返回格式异常");
  }
}

function renderPromptTemplate(template: string, vars: Record<string, unknown>) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => stringifyPromptValue(vars[key]));
}

function stringifyPromptValue(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function resolveMimeType(inputMime: string | null | undefined, filePath: string, buffer: Buffer) {
  const normalized = String(inputMime || "").trim().toLowerCase();
  if (["image/jpeg", "image/png", "image/webp", "image/gif"].includes(normalized)) return normalized;
  const ext = path.extname(filePath).replace(/^\./, "").toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (buffer.length >= 6) {
    const head = buffer.subarray(0, 6).toString("ascii");
    if (head === "GIF87a" || head === "GIF89a") return "image/gif";
  }
  return "";
}

function normalizeRiskLevel(value: unknown): "low" | "medium" | "high" {
  if (value === "low" || value === "medium" || value === "high") return value;
  return "medium";
}
