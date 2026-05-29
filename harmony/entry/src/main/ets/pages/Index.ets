import common from '@ohos.app.ability.common';
import webview from '@ohos.web.webview';
import promptAction from '@ohos.promptAction';
import photoAccessHelper from '@ohos.file.photoAccessHelper';
import { APP_NAME, APP_URL, USER_AGENT_TOKEN, isHttpUrl, isInternalUrl } from '../common/AppConfig';
import { HarmonyBridge, NativePreviewImage } from '../common/HarmonyBridge';

@Entry
@Component
struct Index {
  private controller: webview.WebviewController = new webview.WebviewController();
  private bridge: HarmonyBridge = new HarmonyBridge();
  @State private loading: boolean = true;
  @State private failed: boolean = false;
  @State private savePanelVisible: boolean = false;
  @State private saveBusy: boolean = false;
  @State private pendingImageDataUrl: string = '';
  @State private pendingImageFileName: string = '';
  @State private imagePreviewVisible: boolean = false;
  @State private previewImages: NativePreviewImage[] = [];
  @State private previewIndex: number = 0;
  @State private previewScale: number = 1;
  @State private previewOffsetX: number = 0;
  @State private previewOffsetY: number = 0;
  @State private previewSaveBusy: boolean = false;
  private previewBaseScale: number = 1;
  private previewBaseOffsetX: number = 0;
  private previewBaseOffsetY: number = 0;

