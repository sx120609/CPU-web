import { cdnImageUrl } from "./cdnMedia";

export function preloadAvatar(source: string | null | undefined, timeoutMs = 10000): Promise<boolean> {
  const url = cdnImageUrl(source, { width: 240, quality: 84 });
  if (!url) return Promise.resolve(false);
  return new Promise((resolve) => {
    const image = new Image();
    let settled = false;
    const finish = (loaded: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      resolve(loaded);
    };
    const timer = window.setTimeout(() => finish(false), timeoutMs);
    image.onload = () => finish(image.naturalWidth > 0);
    image.onerror = () => finish(false);
    image.src = url;
  });
}
