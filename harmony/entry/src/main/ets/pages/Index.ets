import util from '@ohos.util';
import deviceInfo from '@ohos.deviceInfo';
import { SymbolGlyphModifier } from '@kit.ArkUI';
import { HdsTabs, hdsMaterial } from '@kit.UIDesignKit';
import BuildProfile from 'BuildProfile';
import ConfigurationConstant from '@ohos.app.ability.ConfigurationConstant';
import preferences from '@ohos.data.preferences';
import window from '@ohos.window';
import fs from '@ohos.file.fs';
import { systemShare } from '@kit.ShareKit';
import { scheduleText, scheduleCalendar } from '../schedule/ScheduleExport';
import { schedulePalette } from '../schedule/ScheduleVisuals';
import common from '@ohos.app.ability.common';
import webview from '@ohos.web.webview';
import promptAction from '@ohos.promptAction';
import photoAccessHelper from '@ohos.file.photoAccessHelper';
import picker from '@ohos.file.picker';
import abilityAccessCtrl, { Permissions } from '@ohos.abilityAccessCtrl';
import { APP_NAME, APP_URL, USER_AGENT_SUFFIX, isAppOrigin, isHttpUrl, isInternalUrl } from '../common/AppConfig';
import {
  HarmonyBridge,
  HarmonyJavaScriptProxy,
  NativePreviewImage,
  setActiveHarmonyBridge
} from '../common/HarmonyBridge';
import { restoreNativeScheduleCache } from '../schedule/NativeScheduleCache';
import { NativeSchedulePage } from '../schedule/NativeSchedulePage';
import { NativeCourseBlock, NativeScheduleRequest, NativeScheduleStore } from '../schedule/NativeScheduleStore';
import { CourseEditorRequest, NativeCourseEditor, NativeCourseEditorModel } from '../schedule/NativeCourseEditor';
import { setNativeScheduleHostCallbacks, clearNativeScheduleHostCallbacks } from '../schedule/NativeScheduleHost';
import { ScheduleCardView } from '../schedulewidget/ScheduleCardView';
import { ScheduleWidgetBinding, initialScheduleWidgetBinding, readScheduleWidgetPreview, saveScheduleWidgetTheme, refreshAllScheduleForms, clearScheduleWidgetAccount, readScheduleWidgetSettings } from '../common/ScheduleWidgetService';

