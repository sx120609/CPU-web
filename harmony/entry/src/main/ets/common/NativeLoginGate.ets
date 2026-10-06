export interface NativeLoginResponse {
  ok: boolean;
  needCaptcha: boolean;
  captchaImage: string;
  error: string;
  account: string;
  canAccessAdmin: boolean;
}

@Component
export struct NativeLoginGate {
  onBegin: () => Promise<NativeLoginResponse> = async () => this.emptyResponse('登录服务尚未就绪，请稍候重试');
  onSsoLogin: (username: string, password: string, captcha: string, remember: boolean) => Promise<NativeLoginResponse> = async () => this.emptyResponse('登录服务尚未就绪，请稍候重试');
  onAccountLogin: (username: string, password: string) => Promise<NativeLoginResponse> = async () => this.emptyResponse('登录服务尚未就绪，请稍候重试');
  onOpenPolicy: (path: string) => void = () => undefined;

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
  private requestRevision: number = 0;
  private bridgeWarmupRetries: number = 0;

  aboutToAppear(): void {
    this.bridgeWarmupRetries = 0;
    void this.prepareSchoolLogin(true);
  }

  build() {
    Stack() {
      Column() {
        Scroll() {
          Column({ space: 18 }) {
            this.brandHeader()
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
        .accessibilityText('药大拾间')
        .gesture(LongPressGesture({ duration: 700 }).onAction(() => {
          this.accountLoginUnlocked = true;
          this.mode = 'account';
          this.errorMessage = '';
          this.statusMessage = '';
        }))
      Text('欢迎回来')
        .fontSize(28)
        .fontWeight(FontWeight.Bold)
        .fontColor($r('app.color.app_text_primary'))
      Text('登录药大拾间，继续查看你的校园信息')
        .fontSize(14)
        .fontColor($r('app.color.app_text_secondary'))
        .textAlign(TextAlign.Center)
    }
    .width('100%')
    .alignItems(HorizontalAlign.Center)
    .padding({ top: 16, bottom: 4 })
  }

  @Builder
  private modePicker() {
    if (this.accountLoginUnlocked) {
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

      if (this.errorMessage) {
        Text(this.errorMessage)
          .width('100%')
          .fontSize(13)
          .fontColor('#B42318')
          .textAlign(TextAlign.Start)
          .maxLines(3)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }

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
    this.applyResponse(response);
    if (response.ok) {
      this.password = '';
      this.captcha = '';
      this.statusMessage = '登录成功，正在继续';
    }
  }

  private applyResponse(response: NativeLoginResponse): void {
    this.needCaptcha = response.needCaptcha === true;
    this.captchaImage = response.captchaImage || '';
    this.errorMessage = response.ok ? '' : (response.error || '登录暂时失败，请稍后再试');
  }

  private emptyResponse(error: string): NativeLoginResponse {
    return { ok: false, needCaptcha: false, captchaImage: '', error, account: '', canAccessAdmin: false };
  }
}
