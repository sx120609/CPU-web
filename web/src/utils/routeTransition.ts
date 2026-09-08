const frozenStyles = new WeakMap<HTMLElement, { style: string | null; inert: boolean }>();

export function freezeLeavingPage(element: Element) {
  if (!(element instanceof HTMLElement)) return;
  const rect = element.getBoundingClientRect();
  frozenStyles.set(element, { style: element.getAttribute('style'), inert: element.inert });
  element.inert = true;
  // Keep the outgoing page at its current viewport position while router scroll resets.
  Object.assign(element.style, {
    position: 'fixed', top: `${rect.top}px`, left: `${rect.left}px`,
    width: `${rect.width}px`, height: `${rect.height}px`, margin: '0',
    zIndex: '1', pointerEvents: 'none',
  });
}

export function releaseLeavingPage(element: Element) {
  if (!(element instanceof HTMLElement) || !frozenStyles.has(element)) return;
  const { style, inert } = frozenStyles.get(element)!;
  element.inert = inert;
  if (style === null) element.removeAttribute('style');
  else element.setAttribute('style', style || '');
  frozenStyles.delete(element);
}
