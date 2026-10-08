import { shallowRef, type Ref } from "vue";
import {
  classifyFormFactor,
  COARSE_POINTER_QUERY,
  FINE_HOVER_QUERY,
  PHONE_MAX_QUERY,
  PORTRAIT_QUERY,
  sameFormFactor,
  TABLET_COMPACT_QUERY,
  type FormFactor,
} from "./formFactorCore";
import { isFlutterNativeShell, isStandaloneMode } from "./clientInfo";

export type { FormFactor, FormFactorDevice, FormFactorLayout, FormFactorShell } from "./formFactorCore";
export { PHONE_MAX_QUERY, TABLET_COMPACT_QUERY, TABLET_MIN_SHORT_SIDE } from "./formFactorCore";

type FormFactorListener = (next: FormFactor, previous: FormFactor) => void;

const WATCHED_QUERIES = [COARSE_POINTER_QUERY, FINE_HOVER_QUERY, PHONE_MAX_QUERY, TABLET_COMPACT_QUERY, PORTRAIT_QUERY];

// Server-side or sandboxed callers get the desktop result the pages used before this module existed.
const FALLBACK: FormFactor = classifyFormFactor({
  userAgent: "",
  maxTouchPoints: 0,
  screenWidth: 0,
  screenHeight: 0,
  viewportWidth: 1280,
  coarsePointer: false,
  fineHover: true,
});

const state = shallowRef<FormFactor>(FALLBACK);
const listeners = new Set<FormFactorListener>();
let initialized = false;
let installedRoot: HTMLElement | null = null;

function hasWindow() {
  return typeof window !== "undefined" && typeof navigator !== "undefined";
}

function queryMatches(query: string): boolean | undefined {
  try {
    return typeof window.matchMedia === "function" ? window.matchMedia(query).matches : undefined;
  } catch {
    return undefined;
  }
}

function readFormFactor(): FormFactor {
  if (!hasWindow()) return FALLBACK;
  const screen = window.screen;
  return classifyFormFactor({
    userAgent: navigator.userAgent || "",
    maxTouchPoints: Number(navigator.maxTouchPoints) || 0,
    screenWidth: Number(screen?.width) || 0,
    screenHeight: Number(screen?.height) || 0,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    coarsePointer: Boolean(queryMatches(COARSE_POINTER_QUERY)),
    fineHover: queryMatches(FINE_HOVER_QUERY) ?? true,
    // Undefined lets the classifier fall back to innerWidth when matchMedia is missing.
    phoneWidth: queryMatches(PHONE_MAX_QUERY),
    tabletCompactWidth: queryMatches(TABLET_COMPACT_QUERY),
    portrait: queryMatches(PORTRAIT_QUERY),
    electron: Boolean((window as any).CPUDesktop),
    flutterShell: isFlutterNativeShell(),
    standalone: isStandaloneMode(),
  });
}

function writeRootAttributes(root: HTMLElement, value: FormFactor) {
  // data-cpu-platform stays owned by main.ts; index.scss depends on its "ios" value.
  root.dataset.cpuLayout = value.layout;
  root.dataset.cpuDevice = value.device;
  root.dataset.cpuInput = value.touchPrimary ? "touch" : "pointer";
  root.dataset.cpuShell = value.shell;
}

function refresh() {
  if (!hasWindow()) return state.value;
  const next = readFormFactor();
  const previous = state.value;
  if (sameFormFactor(previous, next)) return previous;
  state.value = next;
  if (installedRoot) writeRootAttributes(installedRoot, next);
  for (const listener of [...listeners]) {
    try {
      listener(next, previous);
    } catch (error) {
      console.error("[formFactor] listener failed", error);
    }
  }
  return next;
}

function ensureInitialized() {
  if (initialized || !hasWindow()) return;
  initialized = true;
  state.value = readFormFactor();
  const handleChange = () => {
    refresh();
  };
  if (typeof window.matchMedia === "function") {
    for (const query of WATCHED_QUERIES) {
      try {
        const list = window.matchMedia(query);
        if (typeof list.addEventListener === "function") list.addEventListener("change", handleChange);
        else list.addListener?.(handleChange);
      } catch {
        /* resize below still keeps the value current */
      }
    }
  }
  window.addEventListener("resize", handleChange, { passive: true });
  window.addEventListener("orientationchange", handleChange);
}

/** Mirrors the classification onto `<html>` so stylesheets switch with the rendered component tree. */
export function installFormFactor(root: HTMLElement | null = typeof document === "undefined" ? null : document.documentElement) {
  ensureInitialized();
  if (!root || installedRoot === root) return state.value;
  installedRoot = root;
  writeRootAttributes(root, state.value);
  return state.value;
}

export function useFormFactor(): Readonly<Ref<FormFactor>> {
  ensureInitialized();
  return state;
}

/** Re-reads synchronously, so a router guard during a rotation never sees the previous layout. */
export function getFormFactor(): FormFactor {
  ensureInitialized();
  return refresh();
}

export function isCompactLayoutNow() {
  return getFormFactor().compact;
}

export function subscribeFormFactor(listener: FormFactorListener) {
  ensureInitialized();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
