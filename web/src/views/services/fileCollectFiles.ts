export type FileCollectFileAction = "download" | "preview";

export type FileCollectFileAccess = {
  backend: "local" | "onedrive-cn";
  url: string;
  viewer?: "office" | "onedrive" | null;
  previewMessage?: string;
  filename?: string;
  mimeType?: string;
};

export async function fetchFileCollectBlob(id: number, action: FileCollectFileAction) {
  const response = await fetch(`/api/tools/file-collection-files/${id}/${action}`, {
    credentials: "same-origin",
  });
  if (!response.ok) {
    const fallback = action === "preview" ? "预览失败" : "下载失败";
    let message = await response.text().catch(() => "");
    try {
      const parsed = JSON.parse(message);
      message = parsed?.message || message;
    } catch {
      // Non-JSON error body; use the raw text if present.
    }
    throw new Error(message || fallback);
  }
  return response.blob();
}

export async function fetchFileCollectAccess(id: number, action: FileCollectFileAction) {
  const response = await fetch(`/api/tools/file-collection-files/${id}/access?action=${action}`, {
    credentials: "same-origin",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || (action === "preview" ? "预览失败" : "下载失败"));
  }
  return payload as FileCollectFileAccess;
}

export function openDirectFileAccess(url: string, filename: string, action: FileCollectFileAction) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.rel = "noopener noreferrer";
  if (action === "preview") anchor.target = "_blank";
  if (action === "download" && filename) anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function requestMessage(error: unknown) {
  if (typeof error === "object" && error !== null) {
    const responseMessage = (error as { response?: { data?: { message?: unknown } } }).response?.data?.message;
    if (typeof responseMessage === "string") return responseMessage;
  }
  return error instanceof Error ? error.message : "";
}
