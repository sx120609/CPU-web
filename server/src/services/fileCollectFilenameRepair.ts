import path from "node:path";
import { prisma } from "../prisma";
import { uploadOriginalNameRepairCandidate } from "../utils/uploadFilename";

export type FileCollectFilenameRepairResult = {
  total: number;
  updated: number;
  unchanged: number;
  unrecoverable: number;
  samples: Array<{
    id: number;
    beforeOriginalName: string;
    afterOriginalName: string;
    beforeStoredName: string;
    afterStoredName: string;
  }>;
};

function parseJsonObject(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value ?? "")]));
  } catch {
    return {};
  }
}

function safeStoredFilename(value: string) {
  const cleaned = String(value || "")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[. ]+|[. ]+$/g, "")
    .slice(0, 160);
  return cleaned || "file";
}

function renderStoredName(template: string, data: Record<string, string>, originalName: string, index: number, total: number) {
  const ext = path.extname(originalName || "").toLowerCase();
  const stem = path.basename(originalName || "file", path.extname(originalName || ""));
  const values: Record<string, string> = {
    ...Object.fromEntries(Object.entries(data).map(([key, value]) => [key, safeStoredFilename(value)])),
    original: safeStoredFilename(stem),
    index: total > 1 ? String(index) : "",
  };
  const rendered = String(template || "{name}-{student_id}").replace(/\{([a-zA-Z0-9_\u4e00-\u9fa5]+)(?:\|(last|first):(\d{1,2}))?\}/g, (_match, key, op, rawCount) => {
    const value = values[key] || "";
    const count = Number(rawCount || 0);
    if (op === "last") return count > 0 ? value.slice(-count) : "";
    if (op === "first") return count > 0 ? value.slice(0, count) : "";
    return value;
  });
  const base = safeStoredFilename(rendered).replace(/[-_ ]{2,}/g, "-").replace(/^[\s\-_.]+|[\s\-_.]+$/g, "") || "file";
  const withIndex = total > 1 && !template.includes("{index}") ? `${base}-${index}` : base;
  return `${withIndex}${ext}`;
}

export async function repairFileCollectTaskFilenames(taskId: number): Promise<FileCollectFilenameRepairResult> {
  const task = await prisma.fileCollectTask.findUnique({
    where: { id: taskId },
    include: {
      submissions: {
        where: { status: "submitted" },
        orderBy: { id: "asc" },
        include: { files: { orderBy: { id: "asc" } } },
      },
    },
  });
  if (!task) {
    return { total: 0, updated: 0, unchanged: 0, unrecoverable: 0, samples: [] };
  }

  const result: FileCollectFilenameRepairResult = {
    total: 0,
    updated: 0,
    unchanged: 0,
    unrecoverable: 0,
    samples: [],
  };

  for (const submission of task.submissions) {
    const data = parseJsonObject(submission.data);
    const total = submission.files.length;
    for (let index = 0; index < submission.files.length; index += 1) {
      const file = submission.files[index];
      result.total += 1;
      const candidate = uploadOriginalNameRepairCandidate(file.originalName);
      if (!candidate.changed) {
        if (candidate.probablyLost) result.unrecoverable += 1;
        else result.unchanged += 1;
        continue;
      }

      const storedName = renderStoredName(task.renameTemplate, data, candidate.repaired, index + 1, total);
      await prisma.fileCollectFile.update({
        where: { id: file.id },
        data: {
          originalName: candidate.repaired,
          storedName,
        },
      });
      result.updated += 1;
      if (result.samples.length < 20) {
        result.samples.push({
          id: file.id,
          beforeOriginalName: file.originalName,
          afterOriginalName: candidate.repaired,
          beforeStoredName: file.storedName,
          afterStoredName: storedName,
        });
      }
    }
  }

  return result;
}
