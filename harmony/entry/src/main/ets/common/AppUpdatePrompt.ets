import { updateManager } from '@kit.StoreKit';
import preferences from '@ohos.data.preferences';
import common from '@ohos.app.ability.common';

// 应用市场有新版本时，用系统的更新弹窗提示（带“更新”按钮，直接跳到应用市场）。
// 关掉自动更新的用户不会自己发现落后了版本。弹窗盖在原生课表上，网页里的提示在那里看不到。
// 同一个版本提示过后隔几天再提示，直到装上新版。
const PREFS = 'app_update_prompt';
const SNOOZED_VERSION = 'snoozedVersionCode';
const SNOOZED_AT = 'snoozedAt';
const REMIND_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const RETRY_AFTER_MS = 10 * 60 * 1000;

let lastCheckAt = 0;
let checking = false;

export async function promptAppUpdate(context: common.UIAbilityContext): Promise<void> {
  const now = Date.now();
  if (checking || now - lastCheckAt < CHECK_INTERVAL_MS) return;
  checking = true;
  lastCheckAt = now;
  try {
    const result = await updateManager.checkAppUpdate(context);
    if (result.updateAvailable !== updateManager.UpdateAvailableCode.LATER_VERSION_EXIST) return;
    const latest = result.versionCode ?? 0;
    const prefs = await preferences.getPreferences(context, PREFS);
    const snoozedVersion = Number(await prefs.get(SNOOZED_VERSION, 0));
    const snoozedAt = Number(await prefs.get(SNOOZED_AT, 0));
    const elapsed = now - snoozedAt;
    if (latest > 0 && snoozedVersion === latest && elapsed >= 0 && elapsed < REMIND_AFTER_MS) return;
    await updateManager.showUpdateDialog(context);
    await prefs.put(SNOOZED_VERSION, latest);
    await prefs.put(SNOOZED_AT, now);
    await prefs.flush();
  } catch (_) {
    // 不在前台、未同意应用市场隐私协议、限频或断网：过一会儿再试。
    lastCheckAt = now - CHECK_INTERVAL_MS + RETRY_AFTER_MS;
  } finally {
    checking = false;
  }
}
