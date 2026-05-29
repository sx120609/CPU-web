import common from '@ohos.app.ability.common';
import pasteboard from '@ohos.pasteboard';
import promptAction from '@ohos.promptAction';
import fs from '@ohos.file.fs';
import fileUri from '@ohos.file.fileuri';
import photoAccessHelper from '@ohos.file.photoAccessHelper';
import util from '@ohos.util';
import { APP_NAME, VERSION_CODE, VERSION_NAME, isHttpUrl } from './AppConfig';

export class HarmonyBridge {
  private context?: common.UIAbilityContext;

  attachContext(context: common.UIAbilityContext): void {
    this.context = context;
  }

  getVersionCode(): number {
    return VERSION_CODE;
  }

  getVersionName(): string {
    return VERSION_NAME;
  }

  supportsScheduleWidget(): boolean {
    return false;
  }

  supportsInAppApkDownload(): boolean {
    return false;
  }

  copyText(text: string): boolean {
    try {
      const data = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, text ?? '');
      pasteboard.getSystemPasteboard().setData(data);
      return true;
    } catch (_) {
      this.toast('复制失败');
      return false;
    }
  }

  openExternalUrl(url: string): void {
    const target = (url ?? '').trim();
    if (!target || !this.context) {
      this.toast('无法打开链接');
      return;
    }
    this.context.startAbility({
      action: 'ohos.want.action.viewData',
      uri: target
    }).catch(() => this.toast('无法打开系统浏览器'));
  }

  downloadAndInstallApk(url: string, _fileName: string): boolean {
    if (!isHttpUrl(url)) return false;
    this.openExternalUrl(url);
    this.toast('已交由系统浏览器下载');
    return true;
  }

  saveImage(dataUrl: string, fileName: string): boolean {
    void this.saveImageAsync(dataUrl, fileName);
    return true;
  }

  installScheduleWidget(_payload: string): void {
    this.toast('鸿蒙小组件将在后续版本支持');
  }

  private async saveImageAsync(dataUrl: string, fileName: string): Promise<void> {
    if (!this.context) {
      this.toast('保存失败');
      return;
    }
    try {
      const bytes = this.decodeDataUrl(dataUrl);
      const safeName = this.sanitizeImageName(fileName);
      const sandboxPath = `${this.context.filesDir}/${safeName}`;
      const file = fs.openSync(sandboxPath, fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
      fs.writeSync(file.fd, bytes.buffer);
      fs.closeSync(file);

      const imageUri = fileUri.getUriFromPath(sandboxPath);
      const changeRequest = photoAccessHelper.MediaAssetChangeRequest.createImageAssetRequest(this.context, imageUri);
      const helper = photoAccessHelper.getPhotoAccessHelper(this.context);
      await helper.applyChanges(changeRequest);
      this.toast('图片已保存到相册');
    } catch (_) {
      this.toast('保存图片失败');
    }
  }

  private decodeDataUrl(dataUrl: string): Uint8Array {
    const raw = (dataUrl ?? '').trim();
    const comma = raw.indexOf(',');
    const payload = comma >= 0 ? raw.substring(comma + 1) : raw;
    const helper = new util.Base64Helper();
    return helper.decodeSync(payload);
  }

  private sanitizeImageName(fileName: string): string {
    let raw = (fileName ?? '').trim();
    if (!raw) raw = 'cpu-share.png';
    raw = raw.replace(/[\\/:*?"<>|]/g, '_');
    if (!raw.toLowerCase().endsWith('.png')) raw += '.png';
    return raw;
  }

  private toast(message: string): void {
    promptAction.showToast({
      message,
      duration: 1800
    });
  }
}
