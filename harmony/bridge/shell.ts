export function hasVisibleWebOverlay(doc: Document = document): boolean {
  return Array.from(doc.querySelectorAll<HTMLElement>('.el-overlay, .el-image-viewer__wrapper, .v-modal, [aria-modal="true"]'))
    .some(element => {
      const style = getComputedStyle(element);
      return element.getClientRects().length > 0 && style.display !== 'none' && style.visibility !== 'hidden'
        && style.opacity !== '0' && element.getAttribute('aria-hidden') !== 'true';
    });
}

export function installHarmonyShellObserver(): void {
  const host = window as any;
  if (host.__cpuHarmonyShellObserver || typeof MutationObserver === 'undefined' || !document.body) return;
  let queued = false;
  let previous: boolean | undefined;
  const update = () => {
    queued = false;
    const visible = hasVisibleWebOverlay();
    if (previous !== visible) {
      previous = visible;
      host.CPUHarmony?.webOverlayChanged?.(visible);
    }
  };
  const schedule = () => {
    if (!queued) { queued = true; requestAnimationFrame(update); }
  };
  host.__cpuHarmonyShellObserver = new MutationObserver(schedule);
  host.__cpuHarmonyShellObserver.observe(document.body, {
    subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'open', 'aria-hidden']
  });
  window.addEventListener('resize', schedule);
  update();
}
