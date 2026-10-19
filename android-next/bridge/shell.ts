import { postNative } from './adapters';

export function hasVisibleWebOverlay(doc: Document = document): boolean {
  // .pswp--open is the PhotoSwipe image viewer the Web falls back to without a native preview.
  return Array.from(doc.querySelectorAll<HTMLElement>('.el-overlay, .el-image-viewer__wrapper, .v-modal, .pswp--open, [aria-modal="true"]'))
    .some(element => {
      const style = getComputedStyle(element);
      return element.getClientRects().length > 0 && style.display !== 'none' && style.visibility !== 'hidden'
        && style.opacity !== '0' && element.getAttribute('aria-hidden') !== 'true';
    });
}

/** Tell the shell when a Web dialog owns the screen so the native bars step aside and Back closes it. */
export function installAndroidShellObserver(): void {
  const host = window as any;
  if (host.__cpuAndroidShellObserver || typeof MutationObserver === 'undefined' || !document.body) return;
  let queued = false;
  let previous: boolean | undefined;
  const update = () => {
    queued = false;
    const visible = hasVisibleWebOverlay();
    if (previous !== visible) {
      previous = visible;
      postNative({ type: 'webOverlay', visible });
    }
  };
  const schedule = () => {
    if (!queued) { queued = true; requestAnimationFrame(update); }
  };
  host.__cpuAndroidShellObserver = new MutationObserver(schedule);
  host.__cpuAndroidShellObserver.observe(document.body, {
    subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'open', 'aria-hidden']
  });
  window.addEventListener('resize', schedule);
  update();
}
