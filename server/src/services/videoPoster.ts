import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { saveMediaAsset } from "./mediaStorage";

const execFile = promisify(execFileCallback);

export async function createVideoPosterAsset(input: {
  videoLocalPath: string;
  videoRelativePath: string;
}) {
  const normalizedRelative = String(input.videoRelativePath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalizedRelative) return "";
  const parsed = path.posix.parse(normalizedRelative);
  const tempDir = path.resolve(process.cwd(), "runtime", "video-posters");
  await mkdir(tempDir, { recursive: true });
  const tempPosterPath = path.join(tempDir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`);
  try {
    await execFile("ffmpeg", [
      "-y",
      "-ss",
      "0.35",
      "-i",
      input.videoLocalPath,
      "-frames:v",
      "1",
      "-q:v",
      "4",
      tempPosterPath,
    ]);
    const buffer = await readFile(tempPosterPath).catch(() => null);
    if (!buffer?.length) return "";
    const saved = await saveMediaAsset({
      relativePath: path.posix.join(parsed.dir, `${parsed.name}-poster.jpg`),
      buffer,
      contentType: "image/jpeg",
      mediaKind: "image",
    });
    return saved.url;
  } catch {
    return "";
  } finally {
    await rm(tempPosterPath, { force: true }).catch(() => null);
  }
}
