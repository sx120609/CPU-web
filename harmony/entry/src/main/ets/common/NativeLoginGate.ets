/** 原生登录页可选的学校；brandName 用在欢迎语。 */
export interface NativeLoginSchool {
  id: string;
  name: string;
  brandName: string;
  ssoLogin: boolean;
}

/** 学校给的扫码说明（服务端 schools/drivers.ts 的 SchoolMfaGuide）：用哪个 App 扫、怎么说。 */
export interface NativeMfaGuide {
  appName: string;
  appUrl: string;
  hint: string;
}

export interface NativeLoginResponse {
  ok: boolean;
  needCaptcha: boolean;
  captchaImage: string;
  error: string;
  account: string;
  canAccessAdmin: boolean;
  /** 学校要求新设备扫码二次验证：显示 mfaQr 并轮询。 */
  needMfa: boolean;
  mfaQr: string;
  /** 扫码轮询的状态：waiting / scanned / expired / failed / done / retry。 */
  status: string;
  school?: NativeLoginSchool;
  mfaGuide?: NativeMfaGuide;
  /** 只有 nativeLoginSchools 的结果带它。 */
  schools: NativeLoginSchool[];
}

interface RawLoginSchool {
  id?: string;
  name?: string;
  brandName?: string;
  ssoLogin?: boolean;
}

interface RawMfaApp {
  name?: string;
  url?: string;
}

interface RawMfaGuide {
  app?: RawMfaApp;
  hint?: string;
}

interface RawLoginResponse {
  ok?: boolean;
  needCaptcha?: boolean;
  captchaImage?: string;
  error?: string;
  account?: string;
  canAccessAdmin?: boolean;
  needMfa?: boolean;
  mfaQr?: string;
  status?: string;
  school?: RawLoginSchool;
  mfaGuide?: RawMfaGuide;
  schools?: RawLoginSchool[];
}

export function emptyNativeLoginResponse(error: string): NativeLoginResponse {
  return {
    ok: false, needCaptcha: false, captchaImage: '', error, account: '', canAccessAdmin: false,
    needMfa: false, mfaQr: '', status: '', schools: []
  };
}

function parseSchool(raw?: RawLoginSchool): NativeLoginSchool | undefined {
  const id = String(raw?.id ?? '').trim();
  if (!raw || !id) return undefined;
  return {
    id,
    name: String(raw.name ?? '') || id,
    brandName: String(raw.brandName ?? '') || '药大拾间',
    ssoLogin: raw.ssoLogin !== false
  };
}

/** ArkWeb 可能把 JSON 字符串结果再序列化一层，先拆开再读字段。 */
export function parseNativeLoginResponse(raw: string): NativeLoginResponse {
  try {
    let decoded = JSON.parse(String(raw || '{}')) as string | RawLoginResponse;
    if (typeof decoded === 'string') {
      decoded = JSON.parse(decoded) as RawLoginResponse;
    }
    const value = decoded as RawLoginResponse;
    const schools: NativeLoginSchool[] = [];
    (value?.schools ?? []).forEach((item: RawLoginSchool) => {
      const school = parseSchool(item);
      if (school) schools.push(school);
    });
    let mfaGuide: NativeMfaGuide | undefined = undefined;
    if (value?.mfaGuide) {
      mfaGuide = {
        appName: String(value.mfaGuide.app?.name ?? '').trim(),
        appUrl: String(value.mfaGuide.app?.url ?? '').trim(),
        hint: String(value.mfaGuide.hint ?? '').trim()
      };
    }
    return {
      ok: value?.ok === true,
      needCaptcha: value?.needCaptcha === true,
      captchaImage: value?.captchaImage || '',
      error: value?.error || '',
      account: value?.account || '',
      canAccessAdmin: value?.canAccessAdmin === true,
      needMfa: value?.needMfa === true,
      mfaQr: value?.mfaQr || '',
      status: value?.status || '',
      school: parseSchool(value?.school),
      mfaGuide,
      schools
    };
  } catch (_) {
    return emptyNativeLoginResponse('登录服务返回了无法识别的结果，请重试');
  }
}