@Entry
@Component
struct Index {
  private compatibilityScript: string = '';
  private navigationRevision: number = 0;
  private appearanceMode: string = 'system';
  private appliedAppearanceMode: string = '';
  private controller: webview.WebviewController = new webview.WebviewController();
  private bridge: HarmonyBridge = new HarmonyBridge();
  private webProxy: HarmonyJavaScriptProxy = new HarmonyJavaScriptProxy();
  @State private scheduleStore: NativeScheduleStore = new NativeScheduleStore();
  @State private editorModel: NativeCourseEditorModel = new NativeCourseEditorModel();
  @State private scheduleStyleVisible: boolean = false;
  @StorageLink('launchUrl') private launchUrl: string = APP_URL;
  @StorageLink('nativeTab') private selectedTab: number = 0;
  @StorageProp('systemTopInsetPx') private systemTopInsetPx: number = 0;
  @StorageProp('systemBottomInsetPx') private systemBottomInsetPx: number = 0;
  @State private loading: boolean = true;
  @State private failed: boolean = false;
  @State private webOverlayVisible: boolean = false;
  @State private widgetPanelVisible: boolean = false;
  @State private widgetPreview: ScheduleWidgetBinding = initialScheduleWidgetBinding(2, 'schedule_upcoming');
  @State private lockPreview: ScheduleWidgetBinding = initialScheduleWidgetBinding(2, 'schedule_upcoming');
  @State private widgetFormName: string = 'schedule_upcoming';
  @State private widgetDimension: number = 2;
  private widgetPreviewRevision: number = 0;
  @State private widgetTheme: string = 'color-glass';
  @State private widgetConfigured: boolean = false;
  @State private widgetSettingsLoaded: boolean = false;
  @State private widgetAutoSetupAttempted: boolean = false;
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
    webview.WebviewController.setWebDebuggingAccess(BuildProfile.DEBUG);
    const contextForResources = AppStorage.get<common.UIAbilityContext>('abilityContext');
    if (contextForResources) {
      this.compatibilityScript = new util.TextDecoder('utf-8').decodeWithStream(
        contextForResources.resourceManager.getRawFileContentSync('NativeWebCompatibility.js'));
    }
    setActiveHarmonyBridge(this.bridge);
    const context = AppStorage.get<common.UIAbilityContext>('abilityContext');
    if (context) {
      this.bridge.attachContext(context);
      void preferences.getPreferences(context, { name: 'native_appearance' }).then(async (prefs) => {
        this.appearanceMode = String(await prefs.get('mode', 'system'));
        this.applyAppearance(this.appearanceMode, false);
      });
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
    this.bridge.setWidgetConfigurationHandler((configured: boolean) => {
      this.widgetConfigured = configured;
      if (this.widgetPanelVisible) void this.loadWidgetPreview();
    });
    if (context) {
      void readScheduleWidgetSettings(context).then((settings) => {
        this.widgetConfigured = settings.configured;
        this.widgetTheme = settings.theme;
        this.widgetSettingsLoaded = true;
        if (this.scheduleStore.result && !this.widgetConfigured && !this.widgetAutoSetupAttempted) {
          this.widgetAutoSetupAttempted = true;
          this.configureScheduleWidget();
        }
      }).catch(() => {
        this.widgetSettingsLoaded = true;
      });
    }
    this.scheduleStore.attach(
      (request: NativeScheduleRequest) => this.requestSchedule(request),
      () => {
        if (this.scheduleStore.result && this.widgetSettingsLoaded && !this.widgetConfigured && !this.widgetAutoSetupAttempted) {
          this.widgetAutoSetupAttempted = true;
          this.configureScheduleWidget();
        }
      }
    );
    if (context) restoreNativeScheduleCache(context, this.scheduleStore);
    this.editorModel.attach((id: string, payload: CourseEditorRequest) => {
      const requestId = JSON.stringify(id);
      const request = JSON.stringify(payload);
      void this.controller.runJavaScript(`
        Promise.resolve(window.CPUHarmonyEditor?.(${request}) || { error: '课程编辑器尚未就绪，请重试' })
          .then(value => window.CPUHarmony.editorResult(${requestId}, JSON.stringify(value)))
          .catch(() => window.CPUHarmony.editorResult(${requestId}, JSON.stringify({error:'课程操作失败，请重试'})));
      `).catch(() => this.editorModel.accept(id, '{"error":"网页会话尚未就绪"}'));
    }, () => this.scheduleStore.load(true));
    if (context) {
      void preferences.getPreferences(context, { name: 'native_schedule_style' }).then(async (prefs) => {
        this.scheduleStore.palette = String(await prefs.get('palette', 'color-glass'));
        this.scheduleStore.backgroundPath = String(await prefs.get('background', ''));
        this.scheduleStore.backgroundOpacity = Number(await prefs.get('opacity', 0.18));
      }).catch(() => undefined);
    }
    setNativeScheduleHostCallbacks({
      onReady: () => this.scheduleStore.markBridgeReady(),
      onAuthChanged: (scope: string) => {
        if (!this.scheduleStore.handleAuthChanged(scope)) return;
        this.editorModel.cancel();
        this.widgetPreviewRevision += 1;
        this.widgetPreview = initialScheduleWidgetBinding(this.widgetDimension, this.widgetFormName);
        this.lockPreview = initialScheduleWidgetBinding(2, 'schedule_upcoming');
        this.widgetPanelVisible = false;
        this.widgetAutoSetupAttempted = false;
        this.widgetConfigured = false;
        this.widgetSettingsLoaded = false;
        if (context) {
          void clearScheduleWidgetAccount(context).finally(() => {
            this.widgetSettingsLoaded = true;
            if (this.scheduleStore.result && !this.widgetAutoSetupAttempted) {
              this.widgetAutoSetupAttempted = true;
              this.configureScheduleWidget();
            }
          });
        }
      },
      onNavigate: (path: string) => this.handleNativeNavigation(path),
      onWebOverlayChanged: (visible: boolean) => this.webOverlayVisible = visible,
      onResult: (id: string, payload: string) => this.scheduleStore.acceptResult(id, payload),
      onPrefetched: (payload: string) => this.scheduleStore.acceptPrefetched(payload),
      onWidgetSetupFailed: (message: string) => {
        this.widgetConfigured = false;
        promptAction.showToast({ message: message || '卡片配置失败' });
      },
      onAppearanceChanged: (mode: string) => this.applyAppearance(mode, false),
      onEditorResult: (id: string, payload: string) => this.editorModel.accept(id, payload)
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
      'saveImageUrl',
      'installScheduleWidget',
      'setScheduleWidgetTheme',
      'ready',
      'authChanged',
      'navigate',
      'scheduleResult',
      'schedulePrefetched',
      'scheduleWeekPrefetched',
      'widgetSetupFailed',
      'appearanceChanged',
      'webOverlayChanged',
      'editorResult'
    ];
  }

  private shouldOpenExternal(url: string): boolean {
    if (!url) return true;
    if (isHttpUrl(url)) {
      return !isAppOrigin(url);
    }
    return url.startsWith('tel:') || url.startsWith('mailto:') || url.startsWith('sms:');
  }

  private chooseFiles(event?: OnShowFileSelectorEvent): boolean {
    if (!event) return false;
    let mimeTypes: string[] = [];
    try {
      mimeTypes = event.fileSelector.getMimeTypes();
    } catch (_) {
      mimeTypes = [];
    }
    const accepted = [...mimeTypes, ...event.fileSelector.getAcceptType()]
      .flatMap((value: string) => value.split(/[,;\s]+/))
      .map((value: string) => value.trim().toLowerCase())
      .filter((value: string) => value.length > 0);
    const imageExtension = /\.(apng|avif|bmp|dng|gif|heic|heif|ico|jfif|jpe|jpeg|jpg|png|raw|svg|tif|tiff|webp)$/;
    const nonImageExtension = /\.(7z|apk|csv|doc|docx|epub|gz|json|md|mov|mp3|mp4|pdf|ppt|pptx|rar|tar|txt|wav|xls|xlsx|xml|zip)$/;
    const hasImageType = accepted.some((value: string) => value.startsWith('image/') || imageExtension.test(value));
    const hasNonImageType = accepted.some((value: string) => {
      if (value === '*' || value === '*/*') return false;
      if (value.startsWith('image/') || imageExtension.test(value)) return false;
      return value.includes('/') || nonImageExtension.test(value);
    });
    const imageOnly = hasImageType && !hasNonImageType;
    if (!imageOnly) {
      const context = AppStorage.get<common.UIAbilityContext>('abilityContext');
      if (!context) return false;
      const documentPicker = new picker.DocumentViewPicker(context);
      const options = new picker.DocumentSelectOptions();
      options.maxSelectNumber = event.fileSelector.getMode() === FileSelectorMode.FileOpenMultipleMode ? 20 : 1;
      documentPicker.select(options)
        .then((uris: string[]) => event.result.handleFileList(uris))
        .catch(() => event.result.handleFileList([]));
      return true;
    }

    const photoPicker = new photoAccessHelper.PhotoViewPicker();
    const options = new photoAccessHelper.PhotoSelectOptions();
    options.MIMEType = photoAccessHelper.PhotoViewMIMETypes.IMAGE_TYPE;
    options.maxSelectNumber = event.fileSelector.getMode() === FileSelectorMode.FileOpenMultipleMode ? 20 : 1;
    options.isPhotoTakingSupported = true;
    photoPicker.select(options)
      .then((result: photoAccessHelper.PhotoSelectResult) => {
        event.result.handleFileList(result.photoUris);
      })
      .catch(() => {
        event.result.handleFileList([]);
      });
    return true;
  }

  private async handleWebPermission(event: OnPermissionRequestEvent): Promise<void> {
    const origin = event.request.getOrigin();
    if (!isAppOrigin(origin)) {
      event.request.deny();
      return;
    }
    const resources = event.request.getAccessibleResource();
    const permissions: Permissions[] = [];
    if (resources.includes('TYPE_VIDEO_CAPTURE')) permissions.push('ohos.permission.CAMERA');
    if (resources.includes('TYPE_AUDIO_CAPTURE')) permissions.push('ohos.permission.MICROPHONE');
    if (permissions.length === 0) {
      event.request.grant(resources);
      return;
    }
    const context = AppStorage.get<common.UIAbilityContext>('abilityContext');
    if (!context) {
      event.request.deny();
      return;
    }
    try {
      const result = await abilityAccessCtrl.createAtManager().requestPermissionsFromUser(context, permissions);
      if (result.authResults.every((value: number) => value === 0)) event.request.grant(resources);
      else event.request.deny();
    } catch (_) {
      event.request.deny();
    }
  }

  private applyHarmonyUxPolicy(): void {
    const script = `
      (() => {
        document.documentElement.dataset.cpuPlatform = 'harmony';
        document.documentElement.dataset.cpuHarmonyNative = '1';
        const styleId = 'cpu-harmony-native-shell';
        let style = document.getElementById(styleId);
        if (!style) {
          style = document.createElement('style');
          style.id = styleId;
          document.head.appendChild(style);
        }
        style.textContent = [
          'html[data-cpu-harmony-native] { --cpu-harmony-bottom-clearance: ${100 + this.getUIContext().px2vp(this.systemBottomInsetPx)}px; --cpu-safe-area-inset-top: 0px; }',
          'html[data-cpu-harmony-native] .layout-root > .mobile-tabbar,',
          'html[data-cpu-harmony-native] .layout-root > .footer { display: none !important; }',
          'html[data-cpu-harmony-native] .layout-root { padding-bottom: 0 !important; }',
          'html[data-cpu-harmony-native] .layout-root > .main { padding-bottom: var(--cpu-harmony-bottom-clearance) !important; }',
          '.fade-enter-active, .fade-leave-active { transition-duration: 300ms !important; }',
          '@media (prefers-reduced-motion: reduce) { .fade-enter-active, .fade-leave-active { transition: none !important; } }'
        ].join('\\n');

        const host = window.CPUHarmony;
        if (host) {
          const bridge = window.CPUTimeNative || {};
          bridge.ready = () => host.ready();
          bridge.authChanged = () => {
            let scope = '';
            try {
              const account = sessionStorage.getItem('cpu-auth-cache-scope');
              if (localStorage.getItem('cpu-authenticated') === '1' && account?.startsWith('user-')) {
                scope = account + ':' + (localStorage.getItem('cpu-academic-identity-v1') || 'undergraduate');
              }
            } catch (_) {}
            host.authChanged(scope);
          };
          bridge.navigate = path => host.navigate(String(path || ''));
          bridge.schedulePrefetched = value => host.schedulePrefetched(JSON.stringify(value));
          bridge.scheduleWeekPrefetched = value => host.scheduleWeekPrefetched(JSON.stringify(value));
          bridge.loadSchedule = options => window.CPUTimeNativeScheduleFetch?.(
            options?.semester, options?.week, Boolean(options?.force)
          );
          bridge.openWebRoute = path => {
            const app = document.getElementById('app')?.__vue_app__;
            const router = app?.config?.globalProperties?.$router;
            return router?.push ? router.push(path) : undefined;
          };
          window.CPUTimeNative = bridge;
          try { if (sessionStorage.getItem('cpu-auth-cache-scope')?.startsWith('user-')) bridge.authChanged(); } catch (_) {}
          if (!window.__cpuHarmonyAppearanceObserver) {
            const update = () => host.appearanceChanged(document.documentElement.dataset.appearanceMode || 'system');
            window.__cpuHarmonyAppearanceObserver = new MutationObserver(update);
            window.__cpuHarmonyAppearanceObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-appearance-mode', 'data-theme'] });
            update();
          }

          ${this.compatibilityScript}

        }
      })();
    `;
    void this.controller.runJavaScript(script).catch(() => this.scheduleStore.markBridgeUnavailable('课表服务尚未就绪，请重试'));
  }

  private handleNativeNavigation(path: string): void {
    if (path === '/schedule' || path.startsWith('/schedule?')) {
      this.selectedTab = 2;
      if (path.includes('refresh=1')) {
        this.scheduleStore.selectedSemester = '';
        this.scheduleStore.selectedWeek = '';
        this.scheduleStore.result = undefined;
        this.scheduleStore.calendar = undefined;
        this.scheduleStore.load(true);
      } else {
        this.scheduleStore.load(false);
      }
    }
  }

  private requestSchedule(request: NativeScheduleRequest): void {
    if (!request.id) {
      const semester = JSON.stringify(request.semester);
      const week = JSON.stringify(request.week);
      const script = `window.CPUTimeNativeSchedulePrioritize?.(${semester}, ${week});`;
      void this.controller.runJavaScript(script).catch(() => undefined);
      return;
    }
    const id = JSON.stringify(request.id);
    const semester = request.semester ? JSON.stringify(request.semester) : 'undefined';
    const week = request.week ? JSON.stringify(request.week) : 'undefined';
    const force = request.force ? 'true' : 'false';
    const script = `
      (() => {
        const id = ${id};
        const fetchSchedule = window.CPUTimeNativeScheduleFetch || window.CPUTimeNative?.loadSchedule;
        if (typeof fetchSchedule !== 'function') {
          window.CPUHarmony.scheduleResult(id, JSON.stringify({
            version: 1, auth: { authenticated: true }, error: '课表桥尚未准备好'
          }));
          return;
        }
        const task = window.CPUTimeNativeScheduleFetch
          ? window.CPUTimeNativeScheduleFetch(${semester}, ${week}, ${force})
          : fetchSchedule({ semester: ${semester}, week: ${week}, force: ${force} });
        Promise.resolve(task).then(value => {
          window.CPUHarmony.scheduleResult(id, JSON.stringify(value));
        }).catch(error => {
          window.CPUHarmony.scheduleResult(id, JSON.stringify({
            version: 1,
            auth: { authenticated: true },
            error: error?.message || '课表暂时无法加载，请重试'
          }));
        });
      })();
    `;
    void this.controller.runJavaScript(script).catch(() => {
      this.scheduleStore.acceptResult(
        request.id,
        '{"version":1,"auth":{"authenticated":true},"error":"网页会话尚未准备好"}'
      );
    });
  }

  private selectTab(index: number, destination?: string): void {
    if (index < 0 || index > 4) return;
    const revision = ++this.navigationRevision;
    this.selectedTab = index;
    if (index === 2) {
      this.scheduleStore.load(false);
      return;
    }
    const routes: string[] = ['/home', '/jwxt', '/schedule', '/services', '/profile'];
    const path = destination ?? routes[index];
    const route = JSON.stringify(path);
    const script = `
      (() => {
        const path = ${route};
        const openRoute = window.CPUTimeNative?.openWebRoute;
        if (typeof openRoute === 'function') return openRoute(path);
        if (location.pathname !== path) location.assign(path);
      })();
    `;
    void this.controller.runJavaScript(script).catch(() => {
      if (revision === this.navigationRevision) this.controller.loadUrl(`https://cputime.cn${path}`);
    });
  }

  private configureScheduleWidget(): void {
    const theme = JSON.stringify(this.widgetTheme);
    const script = `
      (async () => {
        const cookie = name => {
          const item = document.cookie.split(';').map(value => value.trim()).find(value => value.startsWith(name + '='));
          return item ? decodeURIComponent(item.slice(name.length + 1)) : '';
        };
        try {
          const response = await fetch('/api/jwxt/schedule-widget-tokens', {
            method: 'POST', credentials: 'same-origin',
            headers: {
              'Content-Type': 'application/json',
              'X-CPU-Auth-Mode': 'cookie',
              'X-CPU-Client': 'harmony-app',
              'X-CSRF-Token': cookie('__Host-cpu-csrf') || cookie('cpu-csrf')
            },
            body: JSON.stringify({ name: 'HarmonyOS 原生卡片' })
          });
          const body = await response.json();
          if (!response.ok || body.code !== 0) throw new Error(body.message || '配置失败，请先完成教务授权');
          window.CPUHarmony.installScheduleWidget(JSON.stringify({ endpoint: body.data.endpoint, theme: ${theme} }));
        } catch (error) {
          window.CPUHarmony.widgetSetupFailed(error?.message || '卡片配置失败');
        }
      })();
    `;
    void this.controller.runJavaScript(script).catch(() => {
      this.widgetConfigured = false;
    });
  }

  build() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column().width('100%').height('100%')
        .backgroundColor($r('app.color.app_background'))
        .hitTestBehavior(HitTestMode.None)
      Column() {
        Stack() {
          Web({
            src: this.launchUrl,
            controller: this.controller,
            renderMode: RenderMode.SYNC_RENDER
          })
        .width('100%')
        .height('100%')
        .accessibilityLevel(this.selectedTab === 2 ? 'no-hide-descendants' : 'auto')
        .javaScriptAccess(true)
        .domStorageAccess(true)
        .databaseAccess(true)
        .fileAccess(true)
        .onlineImageAccess(true)
        .mixedMode(MixedMode.None)
        .metaViewport(true)
        .initialScale(100)
        .textZoomRatio(100)
        .onControllerAttached(() => {
          try {
            const current = this.controller.getUserAgent()
              .replace(/\sCPUTimeNative\/[^\s]+/g, '')
              .replace(/\sCPUWebHarmonyApp(?:Version)?\/[^\s]+/g, '');
            this.controller.setCustomUserAgent(`${current} ${USER_AGENT_SUFFIX}`);
          } catch (_) {
            // Keep the system user agent if the controller is not ready yet.
          }
        })
        .javaScriptProxy({
          object: this.webProxy,
          name: 'CPUHarmony',
          methodList: this.bridgeMethods(),
          controller: this.controller
        })
        .onPageBegin(() => {
          this.loading = true;
          this.failed = false;
          this.webOverlayVisible = false;
          this.scheduleStore.markBridgeUnavailable();
        })
        .onPageEnd(() => {
          this.loading = false;
          this.applyHarmonyUxPolicy();
        })
        .onErrorReceive((event) => {
          if (!event.request.isMainFrame()) return;
          this.loading = false;
          this.failed = true;
          this.scheduleStore.markBridgeUnavailable('网络连接失败，请重新打开页面');
        })
        .onLoadIntercept((event) => {
          const url = event?.data?.getRequestUrl?.() ?? '';
          if (this.shouldOpenExternal(url)) {
            this.bridge.openExternalUrl(url);
            return true;
          }
          return false;
        })
        .onPermissionRequest((event) => void this.handleWebPermission(event))
        .onDownloadStart((event) => this.bridge.openExternalUrl(event.url))
        .onShowFileSelector((event) => this.chooseFiles(event))

          if (this.selectedTab === 2) {
            NativeSchedulePage({
              store: this.scheduleStore,
              bottomSafeInset: this.getUIContext().px2vp(this.systemBottomInsetPx),
              onLogin: () => {
                this.selectTab(1);
                const script = `window.CPUTimeNative?.openWebRoute?.('/jwxt?reauthorize=1&redirect=/schedule');`;
                void this.controller.runJavaScript(script).catch(() => this.controller.loadUrl('https://cputime.cn/login'));
              },
              onWidgets: () => { this.widgetPanelVisible = true; void this.loadWidgetPreview(); },
              onTools: () => this.openCourseEditor(),
              onEdit: (block: NativeCourseBlock) => this.openCourseEditor(block),
              onAddSlot: (day: number, slot: number) => this.openCourseEditor(undefined, day, slot),
              onStyle: () => this.scheduleStyleVisible = true,
              onAppearance: () => this.chooseAppearance(),
              onShare: () => this.shareSchedule(),
              onExport: () => { void this.exportSchedule(); }
            })
          }

      if (this.loading && this.selectedTab !== 2) {
        Column({ space: 16 }) {
          Image($r('app.media.app_icon'))
            .width(84)
            .height(84)
            .borderRadius(24)

          Text(APP_NAME)
            .fontSize(28)
            .fontWeight(FontWeight.Bold)
            .fontColor($r('app.color.app_text_primary'))

          Text('正在打开你的校园服务')
            .fontSize(15)
            .fontColor($r('app.color.app_text_secondary'))
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.Center)
        .alignItems(HorizontalAlign.Center)
        .backgroundColor('#EDF4FF')
      }

      if (this.failed && this.selectedTab !== 2) {
        Column({ space: 16 }) {
          Text('页面暂时无法打开')
            .fontSize(20)
            .fontWeight(FontWeight.Bold)
            .fontColor($r('app.color.app_text_primary'))

          Text('请检查网络连接，或稍后重试。')
            .fontSize(14)
            .fontColor($r('app.color.app_text_secondary'))

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
        .backgroundColor($r('app.color.app_background'))
      }
        }
        .width('100%')
        .layoutWeight(1)

      }
      .width('100%')
      .height('100%')
      .padding({ top: this.getUIContext().px2vp(this.systemTopInsetPx) })

      Column() {
        this.bottomNavigation()
      }.width('100%').height(84 + this.getUIContext().px2vp(this.systemBottomInsetPx)).align(Alignment.Bottom)
        .visibility(this.selectedTab === 2 || !this.webOverlayVisible ? Visibility.Visible : Visibility.Hidden)
        .hitTestBehavior(HitTestMode.Transparent)

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
                  .fontColor($r('app.color.app_text_primary'))

                Text('请点击下方系统按钮授权保存到相册')
                  .fontSize(13)
                  .fontColor($r('app.color.app_text_secondary'))
              }
              .alignItems(HorizontalAlign.Start)
              .layoutWeight(1)

              Button('取消')
                .type(ButtonType.Normal)
                .fontSize(14)
                .fontColor($r('app.color.app_text_secondary'))
                .backgroundColor($r('app.color.app_control'))
                .enabled(!this.saveBusy)
                .onClick(() => this.closeSavePanel())
            }
            .width('100%')
            .alignItems(VerticalAlign.Center)

