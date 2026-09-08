export interface NativeScheduleHostCallbacks {
  onReady: () => void;
  onAuthChanged: () => void;
  onNavigate: (path: string) => void;
  onResult: (id: string, payload: string) => void;
  onPrefetched: (payload: string) => void;
  onWidgetSetupFailed: (message: string) => void;
}

let activeCallbacks: NativeScheduleHostCallbacks | undefined;

export function setNativeScheduleHostCallbacks(callbacks: NativeScheduleHostCallbacks): void {
  activeCallbacks = callbacks;
}

export function requestNativeScheduleOpen(): void {
  activeCallbacks?.onNavigate('/schedule?source=deeplink&refresh=1');
}

export class NativeScheduleHost {
  ready(): void {
    activeCallbacks?.onReady();
  }

  authChanged(): void {
    activeCallbacks?.onAuthChanged();
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
