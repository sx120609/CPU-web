export type AndroidUpdatePromptKind = "app" | "widget" | "install";
export type AndroidUpdatePromptSource = "auto" | "manual";

export const ANDROID_UPDATE_PROMPT_EVENT = "cpu:android-update-prompt";

export type AndroidUpdatePromptDetail = {
  kind?: AndroidUpdatePromptKind;
  source?: AndroidUpdatePromptSource;
};

export function requestAndroidUpdatePrompt(detail: AndroidUpdatePromptDetail = {}) {
  window.dispatchEvent(new CustomEvent<AndroidUpdatePromptDetail>(ANDROID_UPDATE_PROMPT_EVENT, {
    detail: {
      kind: detail.kind ?? "app",
      source: detail.source ?? "manual",
    },
  }));
}
