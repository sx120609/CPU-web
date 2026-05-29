import common from '@ohos.app.ability.common';
import webview from '@ohos.web.webview';
import promptAction from '@ohos.promptAction';
import photoAccessHelper from '@ohos.file.photoAccessHelper';
import { APP_NAME, APP_URL, USER_AGENT_TOKEN, isHttpUrl, isInternalUrl } from '../common/AppConfig';
import { HarmonyBridge } from '../common/HarmonyBridge';

@Entry
@Component
struct Index {
  private controller: webview.WebviewController = new webview.WebviewController();
  private bridge: HarmonyBridge = new HarmonyBridge();
  @State private loading: boolean = true;
  @State private failed: boolean = false;

  aboutToAppear(): void {
    const context = AppStorage.get<common.UIAbilityContext>('abilityContext');
    if (context) {
      this.bridge.attachContext(context);
    }
  }

  private bridgeMethods(): string[] {
    return [
      'getVersionCode',
      'getVersionName',
      'supportsScheduleWidget',
      'supportsInAppApkDownload',
      'copyText',
      'openExternalUrl',
      'downloadAndInstallApk',
      'saveImage',
      'installScheduleWidget'
    ];
  }

  private shouldOpenExternal(url: string): boolean {
    if (!url) return true;
    if (isHttpUrl(url)) {
      return !isInternalUrl(url);
    }
    return url.startsWith('tel:') || url.startsWith('mailto:') || url.startsWith('sms:');
  }

  private chooseFiles(event?: OnShowFileSelectorEvent): boolean {
    const photoPicker = new photoAccessHelper.PhotoViewPicker();
    const options = new photoAccessHelper.PhotoSelectOptions();
    options.MIMEType = photoAccessHelper.PhotoViewMIMETypes.IMAGE_TYPE;
    options.maxSelectNumber = 20;
    options.isPhotoTakingSupported = true;
    photoPicker.select(options)
      .then((result: photoAccessHelper.PhotoSelectResult) => {
        event?.result.handleFileList(result.photoUris);
      })
      .catch(() => {
        event?.result.handleFileList([]);
      });
    return true;
  }

  build() {
    Stack() {
      Web({
        src: APP_URL,
        controller: this.controller
      })
        .width('100%')
        .height('100%')
        .javaScriptAccess(true)
        .domStorageAccess(true)
        .databaseAccess(true)
        .fileAccess(true)
        .onlineImageAccess(true)
        .mixedMode(MixedMode.All)
        .userAgent(USER_AGENT_TOKEN)
        .javaScriptProxy({
          object: this.bridge,
          name: 'CPUHarmony',
          methodList: this.bridgeMethods(),
          controller: this.controller
        })
        .javaScriptProxy({
          object: this.bridge,
          name: 'CPUAndroid',
          methodList: this.bridgeMethods(),
          controller: this.controller
        })
        .onPageBegin(() => {
          this.loading = true;
          this.failed = false;
        })
        .onPageEnd(() => {
          this.loading = false;
        })
        .onErrorReceive(() => {
          this.loading = false;
          this.failed = true;
        })
        .onLoadIntercept((event) => {
          const url = event?.data?.getRequestUrl?.() ?? '';
          if (this.shouldOpenExternal(url)) {
            this.bridge.openExternalUrl(url);
            return true;
          }
          return false;
        })
        .onShowFileSelector((event) => this.chooseFiles(event))

      if (this.loading) {
        Column({ space: 16 }) {
          Image($r('app.media.app_icon'))
            .width(84)
            .height(84)
            .borderRadius(24)

          Text(APP_NAME)
            .fontSize(28)
            .fontWeight(FontWeight.Bold)
            .fontColor('#172033')

          Text('正在打开你的校园服务')
            .fontSize(15)
            .fontColor('#667085')
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.Center)
        .alignItems(HorizontalAlign.Center)
        .backgroundColor('#EDF4FF')
      }

      if (this.failed) {
        Column({ space: 16 }) {
          Text('页面暂时无法打开')
            .fontSize(20)
            .fontWeight(FontWeight.Bold)
            .fontColor('#0F172A')

          Text('请检查网络连接，或稍后重试。')
            .fontSize(14)
            .fontColor('#475569')

          Button('重新打开')
            .onClick(() => {
              this.failed = false;
              this.loading = true;
              this.controller.loadUrl(APP_URL);
            })
        }
        .width('100%')
        .height('100%')
        .padding(24)
        .justifyContent(FlexAlign.Center)
        .alignItems(HorizontalAlign.Center)
        .backgroundColor('#F6F8FB')
      }
    }
    .width('100%')
    .height('100%')
  }

  onBackPress(): boolean {
    try {
      if (this.controller.accessBackward()) {
        this.controller.backward();
        return true;
      }
    } catch (_) {
      promptAction.showToast({ message: '已经是第一页' });
    }
    return false;
  }
}
