import path from "node:path";

function uploadBasename(value: string) {
  return path.posix.basename(value.replace(/\\/g, "/")).trim();
}

function filenameScore(value: string) {
  let score = 0;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (char === "\uFFFD") score -= 50;
    else if (code < 32 || (code >= 0x80 && code <= 0x9f)) score -= 20;
    else if (code >= 0x4e00 && code <= 0x9fff) score += 6;
    else if (/[\p{Letter}\p{Number}]/u.test(char)) score += 2;
    else if (/[\s._()（）\-\[\]]/u.test(char)) score += 1;
  }
  if (/[\u00c2-\u00f4][\u0080-\u00bf]/.test(value)) score -= 20;
  return score;
}

export function normalizeUploadOriginalName(value: unknown) {
  const raw = uploadBasename(String(value ?? ""));
  if (!raw) return "file";

  const decoded = uploadBasename(Buffer.from(raw, "latin1").toString("utf8"));
  if (
    decoded &&
    !decoded.includes("\uFFFD") &&
    filenameScore(decoded) > filenameScore(raw) + 5
  ) {
    return decoded;
  }

  return raw;
}

export function uploadOriginalNameRepairCandidate(value: unknown) {
  const raw = uploadBasename(String(value ?? ""));
  if (!raw) return { raw: "file", repaired: "file", changed: false, probablyLost: false };
  const repaired = normalizeUploadOriginalName(raw);
  return {
    raw,
    repaired,
    changed: repaired !== raw,
    probablyLost: repaired === raw && /[?�]/.test(raw),
  };
}

export function normalizeMulterOriginalNames<T extends { originalname: string }>(files: T[]) {
  for (const file of files) {
    file.originalname = normalizeUploadOriginalName(file.originalname);
  }
  return files;
}
