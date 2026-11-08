import { ref } from "vue";
import { agendaExtractApi, type AgendaExtractResult } from "@/api/agenda";
import { compressImageFile } from "@/utils/imageUpload";

/**
 * 截图识别日程：截图压成拾间AI 看得清的大小再发出去。长截图（通知常常是一整屏往下拉）保留
 * 宽度、按高度缩，所以宽最多 1280、高最多 4096（服务端也是 4096）。
 */
const MAX_WIDTH = 1280;
const MAX_HEIGHT = 4096;
const MAX_BYTES = 2_500_000;
/** 粘贴进标题的文字超过这么长，就当成一整段通知交给拾间AI 整理。 */
export const AGENDA_NOTICE_PASTE_CHARS = 60;

export async function extractAgendaFromImage(file: File): Promise<AgendaExtractResult> {
  const image = await compressImageFile(file, {
    maxWidth: MAX_WIDTH,
    maxHeight: MAX_HEIGHT,
    quality: 0.88,
    mimeType: "image/jpeg",
    maxBytes: MAX_BYTES,
  });
  return agendaExtractApi.extract({ image });
}

export function extractAgendaFromText(text: string): Promise<AgendaExtractResult> {
  return agendaExtractApi.extract({ text: text.trim().slice(0, 4000) });
}

export function agendaExtractError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/timeout|network/iu.test(message)) return "拾间AI 没来得及回复，稍后再试";
  return message || "没能识别，稍后再试";
}

/** 日程面板里选好的截图或粘贴的通知，交给接着打开的编辑器去识别。 */
export const pendingAgendaSource = ref<{ image?: File; text?: string } | null>(null);

/** 粘贴板里的图片；没有时为 null。 */
export function pastedImage(event: ClipboardEvent) {
  const items = Array.from(event.clipboardData?.items ?? []);
  for (const item of items) {
    if (item.kind === "file" && item.type.startsWith("image/")) return item.getAsFile();
  }
  return null;
}
