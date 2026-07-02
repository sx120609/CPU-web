import { computed, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import {
  clearScheduleBackgroundBlob,
  readScheduleBackgroundBlob,
  saveScheduleBackgroundBlob,
} from "@/utils/scheduleBackgroundStorage";
import type { ScheduleBackgroundSettings } from "./types";

const BACKGROUND_KEY = "cpu-schedule-background-v1";

export function useScheduleBackground() {
  const backgroundImageInputRef = ref<HTMLInputElement | null>(null);
  const backgroundSaving = ref(false);
  const scheduleBackground = reactive<ScheduleBackgroundSettings>(createDefaultScheduleBackground());
  let scheduleBackgroundPreviewUrl = "";

  const hasScheduleBackground = computed(() => Boolean(scheduleBackground.imageDataUrl));
  const backgroundVisibility = computed(() => Math.round((1 - scheduleBackground.overlayOpacity) * 100));
  const backgroundPreviewStyle = computed(() => (
    hasScheduleBackground.value
      ? {
          backgroundImage: `linear-gradient(180deg, rgba(248, 251, 255, ${scheduleBackground.overlayOpacity}) 0%, rgba(248, 251, 255, ${Math.min(0.92, scheduleBackground.overlayOpacity + 0.1)}) 100%), url("${scheduleBackground.imageDataUrl}")`,
          filter: `blur(${scheduleBackground.blur}px)`,
        }
      : {}
  ));

  function createDefaultScheduleBackground(): ScheduleBackgroundSettings {
    return {
      imageDataUrl: "",
      overlayOpacity: 0.34,
      blur: 0,
    };
  }

  function normalizeScheduleBackground(input: unknown): ScheduleBackgroundSettings {
    const data = (input && typeof input === "object") ? input as Partial<ScheduleBackgroundSettings> : {};
    return {
      imageDataUrl: typeof data.imageDataUrl === "string" ? data.imageDataUrl : "",
      overlayOpacity: clampNumber(data.overlayOpacity, 0.34, 0.12, 0.78),
      blur: Math.round(clampNumber(data.blur, 0, 0, 18)),
    };
  }

  function applyScheduleBackground(next: ScheduleBackgroundSettings) {
    scheduleBackground.imageDataUrl = next.imageDataUrl;
    scheduleBackground.overlayOpacity = next.overlayOpacity;
    scheduleBackground.blur = next.blur;
  }

  function snapshotScheduleBackgroundSettings() {
    return {
      overlayOpacity: scheduleBackground.overlayOpacity,
      blur: scheduleBackground.blur,
    };
  }

  function setScheduleBackgroundPreview(url: string) {
    clearScheduleBackgroundPreview();
    scheduleBackgroundPreviewUrl = url.startsWith("blob:") ? url : "";
    scheduleBackground.imageDataUrl = url;
  }

  function clearScheduleBackgroundPreview() {
    if (scheduleBackgroundPreviewUrl) {
      URL.revokeObjectURL(scheduleBackgroundPreviewUrl);
      scheduleBackgroundPreviewUrl = "";
    }
    scheduleBackground.imageDataUrl = "";
  }

  async function restoreScheduleBackground() {
    let legacyImageDataUrl = "";
    try {
      const raw = localStorage.getItem(BACKGROUND_KEY);
      if (raw) {
        const normalized = normalizeScheduleBackground(JSON.parse(raw));
        legacyImageDataUrl = normalized.imageDataUrl;
        applyScheduleBackground({
          imageDataUrl: "",
          overlayOpacity: normalized.overlayOpacity,
          blur: normalized.blur,
        });
      } else {
        applyScheduleBackground(createDefaultScheduleBackground());
      }
    } catch {
      applyScheduleBackground(createDefaultScheduleBackground());
    }
    try {
      const storedBlob = await readScheduleBackgroundBlob();
      if (storedBlob) {
        setScheduleBackgroundPreview(URL.createObjectURL(storedBlob));
        return;
      }
    } catch {
      /* ignore */
    }
    if (!legacyImageDataUrl) return;
    setScheduleBackgroundPreview(legacyImageDataUrl);
    try {
      const migratedBlob = await dataUrlToBlob(legacyImageDataUrl);
      await saveScheduleBackgroundBlob(migratedBlob);
      setScheduleBackgroundPreview(URL.createObjectURL(migratedBlob));
      persistScheduleBackground();
    } catch {
      /* keep legacy preview */
    }
  }

  function persistScheduleBackground() {
    if (!scheduleBackground.imageDataUrl) {
      localStorage.removeItem(BACKGROUND_KEY);
      return;
    }
    const payload = JSON.stringify(snapshotScheduleBackgroundSettings());
    localStorage.setItem(BACKGROUND_KEY, payload);
  }

  function persistScheduleBackgroundSafe(message = "背景设置保存失败，请稍后重试") {
    try {
      persistScheduleBackground();
      return true;
    } catch {
      ElMessage.warning(message);
      return false;
    }
  }

  function pickScheduleBackground() {
    backgroundImageInputRef.value?.click();
  }

  async function onScheduleBackgroundPicked(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      ElMessage.warning("请选择图片文件");
      return;
    }
    backgroundSaving.value = true;
    try {
      await saveScheduleBackgroundBlob(file);
      setScheduleBackgroundPreview(URL.createObjectURL(file));
      persistScheduleBackgroundSafe();
      ElMessage.success(file.size > 6 * 1024 * 1024 ? "已设置课表背景，大图首次显示可能会稍慢" : "已设置课表背景");
    } catch (error: any) {
      ElMessage.warning(String(error?.message || "背景保存失败，可能是浏览器本地空间不足"));
    } finally {
      backgroundSaving.value = false;
    }
  }

  async function clearScheduleBackground() {
    if (!hasScheduleBackground.value || backgroundSaving.value) return;
    backgroundSaving.value = true;
    try {
      await clearScheduleBackgroundBlob();
      applyScheduleBackground(createDefaultScheduleBackground());
      clearScheduleBackgroundPreview();
      persistScheduleBackgroundSafe("清除背景失败，请稍后重试");
      ElMessage.success("已清除课表背景");
    } catch {
      ElMessage.warning("清除背景失败，请稍后重试");
    } finally {
      backgroundSaving.value = false;
    }
  }

  function onBackgroundVisibilityInput(event: Event) {
    const target = event.target as HTMLInputElement;
    const next = Math.max(22, Math.min(88, Number(target.value) || 0));
    scheduleBackground.overlayOpacity = clampNumber(1 - next / 100, 0.34, 0.12, 0.78);
    persistScheduleBackgroundSafe("背景设置保存失败");
  }

  function onBackgroundBlurInput(event: Event) {
    const target = event.target as HTMLInputElement;
    scheduleBackground.blur = Math.round(clampNumber(target.value, scheduleBackground.blur, 0, 18));
    persistScheduleBackgroundSafe("背景设置保存失败");
  }

  return {
    backgroundImageInputRef,
    backgroundPreviewStyle,
    backgroundSaving,
    backgroundVisibility,
    clearScheduleBackground,
    clearScheduleBackgroundPreview,
    hasScheduleBackground,
    onBackgroundBlurInput,
    onBackgroundVisibilityInput,
    onScheduleBackgroundPicked,
    pickScheduleBackground,
    restoreScheduleBackground,
    scheduleBackground,
  };
}

async function dataUrlToBlob(dataUrl: string) {
  const response = await fetch(dataUrl);
  return response.blob();
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.max(min, Math.min(max, next));
}