  aboutToAppear(): void {
    const context = AppStorage.get<common.UIAbilityContext>('abilityContext');
    if (context) {
      this.bridge.attachContext(context);
    }
    this.bridge.setSaveRequestHandler((dataUrl: string, fileName: string) => {
      this.pendingImageDataUrl = dataUrl;
      this.pendingImageFileName = fileName;
      this.saveBusy = false;
      this.savePanelVisible = true;
    });
    this.bridge.setPreviewRequestHandler((images: NativePreviewImage[], index: number) => {
      this.openImagePreview(images, index);
    });
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
      'previewImages',
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
        .metaViewport(true)
        .initialScale(100)
        .textZoomRatio(100)
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

      if (this.imagePreviewVisible && this.previewImages.length > 0) {
        Column() {
          Row() {
            Button('关闭')
              .type(ButtonType.Normal)
              .fontSize(14)
              .fontColor('#FFFFFF')
              .backgroundColor('rgba(255, 255, 255, 0.16)')
              .onClick(() => this.closeImagePreview())

            Blank()
              .layoutWeight(1)

            Text(`${this.previewIndex + 1} / ${this.previewImages.length}`)
              .fontSize(14)
              .fontColor('#FFFFFF')

            Blank()
              .layoutWeight(1)

            if (this.previewSaveBusy) {
              Button('保存中')
                .type(ButtonType.Capsule)
                .height(38)
                .fontSize(13)
                .fontColor('#FFFFFF')
                .backgroundColor('#168776')
                .enabled(false)
            } else {
              SaveButton({
                icon: SaveIconStyle.LINES,
                text: SaveDescription.SAVE_TO_GALLERY,
                buttonType: ButtonType.Capsule
              })
                .height(38)
                .fontSize(13)
                .fontColor('#FFFFFF')
                .iconColor('#FFFFFF')
                .backgroundColor('#168776')
                .onClick((_event: ClickEvent, result: SaveButtonOnClickResult) => {
                  if (result === SaveButtonOnClickResult.SUCCESS) {
                    void this.commitPreviewImageSave();
                  } else {
                    promptAction.showToast({ message: '未获得保存授权' });
                  }
                })
            }
          }
          .width('100%')
          .padding({
            left: 14,
            right: 14,
            top: 12,
            bottom: 8
          })
          .alignItems(VerticalAlign.Center)

          Stack() {
            Image(this.currentPreviewImage().url)
              .width('100%')
              .height('100%')
              .objectFit(ImageFit.Contain)
              .scale({ x: this.previewScale, y: this.previewScale })
              .translate({ x: this.previewOffsetX, y: this.previewOffsetY })
              .gesture(
                GestureGroup(
                  GestureMode.Parallel,
                  PinchGesture({ fingers: 2 })
                    .onActionStart(() => {
                      this.previewBaseScale = this.previewScale;
                    })
                    .onActionUpdate((event: GestureEvent) => {
                      this.previewScale = this.clampScale(this.previewBaseScale * event.scale);
                      if (this.previewScale <= 1.02) this.resetPreviewTransform();
                    }),
                  PanGesture({ fingers: 1, direction: PanDirection.All, distance: 2 })
                    .onActionStart(() => {
                      this.previewBaseOffsetX = this.previewOffsetX;
                      this.previewBaseOffsetY = this.previewOffsetY;
                    })
                    .onActionUpdate((event: GestureEvent) => {
                      if (this.previewScale > 1.02) {
                        this.previewOffsetX = this.previewBaseOffsetX + event.offsetX;
                        this.previewOffsetY = this.previewBaseOffsetY + event.offsetY;
                      }
                    })
                    .onActionEnd((event: GestureEvent) => this.onPreviewPanEnd(event))
                )
              )
              .gesture(
                TapGesture({ count: 2 })
                  .onAction(() => {
                    if (this.previewScale > 1.02) {
                      this.resetPreviewTransform();
                    } else {
                      this.previewScale = 2;
                    }
                  })
              )

            if (this.previewImages.length > 1 && this.previewIndex > 0) {
              Button('<')
                .type(ButtonType.Circle)
                .fontSize(20)
                .fontColor('#FFFFFF')
                .backgroundColor('rgba(255, 255, 255, 0.18)')
                .position({ x: 14, y: '46%' })
                .onClick(() => this.changePreviewImage(-1))
            }

            if (this.previewImages.length > 1 && this.previewIndex < this.previewImages.length - 1) {
              Button('>')
                .type(ButtonType.Circle)
                .fontSize(20)
                .fontColor('#FFFFFF')
                .backgroundColor('rgba(255, 255, 255, 0.18)')
                .position({ x: '86%', y: '46%' })
                .onClick(() => this.changePreviewImage(1))
            }
          }
          .width('100%')
          .layoutWeight(1)
          .clip(true)

          Text(this.currentPreviewImage().title)
            .width('100%')
            .padding({ left: 20, right: 20, top: 8, bottom: 18 })
            .fontSize(13)
            .fontColor('rgba(255, 255, 255, 0.76)')
            .textAlign(TextAlign.Center)
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        .width('100%')
        .height('100%')
        .backgroundColor('#05070A')
      }

      if (this.savePanelVisible) {
        Column() {
          Blank()
            .layoutWeight(1)
            .width('100%')
            .onClick(() => {
              if (!this.saveBusy) this.closeSavePanel();
            })

          Column({ space: 14 }) {
            Row() {
              Column({ space: 4 }) {
                Text('保存图片')
                  .fontSize(18)
                  .fontWeight(FontWeight.Bold)
                  .fontColor('#111827')

                Text('请点击下方系统按钮授权保存到相册')
                  .fontSize(13)
                  .fontColor('#667085')
              }
              .alignItems(HorizontalAlign.Start)
              .layoutWeight(1)

              Button('取消')
                .type(ButtonType.Normal)
                .fontSize(14)
                .fontColor('#667085')
                .backgroundColor('#F3F4F6')
                .enabled(!this.saveBusy)
                .onClick(() => this.closeSavePanel())
            }
            .width('100%')
            .alignItems(VerticalAlign.Center)

            if (this.pendingImageFileName) {
              Text(this.pendingImageFileName)
                .width('100%')
                .fontSize(12)
                .fontColor('#98A2B3')
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
            }

            if (this.saveBusy) {
              Button('保存中')
                .type(ButtonType.Capsule)
                .width('100%')
                .height(48)
                .fontSize(16)
                .fontWeight(FontWeight.Medium)
                .fontColor('#FFFFFF')
                .backgroundColor('#168776')
                .enabled(false)
            } else {
              SaveButton({
                icon: SaveIconStyle.LINES,
                text: SaveDescription.SAVE_TO_GALLERY,
                buttonType: ButtonType.Capsule
              })
                .width('100%')
                .height(48)
                .fontSize(16)
                .fontWeight(FontWeight.Medium)
                .fontColor('#FFFFFF')
                .iconColor('#FFFFFF')
                .backgroundColor('#168776')
                .onClick((_event: ClickEvent, result: SaveButtonOnClickResult) => {
                  if (result === SaveButtonOnClickResult.SUCCESS) {
                    void this.commitPendingImageSave();
                  } else {
                    promptAction.showToast({ message: '未获得保存授权' });
                  }
                })
            }
          }
          .width('100%')
          .padding({
            left: 20,
            right: 20,
            top: 18,
            bottom: 24
          })
          .backgroundColor('#FFFFFF')
          .borderRadius({
            topLeft: 22,
            topRight: 22
          })
        }
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(15, 23, 42, 0.36)')
      }
    }
    .width('100%')
    .height('100%')
  }

