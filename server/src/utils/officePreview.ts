import type { Request } from "express";
import jwt from "jsonwebtoken";
import path from "node:path";
import { config } from "../config";

const OFFICE_PREVIEW_EXTENSIONS = new Set([
  "doc",
  "docx",
  "ppt",
  "pptx",
  "pps",
  "ppsx",
  "xls",
  "xlsx",
]);

const FILE_COLLECT_PREVIEW_PURPOSE = "file-collect-office-preview";
const FILE_COLLECT_PREVIEW_EXPIRES_IN = "30m";

type FileCollectPreviewTokenPayload = {
  purpose: typeof FILE_COLLECT_PREVIEW_PURPOSE;
  fileId: number;
  path: string;
};

export function isOfficePreviewFile(filename: string) {
  const ext = path.extname(filename || "").replace(/^\./, "").toLowerCase();
  return OFFICE_PREVIEW_EXTENSIONS.has(ext);
}

export function buildOfficeViewerUrl(sourceUrl: string) {
  return `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(sourceUrl)}`;
}

export function requestPublicOrigin(req: Request) {
  const proto = String(req.headers["x-forwarded-proto"] ?? req.protocol ?? "https").split(",")[0].trim() || "https";
  const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "").split(",")[0].trim();
  return host ? `${proto}://${host}` : "";
}

export function signFileCollectPreviewToken(file: { id: number; path: string }) {
  return jwt.sign({
    purpose: FILE_COLLECT_PREVIEW_PURPOSE,
    fileId: file.id,
    path: file.path,
  } satisfies FileCollectPreviewTokenPayload, config.jwtSecret, { expiresIn: FILE_COLLECT_PREVIEW_EXPIRES_IN });
}

export function verifyFileCollectPreviewToken(token: string, expected: { id: number; path: string }) {
  try {
    const payload = jwt.verify(String(token || ""), config.jwtSecret) as Partial<FileCollectPreviewTokenPayload>;
    return payload.purpose === FILE_COLLECT_PREVIEW_PURPOSE
      && payload.fileId === expected.id
      && payload.path === expected.path;
  } catch {
    return false;
  }
}
