type ViewportMetrics = {
  layoutHeight: number;
  visualHeight?: number;
  offsetTop?: number;
  keyboardTop?: number;
  keyboardHeight?: number;
};

export function getOverlayViewport(metrics: ViewportMetrics) {
  const top = Math.max(0, metrics.offsetTop ?? 0);
  let bottom = Math.min(metrics.layoutHeight, top + (metrics.visualHeight ?? metrics.layoutHeight));
  if ((metrics.keyboardHeight ?? 0) > 0 && (metrics.keyboardTop ?? 0) > top) {
    bottom = Math.min(bottom, metrics.keyboardTop!);
  }
  return { top, height: Math.max(0, bottom - top) };
}

function keepOverlayFocusVisible() {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return;
  const body = active.closest<HTMLElement>(".el-dialog__body, .el-message-box__content");
  if (!body || !active.matches("input, textarea, [contenteditable='true']")) return;
  const selection = window.getSelection();
  const range = active.isContentEditable && selection?.rangeCount && active.contains(selection.focusNode)
    ? selection.getRangeAt(0).cloneRange()
    : null;
  range?.collapse(false);
  const focusedRect = () => {
    const caret = range?.getBoundingClientRect();
    return caret?.height ? caret : active.getBoundingClientRect();
  };
  // Scroll only the editor and dialog body, leaving the underlying page in place.
  for (let container: HTMLElement | null = active; container; container = container.parentElement) {
    if (container.scrollHeight > container.clientHeight && (container === body || container.isContentEditable)) {
      const bounds = container.getBoundingClientRect();
      const rect = focusedRect();
      const top = bounds.top + 8;
      const bottom = bounds.bottom - 8;
      if (rect.top < top) container.scrollTop += rect.top - top;
      else if (rect.bottom > bottom) container.scrollTop += Math.min(rect.bottom - bottom, rect.top - top);
    }
    if (container === body) break;
  }
}

export function installOverlayViewport() {
  const root = document.documentElement;
  const viewport = window.visualViewport;
  const keyboard = (navigator as Navigator & {
    virtualKeyboard?: EventTarget & { boundingRect?: DOMRectReadOnly };
  }).virtualKeyboard;
  let frame = 0;
  const update = () => {
    frame = 0;
    const { top, height } = getOverlayViewport({
      layoutHeight: window.innerHeight,
      visualHeight: viewport?.height,
      offsetTop: viewport?.offsetTop,
      keyboardTop: keyboard?.boundingRect?.top,
      keyboardHeight: keyboard?.boundingRect?.height,
    });
    // Teleported dialogs cannot inherit MainLayout's viewport variables.
    root.style.setProperty("--cpu-overlay-viewport-top", `${top}px`);
    root.style.setProperty("--cpu-overlay-viewport-height", `${height}px`);
    keepOverlayFocusVisible();
  };
  const schedule = () => {
    if (!frame) frame = window.requestAnimationFrame(update);
  };
  window.addEventListener("resize", schedule);
  viewport?.addEventListener("resize", schedule);
  viewport?.addEventListener("scroll", schedule);
  keyboard?.addEventListener("geometrychange", schedule);
  update();
  return () => {
    window.cancelAnimationFrame(frame);
    window.removeEventListener("resize", schedule);
    viewport?.removeEventListener("resize", schedule);
    viewport?.removeEventListener("scroll", schedule);
    keyboard?.removeEventListener("geometrychange", schedule);
    root.style.removeProperty("--cpu-overlay-viewport-top");
    root.style.removeProperty("--cpu-overlay-viewport-height");
  };
}