@Component
export struct NativeLoginGate {
  onBegin: () => Promise<NativeLoginResponse> = async () => emptyNativeLoginResponse('登录服务尚未就绪，请稍候重试');
  onSsoLogin: (username: string, password: string, captcha: string, remember: boolean) => Promise<NativeLoginResponse> = async () => emptyNativeLoginResponse('登录服务尚未就绪，请稍候重试');
  onAccountLogin: (username: string, password: string) => Promise<NativeLoginResponse> = async () => emptyNativeLoginResponse('登录服务尚未就绪，请稍候重试');
  onOpenPolicy: (path: string) => void = () => undefined;
  /** 多学校：可选学校、换学校（返回值同 onBegin）。网页还是旧版时 schools 为空，不显示学校选择。 */
  onLoadSchools: () => Promise<NativeLoginResponse> = async () => emptyNativeLoginResponse('');
  onChooseSchool: (schoolId: string) => Promise<NativeLoginResponse> = async () => emptyNativeLoginResponse('登录服务尚未就绪，请稍候重试');
  /** 扫码二次验证：查一次状态、换一张、放弃；done 时网页已经登录。 */
  onMfaPoll: () => Promise<NativeLoginResponse> = async () => emptyNativeLoginResponse('');
  onMfaRefresh: () => Promise<NativeLoginResponse> = async () => emptyNativeLoginResponse('');
  onMfaCancel: () => void = () => undefined;
  onSaveQr: (dataUrl: string) => Promise<boolean> = async () => false;
  onOpenScanApp: (url: string) => Promise<boolean> = async () => false;

  @State private mode: string = 'school';
  @State private accountLoginUnlocked: boolean = false;
  @State private username: string = '';
  @State private password: string = '';
  @State private captcha: string = '';
  @State private captchaImage: string = '';
  @State private needCaptcha: boolean = false;
  @State private remember: boolean = true;
  @State private privacyAccepted: boolean = false;
  @State private preparing: boolean = true;
  @State private busy: boolean = false;
  @State private errorMessage: string = '';
  @State private statusMessage: string = '';
  @State private schools: NativeLoginSchool[] = [];
  @State private schoolId: string = '';
  @State private brandName: string = '药大拾间';
  @State private mfaQr: string = '';
  @State private mfaState: string = '';
  @State private mfaAppName: string = '';
  @State private mfaAppUrl: string = '';
  @State private mfaHint: string = '';
  private requestRevision: number = 0;
  private bridgeWarmupRetries: number = 0;
  private mfaRevision: number = 0;

  aboutToAppear(): void {
    this.bridgeWarmupRetries = 0;
    void this.prepareSchoolLogin(true);
    void this.loadSchools();
  }

  aboutToDisappear(): void {
    this.mfaRevision += 1;
  }

  build() {
    Stack() {
      Column() {
        Scroll() {
          Column({ space: 18 }) {
            this.brandHeader()
            if (this.mfaQr) {
              this.mfaPanel()
            } else {
              this.schoolPicker()
              this.modePicker()
              if (this.preparing) {
                Column({ space: 12 }) {
                  LoadingProgress().width(32).height(32).color($r('app.color.app_accent'))
                  Text('正在准备登录').fontSize(14).fontColor($r('app.color.app_text_secondary'))
                }.width('100%').padding({ top: 32, bottom: 32 }).alignItems(HorizontalAlign.Center)
              } else {
                this.loginForm()
              }
            }
          }
          .width('100%')
          .padding({ left: 24, right: 24, top: 24, bottom: 32 })
        }.width('100%').layoutWeight(1).scrollBar(BarState.Off)
      }
      .width('100%')
      .height('100%')
      .backgroundColor($r('app.color.app_background'))
    }
    .width('100%')
    .height('100%')
    .backgroundColor($r('app.color.app_background'))
  }