  private closeSavePanel(): void {
    this.savePanelVisible = false;
    this.saveBusy = false;
    this.pendingImageDataUrl = '';
    this.pendingImageFileName = '';
  }

  private openImagePreview(images: NativePreviewImage[], index: number): void {
    this.previewImages = images;
    this.previewIndex = Math.max(0, Math.min(index, images.length - 1));
    this.resetPreviewTransform();
    this.imagePreviewVisible = true;
  }

  private closeImagePreview(): void {
    this.imagePreviewVisible = false;
    this.previewImages = [];
    this.previewIndex = 0;
    this.previewSaveBusy = false;
    this.resetPreviewTransform();
  }

  private currentPreviewImage(): NativePreviewImage {
    return this.previewImages[this.previewIndex] ?? {
      url: '',
      title: '',
      fileName: 'image.png'
    };
  }

  private changePreviewImage(delta: number): void {
    const next = this.previewIndex + delta;
    if (next < 0 || next >= this.previewImages.length) return;
    this.previewIndex = next;
    this.resetPreviewTransform();
  }

  private resetPreviewTransform(): void {
    this.previewScale = 1;
    this.previewOffsetX = 0;
    this.previewOffsetY = 0;
    this.previewBaseScale = 1;
    this.previewBaseOffsetX = 0;
    this.previewBaseOffsetY = 0;
  }

  private clampScale(value: number): number {
    if (value < 1) return 1;
    if (value > 5) return 5;
    return value;
  }

  private onPreviewPanEnd(event: GestureEvent): void {
    if (this.previewScale > 1.02) return;
    if (event.offsetX <= -72) this.changePreviewImage(1);
    else if (event.offsetX >= 72) this.changePreviewImage(-1);
  }

  private async commitPreviewImageSave(): Promise<void> {
    if (this.previewSaveBusy) return;
    const image = this.currentPreviewImage();
    this.previewSaveBusy = true;
    try {
      const ok = await this.bridge.commitImageUrlSave(image.url, image.fileName);
      if (!ok) {
        promptAction.showToast({ message: '保存图片失败' });
      }
    } finally {
      this.previewSaveBusy = false;
    }
  }

  private async commitPendingImageSave(): Promise<void> {
    if (this.saveBusy) return;
    this.saveBusy = true;
    try {
      const ok = await this.bridge.commitImageSave(this.pendingImageDataUrl, this.pendingImageFileName);
      if (ok) this.closeSavePanel();
    } finally {
      this.saveBusy = false;
    }
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
