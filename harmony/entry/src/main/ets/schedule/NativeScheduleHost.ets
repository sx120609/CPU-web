export interface NativeScheduleHostCallbacks {
  onReady: () => void;
  onAuthChanged: (scope: string) => void;
  onNavigate: (path: string) => void;
  onNavigationReady: (revision: number) => void;
  onResult: (id: string, payload: string) => void;
  onPrefetched: (payload: string) => void;
  onWidgetSetupFailed: (message: string) => void;
  onAppearanceChanged: (mode: string) => void;
  onEditorResult: (id: string, payload: string) => void;
  onWebOverlayChanged: (visible: boolean) => void;
  onHeaderChanged: (payload: string) => void;
}

let activeCallbacks: NativeScheduleHostCallbacks | undefined;
let pendingScheduleOpen: boolean = false;

export function setNativeScheduleHostCallbacks(callbacks: NativeScheduleHostCallbacks): void {
  activeCallbacks = callbacks;
  if (pendingScheduleOpen) {
    pendingScheduleOpen = false;
    callbacks.onNavigate('/schedule?source=deeplink');
  }
}

export function clearNativeScheduleHostCallbacks(): void {
  activeCallbacks = undefined;
}

export function requestNativeScheduleOpen(): void {
  if (activeCallbacks) activeCallbacks.onNavigate('/schedule?source=deeplink');
  else pendingScheduleOpen = true;
}

export class NativeScheduleHost {
  headerChanged(payload: string): void { activeCallbacks?.onHeaderChanged(payload); }
  navigationReady(revision: number): void { activeCallbacks?.onNavigationReady(revision); }
  webOverlayChanged(visible: boolean): void { activeCallbacks?.onWebOverlayChanged(visible); }
  editorResult(id: string, payload: string): void { activeCallbacks?.onEditorResult(id, payload); }
  appearanceChanged(mode: string): void {
    activeCallbacks?.onAppearanceChanged(mode);
  }
  ready(): void {
    activeCallbacks?.onReady();
  }

  authChanged(scope: string = ''): void {
    activeCallbacks?.onAuthChanged(scope);
  }

  navigate(path: string): void {
    activeCallbacks?.onNavigate(path ?? '');
  }

  scheduleResult(id: string, payload: string): void {
    activeCallbacks?.onResult(id ?? '', payload ?? '');
  }

  schedulePrefetched(payload: string): void {
    activeCallbacks?.onPrefetched(payload ?? '');
  }

  scheduleWeekPrefetched(payload: string): void {
    activeCallbacks?.onPrefetched(payload ?? '');
  }

  widgetSetupFailed(message: string): void {
    activeCallbacks?.onWidgetSetupFailed(message ?? '');
  }
}