            if (this.pendingImageFileName) {
              Text(this.pendingImageFileName)
                .width('100%')
                .fontSize(12)
                .fontColor($r('app.color.app_text_tertiary'))
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
          .backgroundColor($r('app.color.app_surface'))
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
    .bindSheet(this.editorModel.visible || this.scheduleStyleVisible || this.widgetPanelVisible, this.nativePanelSheet(), {
      height: SheetSize.LARGE, showClose: true, dragBar: true,
      onWillDismiss: (action: DismissSheetAction) => { if (!this.editorModel.busy) action.dismiss(); },
      onDisappear: () => { this.editorModel.cancel(); this.scheduleStyleVisible = false; this.widgetPanelVisible = false; this.widgetPreviewRevision += 1; }
    })
  }

  private openCourseEditor(block?: NativeCourseBlock, day?: number, slot?: number): void {
    if (!this.scheduleStore.result || this.scheduleStore.source === 'graduate') {
      promptAction.showToast({ message: '请先加载本科课表，研究生课表暂不支持个人修改' });
      return;
    }
    this.scheduleStore.detailVisible = false;
    const snapshot = this.scheduleStore.result;
    const revision = this.navigationRevision;
    setTimeout(() => {
      if (this.selectedTab !== 2 || revision !== this.navigationRevision || this.scheduleStore.result !== snapshot) return;
      this.editorModel.open(this.scheduleStore, block);
      if (day !== undefined && slot !== undefined) {
        this.editorModel.day = day;
        this.editorModel.startSlot = slot;
        this.editorModel.endSlot = Math.min(11, slot + 1);
      }
    }, 250);
  }

