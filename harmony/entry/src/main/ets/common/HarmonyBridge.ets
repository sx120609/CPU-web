import common from '@ohos.app.ability.common';
import pasteboard from '@ohos.pasteboard';
import promptAction from '@ohos.promptAction';
import fs from '@ohos.file.fs';
import fileUri from '@ohos.file.fileuri';
import photoAccessHelper from '@ohos.file.photoAccessHelper';
import http from '@ohos.net.http';
import util from '@ohos.util';
import { VERSION_CODE, VERSION_NAME, isHttpUrl } from './AppConfig';

export interface NativePreviewImage {
  url: string;
  title: string;
  fileName: string;
}

interface NativePreviewPayload {
  images?: NativePreviewImage[];
  index?: number;
}

export class HarmonyBridge {
  private context?: common.UIAbilityContext;
  private saveRequestHandler?: (dataUrl: string, fileName: string) => void;
  private previewRequestHandler?: (images: NativePreviewImage[], index: number) => void;
  private readonly imageSaveTimeoutMs: number = 15000;

  attachContext(context: common.UIAbilityContext): void {
    this.context = context;
  }

  setSaveRequestHandler(handler: (dataUrl: string, fileName: string) => void): void {
    this.saveRequestHandler = handler;
  }

  setPreviewRequestHandler(handler: (images: NativePreviewImage[], index: number) => void): void {
    this.previewRequestHandler = handler;
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

  previewImages(payload: string): boolean {
    if (!this.previewRequestHandler) return false;
    try {
      const parsed = JSON.parse(payload ?? '{}') as NativePreviewPayload;
      const rawImages = parsed.images ?? [];
      const images: NativePreviewImage[] = [];
      rawImages.forEach((item: NativePreviewImage) => {
        if (!isHttpUrl(item.url)) return;
        const normalized: NativePreviewImage = {
          url: item.url,
          title: item.title || this.sanitizeImageName(item.fileName || '图片'),
          fileName: this.sanitizeImageName(item.fileName || item.title || 'image.png')
        };
        images.push(normalized);
      });
      if (!images.length) return false;
      const index = Math.max(0, Math.min(Math.floor(parsed.index ?? 0), images.length - 1));
      this.previewRequestHandler(images, index);
      return true;
    } catch (_) {
      return false;
    }
  }

  saveImage(dataUrl: string, fileName: string): boolean {
    if (this.saveRequestHandler) {
      this.saveRequestHandler(dataUrl, fileName);
      return true;
    }
    void this.saveImageWithDialogAsync(dataUrl, fileName);
    return true;
  }

  async commitImageSave(dataUrl: string, fileName: string): Promise<boolean> {
    if (!this.context) {
      this.toast('保存失败');
      return false;
    }
    try {
      const bytes = this.decodeDataUrl(dataUrl);
      return await this.withTimeout(
        this.writeImageAsset(this.toExactBuffer(bytes), fileName),
        this.imageSaveTimeoutMs
      );
    } catch (_) {
      this.toast('保存图片失败');
      return false;
    }
  }

  async commitImageUrlSave(url: string, fileName: string): Promise<boolean> {
    if (!isHttpUrl(url)) {
      this.toast('图片地址无效');
      return false;
    }
    try {
      return await this.withTimeout(
        this.writeImageUrlAsset(url, fileName),
        this.imageSaveTimeoutMs
      );
    } catch (_) {
      this.toast('图片下载失败');
      return false;
    }
  }

  private async writeImageAsset(buffer: ArrayBuffer, fileName: string): Promise<boolean> {
    if (!this.context) {
      this.toast('保存失败');
      return false;
    }
    let file: fs.File | undefined = undefined;
    try {
      const safeName = this.sanitizeImageName(fileName);
      const extension = this.extensionOf(safeName);
      const helper = photoAccessHelper.getPhotoAccessHelper(this.context);
      const uri = await helper.createAsset(photoAccessHelper.PhotoType.IMAGE, extension);
      file = await fs.open(uri, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE);
      await fs.write(file.fd, buffer);
      await fs.close(file.fd);
      file = undefined;
      this.toast('图片已保存到相册');
      return true;
    } catch (_) {
      if (file) {
        try {
          await fs.close(file.fd);
        } catch (_) {
          /* ignore */
        }
      }
      return false;
    }
  }

  private async writeImageUrlAsset(url: string, fileName: string): Promise<boolean> {
    if (!this.context) {
      this.toast('保存失败');
      return false;
    }
    const request = http.createHttp();
    let file: fs.File | undefined = undefined;
    try {
      const safeName = this.sanitizeImageName(fileName);
      const extension = this.extensionOf(safeName);
      const helper = photoAccessHelper.getPhotoAccessHelper(this.context);
      const uri = await helper.createAsset(photoAccessHelper.PhotoType.IMAGE, extension);
      file = await fs.open(uri, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE);

      const response = await request.request(url, {
        method: http.RequestMethod.GET,
        expectDataType: http.HttpDataType.ARRAY_BUFFER,
        connectTimeout: 8000,
        readTimeout: 8000
      });
      const statusCode = Number(response.responseCode);
      if (statusCode < 200 || statusCode >= 300 || !(response.result instanceof ArrayBuffer)) {
        return false;
      }
      await fs.write(file.fd, response.result);
      await fs.close(file.fd);
      file = undefined;
      this.toast('图片已保存到相册');
      return true;
    } catch (_) {
      if (file) {
        try {
          await fs.close(file.fd);
        } catch (_) {
          /* ignore */
        }
      }
      return false;
    } finally {
      request.destroy();
    }
  }

  installScheduleWidget(_payload: string): void {
    this.toast('鸿蒙小组件将在后续版本支持');
  }

  private async saveImageWithDialogAsync(dataUrl: string, fileName: string): Promise<boolean> {
    if (!this.context) {
      this.toast('保存失败');
      return false;
    }
    try {
      const bytes = this.decodeDataUrl(dataUrl);
      const safeName = this.sanitizeImageName(fileName);
      const sandboxPath = `${this.context.filesDir}/${safeName}`;
      const file = fs.openSync(sandboxPath, fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
      fs.writeSync(file.fd, this.toExactBuffer(bytes));
      fs.closeSync(file);

      const imageUri = fileUri.getUriFromPath(sandboxPath);
      const helper = photoAccessHelper.getPhotoAccessHelper(this.context);
      const config: photoAccessHelper.PhotoCreationConfig = {
        title: this.stripExtension(safeName),
        fileNameExtension: this.extensionOf(safeName),
        photoType: photoAccessHelper.PhotoType.IMAGE
      };
      await helper.showAssetsCreationDialog([imageUri], [config]);
      this.toast('图片已保存到相册');
      return true;
    } catch (_) {
      this.toast('保存图片失败');
      return false;
    }
  }

  private toExactBuffer(bytes: Uint8Array): ArrayBuffer {
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    return buffer;
  }

  private withTimeout<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      task
        .then((value: T) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((error: Error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
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
    if (!/\.(png|jpe?g|webp|gif)$/i.test(raw)) raw += '.png';
    return raw;
  }

  private stripExtension(fileName: string): string {
    const dot = fileName.lastIndexOf('.');
    return dot > 0 ? fileName.substring(0, dot) : fileName;
  }

  private extensionOf(fileName: string): string {
    const dot = fileName.lastIndexOf('.');
    const ext = dot >= 0 ? fileName.substring(dot + 1).toLowerCase() : 'png';
    if (ext === 'jpg' || ext === 'jpeg' || ext === 'webp' || ext === 'gif' || ext === 'png') return ext;
    return 'png';
  }

  private toast(message: string): void {
    promptAction.showToast({
      message,
      duration: 1800
    });
  }
}
