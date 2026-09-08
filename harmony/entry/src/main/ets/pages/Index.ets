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
import { NativeSchedulePage } from '../schedule/NativeSchedulePage';
import { NativeScheduleRequest, NativeScheduleStore } from '../schedule/NativeScheduleStore';
import {
  NativeScheduleHost,
  setNativeScheduleHostCallbacks
} from '../schedule/NativeScheduleHost';
import { readScheduleWidgetSettings } from '../common/ScheduleWidgetService';

@Entry
@Component
struct Index {
  private controller: webview.WebviewController = new webview.WebviewController();
  private bridge: HarmonyBridge = new HarmonyBridge();
  private webProxy: HarmonyJavaScriptProxy = new HarmonyJavaScriptProxy();
  private nativeScheduleHost: NativeScheduleHost = new NativeScheduleHost();
  private scheduleStore: NativeScheduleStore = new NativeScheduleStore();
  @StorageLink('launchUrl') private launchUrl: string = APP_URL;
  @StorageLink('nativeTab') private selectedTab: number = 0;
  @State private loading: boolean = true;
  @State private failed: boolean = false;
  @State private scheduleRevision: number = 0;
  @State private widgetPanelVisible: boolean = false;
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
    setActiveHarmonyBridge(this.bridge);
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
    this.bridge.setWidgetConfigurationHandler((configured: boolean) => {
      this.widgetConfigured = configured;
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
        this.scheduleRevision += 1;
        if (this.scheduleStore.result && this.widgetSettingsLoaded && !this.widgetConfigured && !this.widgetAutoSetupAttempted) {
          this.widgetAutoSetupAttempted = true;
          this.configureScheduleWidget();
        }
      }
    );
    setNativeScheduleHostCallbacks({
      onReady: () => this.scheduleStore.markBridgeReady(),
      onAuthChanged: () => {
        this.widgetAutoSetupAttempted = false;
        this.scheduleStore.handleAuthChanged();
      },
      onNavigate: (path: string) => this.handleNativeNavigation(path),
      onResult: (id: string, payload: string) => this.scheduleStore.acceptResult(id, payload),
      onPrefetched: (payload: string) => this.scheduleStore.acceptPrefetched(payload),
      onWidgetSetupFailed: (message: string) => {
        this.widgetConfigured = false;
        promptAction.showToast({ message: message || '卡片配置失败' });
      }
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
      'setScheduleWidgetTheme'
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

  private nativeScheduleHostMethods(): string[] {
    return [
      'ready',
      'authChanged',
      'navigate',
      'scheduleResult',
      'schedulePrefetched',
      'scheduleWeekPrefetched',
      'widgetSetupFailed'
    ];
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
          'html[data-cpu-harmony-native] { --cpu-harmony-bottom-clearance: 92px; }',
          'html[data-cpu-harmony-native] .layout-root > .topbar,',
          'html[data-cpu-harmony-native] .layout-root > .mobile-tabbar,',
          'html[data-cpu-harmony-native] .layout-root > .footer { display: none !important; }',
          'html[data-cpu-harmony-native] .layout-root { min-height: 100vh; padding-top: env(safe-area-inset-top, 0px) !important; padding-bottom: 0 !important; }',
          'html[data-cpu-harmony-native] .layout-root > .main { min-height: calc(100vh - env(safe-area-inset-top, 0px)) !important; padding-bottom: var(--cpu-harmony-bottom-clearance) !important; }',
          'html[data-cpu-harmony-native] .home-entry { padding-top: max(12px, env(safe-area-inset-top, 0px)) !important; }',
          '.fade-enter-active, .fade-leave-active { transition-duration: 300ms !important; }',
          '@media (prefers-reduced-motion: reduce) { .fade-enter-active, .fade-leave-active { transition: none !important; } }'
        ].join('\\n');

        const host = window.CPUTimeNativeHost;
        if (host) {
          const bridge = window.CPUTimeNative || {};
          bridge.ready = () => host.ready();
          bridge.authChanged = () => host.authChanged();
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

          if (typeof window.CPUTimeNativeScheduleFetch !== 'function') {
            const store = name => document.getElementById('app')?.__vue_app__
              ?.config?.globalProperties?.$pinia?._s?.get(name);
            const api = async (path, params, auth, jwxt) => {
              const url = new URL('/api/jwxt/' + path, location.origin);
              Object.entries(params || {}).forEach(([key, value]) => {
                if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
              });
              const headers = { 'X-CPU-Auth-Mode': 'cookie', 'X-CPU-Client': 'harmony-app' };
              if (jwxt.token && jwxt.token !== '__cpu_jwxt_cookie_session__') headers['X-Jwxt-Token'] = jwxt.token;
              if (auth.token && auth.token !== '__cpu_cookie_session__') headers.Authorization = 'Bearer ' + auth.token;
              const response = await fetch(url, { credentials: 'same-origin', headers });
              const body = await response.json();
              if (!response.ok || (typeof body.code === 'number' && body.code !== 0)) {
                throw new Error(body.message || '课表服务暂时不可用');
              }
              return typeof body.code === 'number' ? body.data : body;
            };
            window.CPUTimeNativeScheduleFetch = async (semester, week, force) => {
              const auth = store('auth');
              const jwxt = store('jwxt');
              if (!auth || !jwxt) return { version: 1, auth: { authenticated: false } };
              try {
                if (!auth.ready) await auth.fetchMe({ probe: true });
                jwxt.hydrate();
                const ready = await jwxt.ensureSession({
                  refresh: Boolean(force), silent: true, allowAutoLogin: true, repairUnavailableSession: true
                });
                if (!ready) return { version: 1, auth: { authenticated: false } };
                const graduate = auth.academicIdentity === 'graduate';
                let response;
                if (graduate) {
                  response = await jwxt.withSessionRetry(() => api('graduate-schedule', {
                    semester: semester || undefined, refresh: force ? '1' : undefined
                  }, auth, jwxt), { silent: true });
                } else {
                  try {
                    response = await jwxt.withSessionRetry(() => api('schedule', {
                      semester: semester || undefined, week: 'all', refresh: force ? '1' : undefined
                    }, auth, jwxt), { silent: true });
                  } catch (_) {
                    response = await jwxt.withSessionRetry(() => api('schedule', {
                      semester: semester || undefined, week: week || undefined, refresh: force ? '1' : undefined
                    }, auth, jwxt), { silent: true });
                  }
                }
                const data = response?.parsed;
                if (!data || !Array.isArray(data.cells)) throw new Error('教务系统未返回有效课表');
                let calendar = null;
                try {
                  const calendarResponse = await jwxt.withSessionRetry(() => api('calendar', {
                    semester: semester || data.currentSemester
                  }, auth, jwxt), { silent: true });
                  calendar = calendarResponse?.parsed || null;
                } catch (_) {}
                return {
                  version: 1,
                  source: graduate ? 'graduate' : 'jwxt',
                  completeSemester: graduate || data.scope === 'semester',
                  fetchedAt: Date.now(),
                  data: { ...data, currentWeek: week || String(calendar?.currentWeek || data.currentWeek || '') },
                  calendar,
                  auth: { authenticated: true, identity: graduate ? 'graduate' : 'undergraduate' }
                };
              } catch (error) {
                return {
                  version: 1,
                  auth: { authenticated: Boolean(store('jwxt')?.isLoggedIn) },
                  error: error?.message || '课表暂时无法加载，请重试'
                };
              }
            };
          }
          bridge.ready();
        }
      })();
    `;
    void this.controller.runJavaScript(script).catch(() => undefined);
  }

  private handleNativeNavigation(path: string): void {
    if (path === '/schedule' || path.startsWith('/schedule?')) {
      this.selectedTab = 2;
      if (path.includes('refresh=1')) {
        this.scheduleStore.selectedSemester = '';
        this.scheduleStore.selectedWeek = '';
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
          window.CPUTimeNativeHost.scheduleResult(id, JSON.stringify({
            version: 1, auth: { authenticated: true }, error: '课表桥尚未准备好'
          }));
          return;
        }
        const task = window.CPUTimeNativeScheduleFetch
          ? window.CPUTimeNativeScheduleFetch(${semester}, ${week}, ${force})
          : fetchSchedule({ semester: ${semester}, week: ${week}, force: ${force} });
        Promise.resolve(task).then(value => {
          window.CPUTimeNativeHost.scheduleResult(id, JSON.stringify(value));
        }).catch(error => {
          window.CPUTimeNativeHost.scheduleResult(id, JSON.stringify({
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

  private selectTab(index: number): void {
    if (index < 0 || index > 4) return;
    this.selectedTab = index;
    if (index === 2) {
      this.scheduleStore.load(false);
      return;
    }
    const routes: string[] = ['/home', '/jwxt', '/schedule', '/services', '/profile'];
    const route = JSON.stringify(routes[index]);
    const script = `
      (() => {
        const path = ${route};
        const openRoute = window.CPUTimeNative?.openWebRoute;
        if (typeof openRoute === 'function') return openRoute(path);
        if (location.pathname !== path) location.assign(path);
      })();
    `;
    void this.controller.runJavaScript(script).catch(() => this.controller.loadUrl(`https://cputime.cn${routes[index]}`));
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
          window.CPUTimeNativeHost.widgetSetupFailed(error?.message || '卡片配置失败');
        }
      })();
    `;
    void this.controller.runJavaScript(script).catch(() => {
      this.widgetConfigured = false;
    });
  }

  build() {
    Stack() {
      Column() {
        Stack() {
          Web({
            src: this.launchUrl,
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
        .onControllerAttached(() => {
          try {
            const current = this.controller.getUserAgent();
            if (!current.includes('CPUWebHarmonyApp/')) {
              this.controller.setCustomUserAgent(`${current} ${USER_AGENT_SUFFIX}`);
            }
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
        .javaScriptProxy({
          object: this.nativeScheduleHost,
          name: 'CPUTimeNativeHost',
          methodList: this.nativeScheduleHostMethods(),
          controller: this.controller
        })
        .onPageBegin(() => {
          this.loading = true;
          this.failed = false;
        })
        .onPageEnd(() => {
          this.loading = false;
          this.applyHarmonyUxPolicy();
        })
        .onErrorReceive((event) => {
          if (!event.request.isMainFrame()) return;
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
        .onPermissionRequest((event) => void this.handleWebPermission(event))
        .onDownloadStart((event) => this.bridge.openExternalUrl(event.url))
        .onShowFileSelector((event) => this.chooseFiles(event))

          if (this.selectedTab === 2) {
            NativeSchedulePage({
              store: this.scheduleStore,
              revision: this.scheduleRevision,
              onLogin: () => {
                this.selectTab(4);
                const script = `window.CPUTimeNative?.openWebRoute?.('/login');`;
                void this.controller.runJavaScript(script).catch(() => this.controller.loadUrl('https://cputime.cn/login'));
              },
              onWidgets: () => this.widgetPanelVisible = true
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

        this.bottomNavigation()
      }
      .width('100%')
      .height('100%')

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

      if (this.widgetPanelVisible) {
        this.widgetSettingsPanel()
      }
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  private bottomNavigation() {
    Row() {
      this.tabButton(0, '⌂', '首页')
      this.tabButton(1, '▤', '教务')
      this.tabButton(2, '日', '课表')
      this.tabButton(3, '◇', '服务')
      this.tabButton(4, '○', '我的')
    }
    .width('100%')
    .height(66)
    .padding({ left: 6, right: 6, top: 4, bottom: 6 })
    .alignItems(VerticalAlign.Center)
    .backgroundColor($r('app.color.app_navigation'))
    .border({ width: { top: 1 }, color: $r('app.color.app_divider') })
  }

  @Builder
  private tabButton(index: number, icon: string, label: string) {
    Button() {
      Column({ space: 1 }) {
        Text(icon)
          .fontSize(index === 2 ? 17 : 20)
          .fontWeight(this.selectedTab === index ? FontWeight.Bold : FontWeight.Regular)
          .fontColor(this.selectedTab === index ? '#2459AF' : $r('app.color.app_text_secondary'))
        Text(label)
          .fontSize(10)
          .fontWeight(this.selectedTab === index ? FontWeight.Medium : FontWeight.Regular)
          .fontColor(this.selectedTab === index ? '#2459AF' : $r('app.color.app_text_secondary'))
      }
      .width('100%')
      .height('100%')
      .justifyContent(FlexAlign.Center)
    }
    .type(ButtonType.Normal)
    .height(54)
    .layoutWeight(1)
    .backgroundColor(this.selectedTab === index ? '#EDF4FF' : 'transparent')
    .borderRadius(14)
    .onClick(() => this.selectTab(index))
  }

  @Builder
  private widgetSettingsPanel() {
    Column() {
      Blank()
        .layoutWeight(1)
        .width('100%')
        .onClick(() => this.widgetPanelVisible = false)

      Column({ space: 16 }) {
        Row() {
          Column({ space: 3 }) {
            Text('课表服务卡片')
              .fontSize(20)
              .fontWeight(FontWeight.Bold)
              .fontColor($r('app.color.app_text_primary'))
            Text(this.widgetConfigured ? '订阅已配置，可从桌面或锁屏添加' : '加载课表后将自动配置，也可以手动重试')
              .fontSize(12)
              .fontColor($r('app.color.app_text_secondary'))
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)

          Button('完成')
            .type(ButtonType.Normal)
            .height(34)
            .fontSize(14)
            .fontColor('#2459AF')
            .backgroundColor('#E7F0FF')
            .onClick(() => this.widgetPanelVisible = false)
        }
        .width('100%')

        Text('主题')
          .width('100%')
          .fontSize(14)
          .fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.app_text_primary'))

        Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.Start }) {
          ForEach([
            'color-glass', 'green', 'blue', 'teal', 'indigo', 'violet', 'orange', 'rose', 'slate'
          ], (theme: string) => {
            Button(this.widgetThemeLabel(theme))
              .type(ButtonType.Capsule)
              .height(34)
              .fontSize(12)
              .fontColor(this.widgetTheme === theme ? '#FFFFFF' : $r('app.color.app_text_secondary'))
              .backgroundColor(this.widgetTheme === theme ? this.widgetThemeColor(theme) : $r('app.color.app_control'))
              .margin({ right: 8, bottom: 8 })
              .onClick(() => {
                this.widgetTheme = theme;
                this.bridge.setScheduleWidgetTheme(theme);
              })
          })
        }
        .width('100%')

        Button(this.widgetConfigured ? '重新配置并刷新卡片' : '立即配置卡片')
          .type(ButtonType.Capsule)
          .width('100%')
          .height(46)
          .fontSize(15)
          .fontColor('#FFFFFF')
          .backgroundColor('#376FD6')
          .onClick(() => {
            this.widgetAutoSetupAttempted = true;
            this.configureScheduleWidget();
          })

        Text('支持 2×2、2×4、4×4 桌面卡片，以及横条、圆形、矩形锁屏卡片。系统实际刷新时间由 HarmonyOS 调度。')
          .width('100%')
          .fontSize(12)
          .fontColor($r('app.color.app_text_secondary'))
      }
      .width('100%')
      .padding({ left: 20, right: 20, top: 20, bottom: 28 })
      .backgroundColor($r('app.color.app_surface'))
      .borderRadius({ topLeft: 24, topRight: 24 })
    }
    .width('100%')
    .height('100%')
    .backgroundColor('rgba(15, 23, 42, 0.36)')
  }

  private widgetThemeLabel(theme: string): string {
    const labels: Map<string, string> = new Map<string, string>([
      ['color-glass', '彩色玻璃'], ['green', '青绿'], ['blue', '蓝色'], ['teal', '湖蓝'], ['indigo', '靛粉'],
      ['violet', '紫色'], ['orange', '橙色'], ['rose', '玫红'], ['slate', '石墨']
    ]);
    return labels.get(theme) ?? theme;
  }

  private widgetThemeColor(theme: string): string {
    const colors: Map<string, string> = new Map<string, string>([
      ['color-glass', '#6D5DFC'], ['green', '#168776'], ['blue', '#2563EB'], ['teal', '#0891B2'],
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
    if (this.widgetPanelVisible) {
      this.widgetPanelVisible = false;
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
    if (this.selectedTab === 2) {
      this.selectTab(0);
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
}
