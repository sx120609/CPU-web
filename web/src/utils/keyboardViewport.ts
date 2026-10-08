// Pure on-screen keyboard detection used by MainLayout. The layout itself never depends on it: it only
// decides whether the tab bar and floating buttons step aside and how much space the keyboard covers.

/** A shrink larger than this, while an editable is focused, means a software keyboard opened. */
export const KEYBOARD_INSET_THRESHOLD = 96;
/** Once open, the keyboard counts as closed only when less than this remains covered. */
export const KEYBOARD_CLOSE_THRESHOLD = 56;
/** After the last editable loses focus the keyboard is treated as closed at the latest after this delay. */
export const KEYBOARD_BLUR_CLOSE_MS = 600;
const SCALE_TOLERANCE = 0.01;

export type ViewportSample = {
  innerWidth: number;
  innerHeight: number;
  visualHeight: number;
  /** visualViewport.scale; pinch zoom and focus zoom change it. */
  visualScale?: number;
  /** navigator.virtualKeyboard.boundingRect.height where the VirtualKeyboard API exists. */
  keyboardInset?: number;
};

export type KeyboardViewportState = Readonly<{
  /** Keyboard-free viewport height per window width. Rotation, Split View and Stage Manager change the width. */
  baselines: ReadonlyMap<number, number>;
  baselineWidth: number;
  baseHeight: number;
  geometryOpen: boolean;
}>;

export type KeyboardFocus = {
  editableFocused: boolean;
  /** The keyboard is still considered open, or a close check is waiting; the viewport may be mid-animation. */
  closePending?: boolean;
  /**
   * iOS / iPadOS WebKit: the software keyboard only shrinks the visual viewport, never innerHeight, so the
   * baseline can follow innerHeight even while a field is focused (Stage Manager or Split View resizes).
   */
  innerHeightIgnoresKeyboard?: boolean;
};

export const initialKeyboardViewportState: KeyboardViewportState = Object.freeze({
  baselines: new Map<number, number>(),
  baselineWidth: 0,
  baseHeight: 0,
  geometryOpen: false,
});

export function isViewportScaled(sample: ViewportSample) {
  return Math.abs((sample.visualScale ?? 1) - 1) > SCALE_TOLERANCE;
}

function keyboardFreeHeight(sample: ViewportSample) {
  return Math.round(Math.max(sample.visualHeight, sample.innerHeight));
}

/**
 * Updates the keyboard-free height. While nothing editable is focused (or always, where innerHeight ignores
 * the keyboard) the current height is assigned, not maxed with the old value, so a smaller Stage Manager
 * window or a rotation can never leave a stale, taller baseline that later reads as an open keyboard.
 */
export function reduceKeyboardBaseline(state: KeyboardViewportState, sample: ViewportSample, focus: KeyboardFocus): KeyboardViewportState {
  // Zoom changes innerWidth / innerHeight on WebKit; keep the unzoomed baseline until it ends.
  if (isViewportScaled(sample)) return state;
  const width = Math.round(sample.innerWidth);
  let { baselines, baselineWidth, baseHeight } = state;
  if (width !== baselineWidth) {
    baselineWidth = width;
    baseHeight = baselines.get(width) || keyboardFreeHeight(sample);
  }
  if (focus.innerHeightIgnoresKeyboard || (!focus.editableFocused && !focus.closePending)) {
    baseHeight = keyboardFreeHeight(sample);
    if (baselines.get(width) !== baseHeight) baselines = new Map(baselines).set(width, baseHeight);
  }
  if (baselines === state.baselines && baselineWidth === state.baselineWidth && baseHeight === state.baseHeight) return state;
  return { ...state, baselines, baselineWidth, baseHeight };
}

/** Height hidden by the keyboard, in unzoomed CSS pixels. */
export function measureKeyboardInset(state: KeyboardViewportState, sample: ViewportSample) {
  const scale = sample.visualScale && sample.visualScale > 0 ? sample.visualScale : 1;
  const visible = Math.round(sample.visualHeight * scale);
  const baseHeight = Math.max(state.baseHeight, visible, Math.round(sample.innerHeight));
  return Math.max(0, baseHeight - visible, Math.round(sample.keyboardInset || 0));
}

export type KeyboardGeometryResult = {
  state: KeyboardViewportState;
  /** The keyboard looks closed again; confirm after a short delay with settleKeyboardGeometryClose. */
  scheduleClose: boolean;
};

/**
 * Opening needs a focused editable, so rotation, window resizing and toolbars never open it. `enabled`
 * is false where no software keyboard can cover the page (mouse-driven desktop layouts).
 */
export function reduceKeyboardGeometry(
  state: KeyboardViewportState,
  sample: ViewportSample,
  focus: { editableFocused: boolean; enabled: boolean },
): KeyboardGeometryResult {
  if (!focus.enabled) {
    return { state: state.geometryOpen ? { ...state, geometryOpen: false } : state, scheduleClose: false };
  }
  if (isViewportScaled(sample) && !focus.editableFocused) return { state, scheduleClose: false };
  const inset = measureKeyboardInset(state, sample);
  const threshold = state.geometryOpen ? KEYBOARD_CLOSE_THRESHOLD : KEYBOARD_INSET_THRESHOLD;
  if (inset > threshold) {
    if (state.geometryOpen || !focus.editableFocused) return { state, scheduleClose: false };
    return { state: { ...state, geometryOpen: true }, scheduleClose: false };
  }
  return { state, scheduleClose: state.geometryOpen };
}

/** The delayed confirmation of a close; the keyboard may have bounced back while the timer ran. */
export function settleKeyboardGeometryClose(state: KeyboardViewportState, sample: ViewportSample): KeyboardViewportState {
  if (!state.geometryOpen) return state;
  if (measureKeyboardInset(state, sample) > KEYBOARD_CLOSE_THRESHOLD) return state;
  return { ...state, geometryOpen: false };
}

/** Runs KEYBOARD_BLUR_CLOSE_MS after the last blur: nothing is focused, so no keyboard can be up. */
export function closeKeyboardAfterBlur(state: KeyboardViewportState, sample: ViewportSample): KeyboardViewportState {
  const closed = state.geometryOpen ? { ...state, geometryOpen: false } : state;
  return reduceKeyboardBaseline(closed, sample, { editableFocused: false, closePending: false });
}

/**
 * Phones can be assumed to show a keyboard as soon as an editor is focused, before the viewport
 * shrinks. Tablets often use a hardware keyboard, so they wait for the measured geometry instead.
 */
export function assumesKeyboardOnFocus(device: string, focus: { editableFocused: boolean; withinFocusGrace?: boolean; fullHeightContent: boolean; editorFocused: boolean }) {
  return device === "phone"
    && focus.editableFocused
    && (focus.withinFocusGrace ?? true)
    && (focus.fullHeightContent || focus.editorFocused);
}