  @Builder
  private brandHeader() {
    Column({ space: 12 }) {
      Image($r('app.media.app_icon'))
        .width(68)
        .height(68)
        .borderRadius(18)
        .accessibilityText(this.brandName)
        .gesture(LongPressGesture({ duration: 700 }).onAction(() => {
          if (!this.currentSchoolSso()) return;
          this.accountLoginUnlocked = true;
          this.mode = 'account';
          this.errorMessage = '';
          this.statusMessage = '';
        }))
      Text('欢迎回来')
        .fontSize(28)
        .fontWeight(FontWeight.Bold)
        .fontColor($r('app.color.app_text_primary'))
      Text(`登录${this.brandName}，继续查看你的校园信息`)
        .fontSize(14)
        .fontColor($r('app.color.app_text_secondary'))
        .textAlign(TextAlign.Center)
    }
    .width('100%')
    .alignItems(HorizontalAlign.Center)
    .padding({ top: 16, bottom: 4 })
  }

  @Builder
  private schoolPicker() {
    if (this.schools.length > 1) {
      Select(this.schoolOptions())
        .selected(this.selectedSchoolIndex())
        .value(this.selectedSchoolName())
        .font({ size: 15, weight: FontWeight.Medium })
        .fontColor($r('app.color.app_accent'))
        .selectedOptionFontColor($r('app.color.app_accent'))
        .width('100%')
        .height(52)
        .borderRadius(13)
        .backgroundColor($r('app.color.app_control'))
        .enabled(!this.busy)
        .accessibilityText('选择学校')
        .onSelect((index: number) => void this.chooseSchool(index))
    }
  }

  @Builder
  private modePicker() {
    if (this.accountLoginUnlocked && this.currentSchoolSso()) {
      Row({ space: 6 }) {
        this.modeButton('统一认证', 'school')
        this.modeButton('账号登录', 'account')
      }
      .width('100%')
      .height(44)
      .padding(3)
      .backgroundColor($r('app.color.app_control'))
      .borderRadius(22)
    }
  }

  @Builder
  private modeButton(label: string, value: string) {
    Button(label)
      .type(ButtonType.Normal)
      .layoutWeight(1)
      .height(38)
      .padding(0)
      .fontSize(13)
      .fontColor(this.mode === value ? $r('app.color.app_on_accent') : $r('app.color.app_text_secondary'))
      .backgroundColor(this.mode === value ? $r('app.color.app_accent') : Color.Transparent)
      .borderRadius(19)
      .onClick(() => {
        this.mode = value;
        this.errorMessage = '';
        this.statusMessage = '';
        if (value === 'school' && !this.captchaImage && !this.needCaptcha) void this.prepareSchoolLogin();
      })
  }

