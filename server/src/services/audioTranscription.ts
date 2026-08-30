import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { normalizeAiJsonApiUrl } from "./aiJsonApi";
import {
  getSiteConfig,
  isOllamaAiProvider,
  resolveAiServiceCandidatesForScene,
} from "./siteSettings";

const execFile = promisify(execFileCallback);
const AUDIO_TRANSCRIBE_MODEL = "whisper-1";
const AUDIO_TRANSCRIBE_TIMEOUT_MS = 90_000;
const AUDIO_SOURCE_MAX_BYTES = 15 * 1024 * 1024;

export async function transcribeAudioBuffer(
  source: Buffer,
  options?: { extension?: string; language?: string },
) {
  if (!source.length) throw new Error("语音内容为空");
  if (source.length > AUDIO_SOURCE_MAX_BYTES) throw new Error("语音内容超过 15MB 限制");

  const providers = resolveAiServiceCandidatesForScene(getSiteConfig(), "assistant")
    .filter((provider) => !isOllamaAiProvider(provider.provider) && String(provider.apiUrl || "").trim());
  if (!providers.length) throw new Error("当前 AI 服务没有可用的语音转写接口");

  const runtimeDir = path.resolve(process.cwd(), "runtime", "audio-transcription");
  await mkdir(runtimeDir, { recursive: true });
  const token = randomUUID();
  const extension = normalizeAudioExtension(options?.extension);
  const inputPath = path.join(runtimeDir, `${token}.${extension}`);
  const outputPath = path.join(runtimeDir, `${token}.wav`);
  try {
    await writeFile(inputPath, source);
    await execFile("ffmpeg", [
      "-y",
      "-i",
      inputPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-acodec",
      "pcm_s16le",
      outputPath,
    ]);
    const audio = await readFile(outputPath);
    if (!audio.length) throw new Error("语音转码后内容为空");

    let lastError: unknown = null;
    for (const provider of providers) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), AUDIO_TRANSCRIBE_TIMEOUT_MS);
      try {
        const form = new FormData();
        form.append("model", AUDIO_TRANSCRIBE_MODEL);
        form.append("response_format", "json");
        if (options?.language) form.append("language", options.language);
        form.append("file", new Blob([new Uint8Array(audio)], { type: "audio/wav" }), "wechat-voice.wav");
        const response = await fetch(normalizeAudioTranscriptionsUrl(provider.apiUrl), {
          method: "POST",
          headers: { Authorization: `Bearer ${provider.apiKey}` },
          body: form,
          signal: controller.signal,
        });
        if (!response.ok) {
          const detail = await response.text().catch(() => "");
          throw new Error(`语音转写失败：${response.status}${detail ? ` ${detail.slice(0, 160)}` : ""}`);
        }
        const payload = await response.json() as { text?: unknown };
        const text = String(payload.text || "").trim();
        if (!text) throw new Error("语音转写结果为空");
        return text;
      } catch (error) {
        lastError = error;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError instanceof Error ? lastError : new Error("语音转写失败");
  } finally {
    await Promise.all([
      rm(inputPath, { force: true }).catch(() => undefined),
      rm(outputPath, { force: true }).catch(() => undefined),
    ]);
  }
}

export function normalizeAudioTranscriptionsUrl(input: string) {
  return normalizeAiJsonApiUrl(input, "https://api.openai.com/v1/chat/completions")
    .replace(/\/(?:chat\/completions|responses)$/iu, "/audio/transcriptions");
}

function normalizeAudioExtension(value: string | undefined) {
  const normalized = String(value || "amr").trim().toLowerCase().replace(/^\./u, "");
  return /^[a-z0-9]{1,8}$/u.test(normalized) ? normalized : "amr";
}
