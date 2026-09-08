import common from '@ohos.app.ability.common';
import fs from '@ohos.file.fs';
import { NativeScheduleStore } from './NativeScheduleStore';

export function restoreNativeScheduleCache(context: common.UIAbilityContext, store: NativeScheduleStore): void {
  const path = context.filesDir + '/native-schedule-cache.json';
  let previous: string = '';
  try {
    if (fs.statSync(path).size <= 2 * 1024 * 1024) {
      previous = fs.readTextSync(path);
      store.restoreCache(previous);
    }
  } catch (_) {}
  store.attachPersistence((raw: string) => {
    if (raw === previous) return;
    try {
      if (raw) {
        const temporary = path + '.tmp';
        const file = fs.openSync(temporary, fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
        try { fs.writeSync(file.fd, raw); } finally { fs.closeSync(file); }
        fs.renameSync(temporary, path);
      } else {
        try { fs.unlinkSync(path); } catch (_) {}
      }
      previous = raw;
    } catch (_) {}
  });
}