  @Builder
  private loginForm() {
    Column({ space: 12 }) {
      TextInput({ text: this.username, placeholder: this.mode === 'school' ? '学号 / 工号' : '用户名' })
        .height(52)
        .width('100%')
        .fontSize(15)
        .fontColor($r('app.color.app_text_primary'))
        .placeholderColor($r('app.color.app_text_tertiary'))
        .backgroundColor($r('app.color.app_control'))
        .borderRadius(13)
        .padding({ left: 15, right: 15 })
        .maxLength(120)
        .accessibilityText(this.mode === 'school' ? '学号或工号' : '用户名')
        .onChange((value: string) => this.username = value)

      TextInput({ text: this.password, placeholder: '密码' })
        .type(InputType.Password)
        .showPasswordIcon(true)
        .height(52)
        .width('100%')
        .fontSize(15)
        .fontColor($r('app.color.app_text_primary'))
        .placeholderColor($r('app.color.app_text_tertiary'))
        .backgroundColor($r('app.color.app_control'))
        .borderRadius(13)
        .padding({ left: 15, right: 15 })
        .maxLength(160)
        .accessibilityText('密码')
        .onChange((value: string) => this.password = value)

      if (this.mode === 'school' && this.needCaptcha) {
        Row({ space: 10 }) {
          TextInput({ text: this.captcha, placeholder: '验证码' })
            .height(52)
            .layoutWeight(1)
            .fontSize(15)
            .fontColor($r('app.color.app_text_primary'))
            .placeholderColor($r('app.color.app_text_tertiary'))
            .backgroundColor($r('app.color.app_control'))
            .borderRadius(13)
            .padding({ left: 15, right: 15 })
            .maxLength(32)
            .accessibilityText('验证码')
            .onChange((value: string) => this.captcha = value)
          if (this.captchaImage) {
            Button() {
              Image(this.captchaImage).width(112).height(48).objectFit(ImageFit.Contain)
            }
            .type(ButtonType.Normal)
            .width(112)
            .height(52)
            .padding(2)
            .backgroundColor($r('app.color.app_surface'))
            .borderRadius(13)
            .accessibilityText('刷新验证码')
            .onClick(() => void this.prepareSchoolLogin())
          }
        }.width('100%')
      }

      Row() {
        Toggle({ type: ToggleType.Switch, isOn: this.remember })
          .selectedColor($r('app.color.app_accent'))
          .width(40)
          .height(24)
          .accessibilityText('保持登录状态')
          .onChange((isOn: boolean) => this.remember = isOn)
        Text('保持登录状态')
          .fontSize(13)
          .fontColor($r('app.color.app_text_secondary'))
          .layoutWeight(1)
        if (this.statusMessage) {
          Text(this.statusMessage)
            .fontSize(12)
            .fontColor($r('app.color.app_accent'))
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
      }.width('100%').height(32).alignItems(VerticalAlign.Center)

      Row({ space: 8 }) {
        Checkbox()
          .select(this.privacyAccepted)
          .selectedColor($r('app.color.app_accent'))
          .width(22)
          .height(22)
          .accessibilityText('同意隐私政策和服务条款')
          .onChange((value: boolean) => this.privacyAccepted = value)
        Text('我已阅读并同意')
          .fontSize(12)
          .fontColor($r('app.color.app_text_secondary'))
        Button('隐私政策')
          .type(ButtonType.Normal)
          .height(28)
          .padding({ left: 0, right: 0 })
          .fontSize(12)
          .fontColor($r('app.color.app_accent'))
          .backgroundColor(Color.Transparent)
          .onClick(() => this.onOpenPolicy('/privacy.html'))
        Text('和')
          .fontSize(12)
          .fontColor($r('app.color.app_text_secondary'))
        Button('服务条款')
          .type(ButtonType.Normal)
          .height(28)
          .padding({ left: 0, right: 0 })
          .fontSize(12)
          .fontColor($r('app.color.app_accent'))
          .backgroundColor(Color.Transparent)
          .onClick(() => this.onOpenPolicy('/terms.html'))
      }.width('100%').alignItems(VerticalAlign.Center)

      this.errorText()

      Button(this.busy ? '登录中…' : '登录并继续')
        .type(ButtonType.Capsule)
        .width('100%')
        .height(50)
        .fontSize(15)
        .fontWeight(FontWeight.Medium)
        .fontColor($r('app.color.app_on_accent'))
        .backgroundColor($r('app.color.app_accent'))
        .enabled(!this.busy && !this.preparing)
        .onClick(() => void this.submit())

      Text('登录后，应用会根据你的授权同步课表和校园服务数据。')
        .width('100%')
        .fontSize(12)
        .fontColor($r('app.color.app_text_tertiary'))
        .textAlign(TextAlign.Center)
        .maxLines(2)
    }
    .width('100%')
  }

  @Builder
  private errorText() {
    if (this.errorMessage) {
      Text(this.errorMessage)
        .width('100%')
        .fontSize(13)
        .fontColor('#B42318')
        .textAlign(TextAlign.Start)
        .maxLines(3)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
    }
  }

  /**
   * 学校统一认证的扫码二次验证（有的学校新设备第一次登录时要求）。用哪个 App 扫由学校给；
   * 用户手里多半就是这台手机，所以先把二维码存进相册，再打开那个 App 从相册识别。
   * 存相册要用系统的 SaveButton（鸿蒙只认它的授权）。
   */
  @Builder
  private mfaPanel() {
    Column({ space: 14 }) {
      Text('扫码验证')
        .width('100%')
        .fontSize(17)
        .fontWeight(FontWeight.Bold)
        .fontColor($r('app.color.app_text_primary'))
      Text(this.mfaHint || `学校统一认证要求这台设备先验证一次：用${this.scannerName()}扫描下面的二维码，并在手机上确认。验证后这台设备会被记住。`)
        .width('100%')
        .fontSize(13)
        .fontColor($r('app.color.app_text_secondary'))
      Stack() {
        Image(this.mfaQr)
          .width(200)
          .height(200)
          .objectFit(ImageFit.Contain)
          .accessibilityText('学校统一认证二维码')
        if (this.mfaOverlay()) {
          Text(this.mfaOverlay())
            .width(220)
            .height(220)
            .fontSize(14)
            .fontWeight(FontWeight.Medium)
            .fontColor('#172033')
            .textAlign(TextAlign.Center)
            .backgroundColor('#EBFFFFFF')
            .borderRadius(14)
        }
      }
      .width(220)
      .height(220)
      .backgroundColor('#FFFFFF')
      .borderRadius(14)

      SaveButton({ icon: SaveIconStyle.FULL_FILLED, text: SaveDescription.SAVE_IMAGE, buttonType: ButtonType.Capsule })
        .width('100%')
        .height(50)
        .fontSize(15)
        .fontColor($r('app.color.app_on_accent'))
        .iconColor($r('app.color.app_on_accent'))
        .backgroundColor($r('app.color.app_accent'))
        .enabled(this.mfaState !== 'done' && this.mfaState !== 'expired')
        .onClick((_event: ClickEvent, result: SaveButtonOnClickResult) => {
          if (result === SaveButtonOnClickResult.SUCCESS) void this.saveQr();
          else this.errorMessage = '未获得保存授权';
        })
      Text(this.mfaAppName
        ? `保存后会打开${this.mfaAppName}，在「扫一扫」里从相册选这张二维码；也可以用另一台手机直接扫屏幕。`
        : '保存后在扫码 App 的「扫一扫」里从相册选这张二维码；也可以用另一台手机直接扫屏幕。')
        .width('100%')
        .fontSize(12)
        .fontColor($r('app.color.app_text_tertiary'))
      Row() {
        Button('换一张')
          .type(ButtonType.Normal)
          .layoutWeight(1)
          .height(40)
          .fontSize(14)
          .fontColor($r('app.color.app_accent'))
          .backgroundColor(Color.Transparent)
          .enabled(this.mfaState !== 'done')
          .onClick(() => void this.refreshMfa())
        Button('返回登录')
          .type(ButtonType.Normal)
          .layoutWeight(1)
          .height(40)
          .fontSize(14)
          .fontColor($r('app.color.app_accent'))
          .backgroundColor(Color.Transparent)
          .enabled(this.mfaState !== 'done')
          .onClick(() => this.leaveMfa())
      }.width('100%')
      this.errorText()
      if (this.statusMessage) {
        Text(this.statusMessage).width('100%').fontSize(13).fontColor($r('app.color.app_accent'))
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Center)
  }

  private scannerName(): string {
    return this.mfaAppName || '手机';
  }

  private mfaOverlay(): string {
    if (this.mfaState === 'scanned') return '已扫描，请在手机上确认';
    if (this.mfaState === 'expired') return '二维码已失效，点「换一张」';
    if (this.mfaState === 'done') return '验证通过，正在登录…';
    return '';
  }

  private schoolOptions(): SelectOption[] {
    const options: SelectOption[] = [];
    this.schools.forEach((school: NativeLoginSchool) => {
      const option: SelectOption = { value: school.name };
      options.push(option);
    });
    return options;
  }

  private selectedSchoolIndex(): number {
    return Math.max(0, this.schools.findIndex((school: NativeLoginSchool) => school.id === this.schoolId));
  }

  private selectedSchoolName(): string {
    const school = this.schools.find((item: NativeLoginSchool) => item.id === this.schoolId);
    return school ? school.name : '选择学校';
  }

  private currentSchoolSso(): boolean {
    const school = this.schools.find((item: NativeLoginSchool) => item.id === this.schoolId);
    return school ? school.ssoLogin : true;
  }

  private applySchool(school?: NativeLoginSchool): void {
    if (!school) return;
    this.schoolId = school.id;
    this.brandName = school.brandName;
    if (!school.ssoLogin) {
      this.accountLoginUnlocked = true;
      this.mode = 'account';
    } else if (!this.accountLoginUnlocked) {
      this.mode = 'school';
    }
  }

  /** 页面刚加载（或刚刷新）时桥还没装好，学校列表要等一会儿；旧版网页一直没有，最多等十秒。 */
  private async loadSchools(attempt: number = 0): Promise<void> {
    const revision = this.mfaRevision;
    const response = await this.onLoadSchools();
    if (response.schools.length) {
      this.schools = response.schools;
      if (!this.schoolId) this.applySchool(response.school);
      return;
    }
    if (attempt < 20 && revision === this.mfaRevision) setTimeout(() => void this.loadSchools(attempt + 1), 500);
  }

  private async chooseSchool(index: number): Promise<void> {
    const target = this.schools[index];
    if (!target || target.id === this.schoolId || this.busy) return;
    const revision = ++this.requestRevision;
    this.preparing = true;
    this.errorMessage = '';
    this.statusMessage = '';
    this.captcha = '';
    this.applySchool(target);
    const response = await this.onChooseSchool(target.id);
    if (revision !== this.requestRevision) return;
    this.applySchool(response.school);
    if (this.mode === 'school') this.applyResponse(response);
    this.preparing = false;
  }

  private async prepareSchoolLogin(retryBridgeWarmup: boolean = false): Promise<void> {
    if (this.mode !== 'school' || this.busy) return;
    const revision = ++this.requestRevision;
    this.preparing = true;
    this.errorMessage = '';
    this.statusMessage = '';
    const response = await this.onBegin();
    if (revision !== this.requestRevision) return;
    if (retryBridgeWarmup && this.shouldRetryBridgeWarmup(response) && this.bridgeWarmupRetries < 4) {
      this.bridgeWarmupRetries += 1;
      this.errorMessage = '';
      setTimeout(() => {
        if (revision === this.requestRevision && this.preparing) void this.prepareSchoolLogin(true);
      }, 350);
      return;
    }
    this.applySchool(response.school);
    this.applyResponse(response);
    this.preparing = false;
  }

  private shouldRetryBridgeWarmup(response: NativeLoginResponse): boolean {
    // ArkWeb can report an early bridge call as either an empty response or a
    // generic login failure. This bounded retry is used only during first
    // appearance; manual credential submissions never enter this path.
    return !response.ok;
  }

  private async submit(): Promise<void> {
    if (this.busy) return;
    if (!this.username.trim() || !this.password) {
      this.errorMessage = this.mode === 'school' ? '请填写学号 / 工号和密码' : '请填写用户名和密码';
      return;
    }
    if (this.mode === 'school' && this.needCaptcha && !this.captcha.trim()) {
      this.errorMessage = '请输入验证码';
      return;
    }
    if (!this.privacyAccepted) {
      this.errorMessage = '请先同意隐私政策和服务条款';
      return;
    }
    const revision = ++this.requestRevision;
    this.busy = true;
    this.errorMessage = '';
    this.statusMessage = '';
    const response = this.mode === 'school'
      ? await this.onSsoLogin(this.username.trim(), this.password, this.captcha.trim(), this.remember)
      : await this.onAccountLogin(this.username.trim(), this.password);
    if (revision !== this.requestRevision) return;
    this.busy = false;
    if (!response.ok && response.needMfa && response.mfaQr) {
      this.startMfa(response);
      return;
    }
    this.applyResponse(response);
    if (response.ok) {
      this.password = '';
      this.captcha = '';
      this.statusMessage = '登录成功，正在继续';
    }
  }

  private startMfa(response: NativeLoginResponse): void {
    this.errorMessage = '';
    this.mfaQr = response.mfaQr;
    this.mfaState = 'waiting';
    this.mfaAppName = response.mfaGuide?.appName ?? '';
    this.mfaAppUrl = response.mfaGuide?.appUrl ?? '';
    this.mfaHint = response.mfaGuide?.hint ?? '';
    this.pollMfa(++this.mfaRevision, 2000);
  }

  /** 轮询扫码结果：done 时网页已经登录，外壳收到登录状态后自己收起登录页。 */
  private pollMfa(revision: number, delay: number): void {
    setTimeout(() => {
      if (revision !== this.mfaRevision || !this.mfaQr) return;
      if (this.mfaState === 'expired' || this.mfaState === 'done') return;
      void this.onMfaPoll().then((response: NativeLoginResponse) => {
        if (revision !== this.mfaRevision || !this.mfaQr) return;
        if (response.status === 'done') {
          this.mfaState = 'done';
          this.password = '';
          this.captcha = '';
          this.statusMessage = '验证通过，正在继续';
          return;
        }
        if (response.status === 'waiting' || response.status === 'scanned' || response.status === 'expired' || response.status === 'retry') {
          this.mfaState = response.status;
          this.errorMessage = response.status === 'retry' ? response.error : '';
          if (response.status !== 'expired') this.pollMfa(revision, response.status === 'retry' ? 4000 : 2000);
          return;
        }
        this.mfaQr = '';
        this.mfaState = '';
        this.errorMessage = response.error || '验证失败，请重新登录';
        void this.prepareSchoolLogin();
      });
    }, delay);
  }

  private async refreshMfa(): Promise<void> {
    const response = await this.onMfaRefresh();
    if (response.ok && response.mfaQr) {
      this.mfaQr = response.mfaQr;
      this.mfaState = 'waiting';
      this.errorMessage = '';
      this.pollMfa(++this.mfaRevision, 2000);
    } else {
      this.errorMessage = response.error || '二维码刷新失败，请重新登录';
    }
  }

  private leaveMfa(): void {
    this.mfaRevision += 1;
    this.mfaQr = '';
    this.mfaState = '';
    this.errorMessage = '';
    this.onMfaCancel();
    void this.prepareSchoolLogin();
  }

  private async saveQr(): Promise<void> {
    const saved = await this.onSaveQr(this.mfaQr);
    if (!saved) {
      this.errorMessage = '保存二维码失败，可以截屏后再识别';
      return;
    }
    const opened = this.mfaAppUrl ? await this.onOpenScanApp(this.mfaAppUrl) : false;
    if (!opened && this.mfaAppName) this.statusMessage = `已保存到相册，请在${this.mfaAppName}「扫一扫」里从相册选择`;
  }

  private applyResponse(response: NativeLoginResponse): void {
    this.needCaptcha = response.needCaptcha === true;
    this.captchaImage = response.captchaImage || '';
    this.errorMessage = response.ok ? '' : (response.error || '登录暂时失败，请稍后再试');
  }
}