  @Builder
  private nativePanelSheet() {
    if (this.widgetPanelVisible) {
      this.widgetSettingsPanel()
    } else if (this.editorModel.visible) {
      NativeCourseEditor({ model: this.editorModel })
    } else {
      this.scheduleStyleSheet()
    }
  }

  @Builder
  private paletteChoices(selected: string, widget: boolean) {
    Scroll() {
      Row({ space: 4 }) {
        ForEach(['color-glass','green','blue','teal','indigo','violet','orange','rose','slate'], (theme: string) => {
          Button() {
            Column({ space: 6 }) {
              Stack() {
                Circle().width(32).height(32).fill(Color.Transparent)
                  .stroke(selected === theme ? $r('app.color.app_accent') : Color.Transparent).strokeWidth(1.5)
                Circle().width(24).height(24).fill(this.widgetThemeColor(theme))
              }.width(36).height(36)
              Text(this.widgetThemeLabel(theme)).fontSize(10)
                .fontColor(selected === theme ? $r('app.color.app_text_primary') : $r('app.color.app_text_secondary'))
            }
          }.type(ButtonType.Normal).width(48).height(64).padding(0).backgroundColor(Color.Transparent)
            .accessibilityText(this.widgetThemeLabel(theme) + '配色').accessibilitySelected(selected === theme)
            .onClick(() => {
              if (widget) { void this.updateWidgetTheme(theme); }
              else { this.scheduleStore.palette = theme; this.saveScheduleStyle(); }
            })
        })
      }.padding({ left: 2, right: 2 })
    }.width('100%').height(70).scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off)
  }

  @Builder
  private scheduleStyleSheet() {
    Scroll() {
      Column({ space: 20 }) {
        Text('课表样式').fontSize(22).fontWeight(FontWeight.Bold).fontColor($r('app.color.app_text_primary')).width('100%')
        Column({ space: 8 }) {
          Text('课程配色').fontSize(14).fontWeight(FontWeight.Medium).fontColor($r('app.color.app_text_primary')).width('100%')
          this.paletteChoices(this.scheduleStore.palette, false)
        }.width('100%')
        Column({ space: 12 }) {
          Text('背景图片').fontSize(14).fontWeight(FontWeight.Medium).fontColor($r('app.color.app_text_primary')).width('100%')
          Button('从相册选择').type(ButtonType.Normal).height(48).width('100%').borderRadius(14).fontSize(14)
            .fontColor($r('app.color.app_accent')).backgroundColor($r('app.color.app_control'))
            .onClick(() => { void this.chooseScheduleBackground(); })
          if (this.scheduleStore.backgroundPath) {
            Text('背景可见度').fontSize(13).fontColor($r('app.color.app_text_secondary')).width('100%')
            Slider({ value: this.scheduleStore.backgroundOpacity * 100, min: 5, max: 35, step: 1 })
              .selectedColor($r('app.color.app_accent'))
              .onChange((value: number) => { this.scheduleStore.backgroundOpacity = value / 100; this.saveScheduleStyle(); })
            Button('移除背景图片').height(44).width('100%').fontSize(13)
              .fontColor($r('app.color.app_text_secondary')).backgroundColor(Color.Transparent)
              .onClick(() => this.removeScheduleBackground())
          }
        }.width('100%')
      }.width('100%').padding({ left: 20, right: 20, top: 32, bottom: 40 })
    }.height('100%').width('100%').scrollBar(BarState.Off).backgroundColor($r('app.color.app_surface'))
  }

  private saveScheduleStyle(): void {
    const context = AppStorage.get<common.UIAbilityContext>('abilityContext');
    if (!context) return;
    void preferences.getPreferences(context, { name: 'native_schedule_style' }).then(async (prefs) => {
      await prefs.put('palette', this.scheduleStore.palette);
      await prefs.put('background', this.scheduleStore.backgroundPath);
      await prefs.put('opacity', this.scheduleStore.backgroundOpacity);
      await prefs.flush();
    }).catch(() => promptAction.showToast({ message: '样式保存失败，请重试' }));
  }

  private removeScheduleBackground(): void {
    const previous = this.scheduleStore.backgroundPath;
    this.scheduleStore.backgroundPath = '';
    this.saveScheduleStyle();
    const context = AppStorage.get<common.UIAbilityContext>('abilityContext');
    if (!context) return;
    const prefix = `file://${context.filesDir}/schedule-background-`;
    if (previous.startsWith(prefix) && /^\d+\.jpg$/.test(previous.substring(prefix.length))) {
      try { fs.unlinkSync(previous.substring(7)); } catch (_) {}
    }
  }

  private async chooseScheduleBackground(): Promise<void> {
    const context = AppStorage.get<common.UIAbilityContext>('abilityContext');
    if (!context) return;
    try {
      const photoPicker = new photoAccessHelper.PhotoViewPicker();
      const options = new photoAccessHelper.PhotoSelectOptions();
      options.MIMEType = photoAccessHelper.PhotoViewMIMETypes.IMAGE_TYPE;
      options.maxSelectNumber = 1;
      const selected = await photoPicker.select(options);
      if (!selected.photoUris.length) return;
      const source = fs.openSync(selected.photoUris[0], fs.OpenMode.READ_ONLY);
      const target = `${context.filesDir}/schedule-background-${Date.now()}.jpg`;
      try {
        if (fs.statSync(source.fd).size > 15 * 1024 * 1024) throw new Error('请选择小于 15 MB 的背景图片');
        fs.copyFileSync(source.fd, target);
      } finally { fs.closeSync(source); }
      const previous = this.scheduleStore.backgroundPath;
      this.scheduleStore.backgroundPath = `file://${target}`;
      this.saveScheduleStyle();
      if (previous.startsWith(`file://${context.filesDir}/schedule-background-`)) {
        try { fs.unlinkSync(previous.substring(7)); } catch (_) {}
      }
    } catch (error) {
      promptAction.showToast({ message: error instanceof Error ? error.message : '图片读取失败' });
    }
  }

  private chooseAppearance(): void {
    void promptAction.showActionMenu({
      title: '应用外观', buttons: [
        { text: '跟随系统', color: '#168776' },
        { text: '浅色', color: '#168776' },
        { text: '深色', color: '#168776' }
      ]
    }).then((result) => this.applyAppearance(['system', 'light', 'dark'][result.index], true))
      .catch(() => undefined);
  }

  private applyAppearance(value: string, updateWeb: boolean): void {
    const mode = value === 'dark' || value === 'light' ? value : 'system';
    const context = AppStorage.get<common.UIAbilityContext>('abilityContext');
    if (!context) return;
    this.appearanceMode = mode;
    if (this.appliedAppearanceMode !== mode) {
      this.appliedAppearanceMode = mode;
      context.getApplicationContext().setColorMode(mode === 'dark' ? ConfigurationConstant.ColorMode.COLOR_MODE_DARK :
        mode === 'light' ? ConfigurationConstant.ColorMode.COLOR_MODE_LIGHT : ConfigurationConstant.ColorMode.COLOR_MODE_NOT_SET);
    }
    const dark = mode === 'dark' || (mode === 'system' && context.config.colorMode === ConfigurationConstant.ColorMode.COLOR_MODE_DARK);
    this.scheduleStore.dark = dark;
    void window.getLastWindow(context).then((mainWindow) => mainWindow.setWindowSystemBarProperties({
      statusBarColor: dark ? '#151A17' : '#F7F8F6', statusBarContentColor: dark ? '#FFFFFF' : '#202722',
      navigationBarColor: '#00000000', navigationBarContentColor: dark ? '#FFFFFF' : '#172033'
    })).catch(() => undefined);
    void preferences.getPreferences(context, { name: 'native_appearance' }).then(async (prefs) => {
      await prefs.put('mode', mode);
      await prefs.flush();
    }).catch(() => undefined);
    if (updateWeb) {
      const encodedMode = JSON.stringify(mode);
      void this.controller.runJavaScript(`document.getElementById('app')?.__vue_app__?.config?.globalProperties?.$pinia?._s?.get('appearance')?.setMode(${encodedMode});`)
        .catch(() => undefined);
    }
  }

  private shareSchedule(): void {
    const context = AppStorage.get<common.UIAbilityContext>('abilityContext');
    if (!context || !this.scheduleStore.result) {
      promptAction.showToast({ message: '请先加载课表' });
      return;
    }
    try {
      const data = new systemShare.SharedData({ utd: 'general.plain-text', content: scheduleText(this.scheduleStore) });
      const controller = new systemShare.ShareController(data);
      void controller.show(context, { selectionMode: systemShare.SelectionMode.SINGLE })
        .catch(() => promptAction.showToast({ message: '分享面板暂时不可用' }));
    } catch (_) {
      promptAction.showToast({ message: '分享面板暂时不可用' });
    }
  }

  private async exportSchedule(): Promise<void> {
    const context = AppStorage.get<common.UIAbilityContext>('abilityContext');
    if (!context || !this.scheduleStore.result) {
      promptAction.showToast({ message: '请先加载课表' });
      return;
    }
    try {
      const calendar = scheduleCalendar(this.scheduleStore);
      const viewPicker = new picker.DocumentViewPicker(context);
      const options = new picker.DocumentSaveOptions();
      options.newFileNames = [`课表-${this.scheduleStore.selectedSemester}-第${this.scheduleStore.selectedWeek}周.ics`];
      const uris = await viewPicker.save(options);
      if (!uris.length) return;
      const file = fs.openSync(uris[0], fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
      try { fs.writeSync(file.fd, calendar); } finally { fs.closeSync(file); }
      promptAction.showToast({ message: '日历文件已保存' });
    } catch (error) {
      promptAction.showToast({ message: error instanceof Error ? error.message : '日历导出失败' });
    }
  }

  @Builder
  private tabItems() {
    TabContent() { Column() {} }
      .tabBar(new BottomTabBarStyle({
        normal: new SymbolGlyphModifier($r('sys.symbol.house')).fontSize(20).fontColor([$r('app.color.app_text_secondary')]),
        selected: new SymbolGlyphModifier($r('sys.symbol.house_fill')).fontSize(20).fontColor([$r('app.color.app_accent')])
      }, '首页')
        .labelStyle({ font: { size: 10, weight: FontWeight.Medium }, selectedColor: $r('app.color.app_accent'), unselectedColor: $r('app.color.app_text_secondary') })
        .iconStyle({ selectedColor: $r('app.color.app_accent'), unselectedColor: $r('app.color.app_text_secondary') }))
    TabContent() { Column() {} }
      .tabBar(new BottomTabBarStyle({
        normal: new SymbolGlyphModifier($r('sys.symbol.book_pages')).fontSize(20).fontColor([$r('app.color.app_text_secondary')]),
        selected: new SymbolGlyphModifier($r('sys.symbol.book_pages_fill')).fontSize(20).fontColor([$r('app.color.app_accent')])
      }, '教务')
        .labelStyle({ font: { size: 10, weight: FontWeight.Medium }, selectedColor: $r('app.color.app_accent'), unselectedColor: $r('app.color.app_text_secondary') })
        .iconStyle({ selectedColor: $r('app.color.app_accent'), unselectedColor: $r('app.color.app_text_secondary') }))
    TabContent() { Column() {} }
      .tabBar(new BottomTabBarStyle({
        normal: new SymbolGlyphModifier($r('sys.symbol.calendar')).fontSize(20).fontColor([$r('app.color.app_text_secondary')]),
        selected: new SymbolGlyphModifier($r('sys.symbol.calendar')).fontSize(20).fontColor([$r('app.color.app_accent')])
      }, '课表')
        .labelStyle({ font: { size: 10, weight: FontWeight.Medium }, selectedColor: $r('app.color.app_accent'), unselectedColor: $r('app.color.app_text_secondary') })
        .iconStyle({ selectedColor: $r('app.color.app_accent'), unselectedColor: $r('app.color.app_text_secondary') }))
    TabContent() { Column() {} }
      .tabBar(new BottomTabBarStyle({
        normal: new SymbolGlyphModifier($r('sys.symbol.square_grid_2x2')).fontSize(20).fontColor([$r('app.color.app_text_secondary')]),
        selected: new SymbolGlyphModifier($r('sys.symbol.square_grid_2x2')).fontSize(20).fontColor([$r('app.color.app_accent')])
      }, '服务')
        .labelStyle({ font: { size: 10, weight: FontWeight.Medium }, selectedColor: $r('app.color.app_accent'), unselectedColor: $r('app.color.app_text_secondary') })
        .iconStyle({ selectedColor: $r('app.color.app_accent'), unselectedColor: $r('app.color.app_text_secondary') }))
    TabContent() { Column() {} }
      .tabBar(new BottomTabBarStyle({
        normal: new SymbolGlyphModifier($r('sys.symbol.person')).fontSize(20).fontColor([$r('app.color.app_text_secondary')]),
        selected: new SymbolGlyphModifier($r('sys.symbol.person_fill')).fontSize(20).fontColor([$r('app.color.app_accent')])
      }, '我的')
        .labelStyle({ font: { size: 10, weight: FontWeight.Medium }, selectedColor: $r('app.color.app_accent'), unselectedColor: $r('app.color.app_text_secondary') })
        .iconStyle({ selectedColor: $r('app.color.app_accent'), unselectedColor: $r('app.color.app_text_secondary') }))
  }

  @Builder
  private bottomNavigation() {
    if (deviceInfo.sdkApiVersion >= 23) {
      HdsTabs({ barPosition: BarPosition.End, index: this.selectedTab }) {
        this.tabItems()
      }
      .width('100%').height(76 + this.getUIContext().px2vp(this.systemBottomInsetPx)).barHeight(56)
      .barBackgroundColor($r('app.color.app_surface'))
      .barFloatingStyle({ barSideMargin: 20, barBottomMargin: 8 + this.getUIContext().px2vp(this.systemBottomInsetPx),
        gradientMask: { maskColor: Color.Transparent, maskHeight: 0 },
        systemMaterialEffect: { materialType: hdsMaterial.MaterialType.ADAPTIVE, materialLevel: hdsMaterial.MaterialLevel.ADAPTIVE } })
      .barOverlap(true).scrollable(false).animationDuration(0)
      .onTabBarClick((index: number) => this.selectTab(index))
    } else {
      Tabs({ barPosition: BarPosition.End, index: this.selectedTab }) { this.tabItems() }
        .width('100%').height(76).barHeight(56).scrollable(false).animationDuration(0)
        .margin({ bottom: this.getUIContext().px2vp(this.systemBottomInsetPx) })
        .barBackgroundBlurStyle(BlurStyle.COMPONENT_THICK)
        .onTabBarClick((index: number) => this.selectTab(index))
    }
  }

  private async loadWidgetPreview(): Promise<void> {
    const revision = ++this.widgetPreviewRevision;
    const context = AppStorage.get<common.UIAbilityContext>('abilityContext');
    if (!context) return;
    this.widgetPreview = initialScheduleWidgetBinding(this.widgetDimension, this.widgetFormName);
    const preview = await readScheduleWidgetPreview(context, this.widgetDimension, this.widgetFormName);
    if (revision !== this.widgetPreviewRevision || !this.widgetPanelVisible) return;
    this.widgetPreview = preview;
    const lockPreview = await readScheduleWidgetPreview(context, 2, 'schedule_upcoming');
    if (revision === this.widgetPreviewRevision && this.widgetPanelVisible) this.lockPreview = lockPreview;
  }

  private selectWidgetLayout(name: string): void {
    this.widgetFormName = name;
    this.widgetDimension = name === 'schedule_upcoming' ? 2 : name === 'schedule_today' ? 3 : 4;
    void this.loadWidgetPreview();
  }

  private async updateWidgetTheme(theme: string): Promise<void> {
    this.widgetTheme = theme;
    const context = AppStorage.get<common.UIAbilityContext>('abilityContext');
    if (!context) return;
    await saveScheduleWidgetTheme(context, theme);
    void refreshAllScheduleForms(context);
    void this.loadWidgetPreview();
  }

  @Builder
  private widgetSettingsPanel() {
    Scroll() {
      Column({ space: 20 }) {
        Text('课表卡片').fontSize(22).fontWeight(FontWeight.Bold)
          .fontColor($r('app.color.app_text_primary')).width('100%')
        Text(this.widgetConfigured ? '使用教务课表，点击卡片查看课程' : '连接教务课表后即可使用')
          .fontSize(13).fontColor($r('app.color.app_text_secondary')).width('100%')
        Row({ space: 6 }) {
          ForEach(['schedule_upcoming', 'schedule_today', 'schedule_two_day'], (name: string) => {
            Button(name === 'schedule_upcoming' ? '临近课程' : name === 'schedule_today' ? '今日课表' : '两日课表')
              .type(ButtonType.Normal).height(34).layoutWeight(1).fontSize(12).padding(0).borderRadius(17)
              .fontColor(this.widgetFormName === name ? $r('app.color.app_text_primary') : $r('app.color.app_text_secondary'))
              .backgroundColor(this.widgetFormName === name ? $r('app.color.app_surface') : Color.Transparent)
              .accessibilitySelected(this.widgetFormName === name).onClick(() => this.selectWidgetLayout(name))
          })
        }.width('100%').padding(3).backgroundColor($r('app.color.app_control')).borderRadius(20)
        if (this.widgetFormName !== 'schedule_two_day') {
          Row({ space: 8 }) {
            ForEach(this.widgetFormName === 'schedule_upcoming' ? [2,3] : [3,4], (dimension: number) => {
              Button(dimension === 2 ? '小号' : dimension === 3 ? '中号' : '大号').height(32).fontSize(12)
                .fontColor($r('app.color.app_accent'))
                .backgroundColor(this.widgetDimension === dimension ? $r('app.color.app_accent_surface') : Color.Transparent)
                .onClick(() => { this.widgetDimension = dimension; void this.loadWidgetPreview(); })
            })
          }.width('100%').justifyContent(FlexAlign.Center)
        }
        Row() {
          ScheduleCardView({
            state: this.widgetPreview.state, title: this.widgetPreview.title, subtitle: this.widgetPreview.subtitle,
            leftTitle: this.widgetPreview.leftTitle, rightTitle: this.widgetPreview.rightTitle,
            primaryCourses: this.widgetPreview.primaryCourses, secondaryCourses: this.widgetPreview.secondaryCourses,
            footer: this.widgetPreview.footer, theme: this.widgetPreview.theme, accent: this.widgetPreview.accent,
            semester: this.widgetPreview.semester, currentWeek: this.widgetPreview.currentWeek,
            primaryWeek: this.widgetPreview.primaryWeek, secondaryWeek: this.widgetPreview.secondaryWeek,
            primaryRemaining: this.widgetPreview.primaryRemaining, secondaryRemaining: this.widgetPreview.secondaryRemaining,
            dimension: this.widgetDimension, variant: this.widgetPreview.variant, layout: this.widgetPreview.layout
          }).width(this.widgetDimension === 2 ? 150 : '100%').height(this.widgetDimension === 4 ? 348 : 150)
            .clip(true).borderRadius(22).border({ width: 0.5, color: $r('app.color.app_divider') })
        }.width('100%').justifyContent(FlexAlign.Center)
        Column({ space: 8 }) {
          Text('课程配色').fontSize(14).fontWeight(FontWeight.Medium).fontColor($r('app.color.app_text_primary')).width('100%')
          this.paletteChoices(this.widgetTheme, true)
        }.width('100%')
        Button(this.widgetConfigured ? '刷新卡片' : '连接教务课表').width('100%').height(44).fontSize(14)
          .fontColor($r('app.color.app_on_accent')).backgroundColor($r('app.color.app_accent'))
          .onClick(() => { this.widgetAutoSetupAttempted = true; this.configureScheduleWidget(); })
        Text('添加到桌面').fontSize(14).fontWeight(FontWeight.Medium).fontColor($r('app.color.app_text_primary')).width('100%')
        Text('长按桌面的药大拾间图标，选择「卡片」，挑选样式后添加。')
          .fontSize(13).fontColor($r('app.color.app_text_secondary')).width('100%')
        Text('锁屏卡片').fontSize(14).fontWeight(FontWeight.Medium).fontColor($r('app.color.app_text_primary')).width('100%')
        Text('在支持的设备上，通过系统锁屏编辑页添加。')
          .fontSize(13).fontColor($r('app.color.app_text_secondary')).width('100%')
        Column({ space: 12 }) {
          Row({ space: 12 }) {
            Column() { this.lockCardPreview('lock-circular') }
              .width(72).height(72).backgroundColor('#35443C').borderRadius(36)
            Column() { this.lockCardPreview('lock-rectangular') }
              .layoutWeight(1).height(86).backgroundColor('#35443C').borderRadius(18)
          }.width('100%')
          Column() { this.lockCardPreview('lock-inline') }
            .width('100%').height(42).backgroundColor('#35443C').borderRadius(14)
        }.width('100%')
      }.width('100%').padding({left: 20, right: 20, top: 32, bottom: 40})
    }.width('100%').height('100%').scrollBar(BarState.Off).backgroundColor($r('app.color.app_surface'))
  }

  @Builder
  private lockCardPreview(variant: string) {
    ScheduleCardView({ state: this.lockPreview.state, subtitle: this.lockPreview.subtitle,
      leftTitle: this.lockPreview.leftTitle, primaryCourses: this.lockPreview.primaryCourses,
      primaryWeek: this.lockPreview.primaryWeek, footer: this.lockPreview.footer,
      variant, dimension: 2, layout: 'upcoming' })
  }

  private widgetThemeLabel(theme: string): string {
    const labels: Map<string, string> = new Map<string, string>([
      ['color-glass', '多彩'], ['green', '青绿'], ['blue', '蓝色'], ['teal', '湖蓝'], ['indigo', '靛粉'],
      ['violet', '紫色'], ['orange', '橙色'], ['rose', '玫红'], ['slate', '石墨']
    ]);
    return labels.get(theme) ?? theme;
  }

  private widgetThemeColor(theme: string): string {
    const colors: Map<string, string> = new Map<string, string>([
      ['color-glass', '#799989'], ['green', '#168776'], ['blue', '#2563EB'], ['teal', '#0891B2'],
      ['indigo', '#DB2777'], ['violet', '#7C3AED'], ['orange', '#EA580C'], ['rose', '#E11D48'], ['slate', '#475569']
    ]);
    return colors.get(theme) ?? '#376FD6';
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
    if (this.editorModel.visible || this.scheduleStyleVisible) {
      if (this.editorModel.busy) return true;
      this.editorModel.cancel();
      this.scheduleStyleVisible = false;
      return true;
    }
    if (this.widgetPanelVisible) {
      this.widgetPanelVisible = false;
      this.widgetPreviewRevision += 1;
      return true;
    }
    if (this.imagePreviewVisible) {
      this.closeImagePreview();
      return true;
    }
    if (this.savePanelVisible) {
      this.closeSavePanel();
      return true;
    }
    if (this.scheduleStore.detailVisible || this.scheduleStore.weekPickerVisible) {
      this.scheduleStore.detailVisible = false;
      this.scheduleStore.weekPickerVisible = false;
      return true;
    }
    if (this.selectedTab === 2) {
      this.selectTab(0);
      return true;
    }
    if (this.webOverlayVisible) {
      void this.controller.runJavaScript(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));`)
        .catch(() => undefined);
      return true;
    }
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

  aboutToDisappear(): void {
    this.scheduleStore.markBridgeUnavailable();
    clearNativeScheduleHostCallbacks();
    setActiveHarmonyBridge(undefined);
  }
}
