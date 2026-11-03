// 课表背景图的明暗适配：换图时把图缩成 64×64 采样，按当前深浅色算出遮罩要多浓，
// 课表上的文字才看得清（主要文字对比度不低于约 4.5:1），又不会无谓地把图盖死。
// 遮罩在浏览器里按 sRGB 数值混合（CSS 的 rgba 叠加就是这样），这里照同样的算法逐像素混合再看亮度。

/** 和 useScheduleBackground 的可见度滑块一致：遮罩 0.12…0.78。 */
export const OVERLAY_MIN = 0.12;
export const OVERLAY_MAX = 0.78;
const OVERLAY_STEP = 0.02;

/** 浅色遮罩 rgba(248, 251, 255, op)；深色遮罩 rgba(14, 16, 18, max(0.22, op × 0.58))，见 pageVars.ts。 */
const LIGHT_VEIL = [248, 251, 255] as const;
const DARK_VEIL = [14, 16, 18] as const;

/** 浅色下深色文字（#172033）要 4.5:1，背景相对亮度至少约 0.24；留点余量。 */
const LIGHT_MIN_LUMINANCE = 0.3;
/** 深色下浅色文字（#eceef1）要 4.5:1，背景相对亮度至多约 0.15。 */
const DARK_MAX_LUMINANCE = 0.15;

function linear(channel: number) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(red: number, green: number, blue: number) {
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

function percentile(values: number[], fraction: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(fraction * (sorted.length - 1))))];
}

function darkVeilAlpha(opacity: number) {
  return Math.max(0.22, opacity * 0.58);
}

/** RGBA 像素（每 4 个数一个像素）。 */
function blendedLuminances(pixels: ArrayLike<number>, veil: readonly number[], alpha: number) {
  const out: number[] = [];
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    // 透明像素后面是课表页的底色，不算。
    if (pixels[index + 3] < 16) continue;
    out.push(relativeLuminance(
      veil[0] * alpha + pixels[index] * (1 - alpha),
      veil[1] * alpha + pixels[index + 1] * (1 - alpha),
      veil[2] * alpha + pixels[index + 2] * (1 - alpha),
    ));
  }
  return out;
}

/**
 * 推荐的遮罩不透明度：满足对比度的最淡一档。浅色看图里最暗的那一小部分（第 15 百分位），
 * 深色看最亮的那一小部分（第 85 百分位），不让局部的暗块或亮块吃掉文字。做不到就用最浓的一档。
 */
export function recommendBackgroundOverlay(pixels: ArrayLike<number>, dark: boolean) {
  for (let step = 0; ; step += 1) {
    const opacity = Math.min(OVERLAY_MAX, Math.round((OVERLAY_MIN + step * OVERLAY_STEP) * 100) / 100);
    const values = dark
      ? blendedLuminances(pixels, DARK_VEIL, darkVeilAlpha(opacity))
      : blendedLuminances(pixels, LIGHT_VEIL, opacity);
    if (!values.length) return null;
    const ok = dark
      ? percentile(values, 0.85) <= DARK_MAX_LUMINANCE
      : percentile(values, 0.15) >= LIGHT_MIN_LUMINANCE;
    if (ok || opacity >= OVERLAY_MAX) return opacity;
  }
}

/** 把图片缩成 64×64 读出像素；读不了（格式不支持、跨域）就返回 null。 */
export async function sampleImagePixels(source: Blob): Promise<Uint8ClampedArray | null> {
  try {
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    if (typeof createImageBitmap === "function") {
      const bitmap = await createImageBitmap(source);
      context.drawImage(bitmap, 0, 0, size, size);
      bitmap.close?.();
    } else {
      const url = URL.createObjectURL(source);
      try {
        const image = new Image();
        image.src = url;
        await image.decode();
        context.drawImage(image, 0, 0, size, size);
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    return context.getImageData(0, 0, size, size).data;
  } catch {
    return null;
  }
}
