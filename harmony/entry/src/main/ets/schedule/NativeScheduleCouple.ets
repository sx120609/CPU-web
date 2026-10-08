import { NativeCourseBlock, NativeScheduleRequest, NativeScheduleStore } from './NativeScheduleStore';
import { RawShareDocument, readSharedSchedule, shareDateKey, SharedSchedule, SharePublishBody, sharedScheduleSnapshot } from './ScheduleSharing';
import { coupleDaysTogether, coupleFingerprint, coupleInvitation, coupleNowText, coupleRelativeTime, CoupleStatus,
  coupleStatusFrom, CoupleTimedCourse, CoupleTint, coupleTint, coupleTone, emptyCoupleStatus, RawCoupleParty,
  RawCoupleStatus } from './ScheduleCouple';

// The couple timetable on the native grid: the binding, the partner's snapshot, the upload of the
// user's own term, and the sheet that manages it (the Web's CoupleDialog). Requests go through the
// signed-in Web session (CPUHarmonyCouple). Background requests fail quietly: the couple timetable
// must never get in the way of the timetable itself.

export const COUPLE_ACCENT: string = '#E2568A';

export interface CoupleSettingsBody {
  anniversary?: string | null;
  myColor?: string;
}
export interface CoupleApiRequest {
  // status | schedules | invite | cancelInvite | accept | unbind | settings | sync
  action: string;
  code?: string;
  body?: SharePublishBody | CoupleSettingsBody;
}
export interface CoupleApiData extends RawCoupleStatus {
  changed?: boolean;
}
export interface CoupleApiReply {
  ok: boolean;
  // The HTTP status, or 0 when the request never got an answer.
  status: number;
  error?: string;
  data?: CoupleApiData;
}
export type CoupleApi = (request: CoupleApiRequest) => Promise<CoupleApiReply>;

const UNBOUND_PAUSE_MS: number = 10 * 60 * 1000;
const BOUND_PAUSE_MS: number = 60 * 1000;
const UNCHANGED_RESYNC_MS: number = 12 * 60 * 60 * 1000;
const RETRY_PAUSE_MS: number = 15 * 1000;

@Observed
export class NativeScheduleCoupleModel {
  sheetVisible: boolean = false;
  status: CoupleStatus = emptyCoupleStatus();
  // Whether the partner's courses are drawn in the grid; kept on this device.
  visible: boolean = true;
  // Goes up whenever what the grid draws for the partner changes.
  revision: number = 0;
  // '' | load | change
  busy: string = '';
  error: string = '';
  notice: string = '';
  codeInput: string = '';
  private api?: CoupleApi;
  // Saves `visible` ("1" / "0") and the mark of the last upload.
  private persistence?: (key: string, value: string) => void;
  // A store laid out with the partner's own calendar; undefined while there is no snapshot of theirs.
  private partner?: NativeScheduleStore;
  private partnerPrint: string = '';
  private dayCache: Map<string, NativeCourseBlock[]> = new Map();
  private account: string = '';
  private checkedAt: number = 0;
  private attemptedAt: number = 0;
  private refreshing: boolean = false;
  private syncing: boolean = false;
  private syncMark: string = '';
  private generation: number = 0;

  attach(api: CoupleApi, persistence: (key: string, value: string) => void): void {
    this.api = api;
    this.persistence = persistence;
  }

  restore(visible: boolean, syncMark: string): void {
    this.visible = visible;
    this.syncMark = syncMark;
  }

  /** Everything belongs to one account: another one signing in starts from nothing. */
  adopt(account: string): void {
    if (account === this.account) return;
    this.account = account;
    this.generation += 1;
    this.checkedAt = 0;
    this.attemptedAt = 0;
    this.status = emptyCoupleStatus();
    this.sheetVisible = false;
    this.applyPartner(undefined);
  }

  setVisible(value: boolean): void {
    if (value === this.visible) return;
    this.visible = value;
    this.revision += 1;
    this.persistence?.('visible', value ? '1' : '0');
  }

  bound(): boolean { return this.status.kind === 'active'; }

  /** The partner's courses are drawn over the grid. */
  showing(): boolean { return this.bound() && this.visible && !!this.partner?.result; }

  partnerName(): string { return this.status.partner.nickname || 'TA'; }

  /** The partner's courses on `date` ("yyyy-MM-dd"); none outside their term. */
  blocksOn(date: string): NativeCourseBlock[] {
    const store = this.partner;
    if (!store?.result || !date) return [];
    let blocks = this.dayCache.get(date);
    if (!blocks) {
      blocks = store.blocksOnDate(date);
      this.dayCache.set(date, blocks);
    }
    return blocks;
  }

  tint(owner: string, name: string, dark: boolean): CoupleTint {
    return coupleTint(owner, name, this.status.me.color, this.status.partner.color, dark);
  }

  /** What the partner is doing right now: the status line (`short`) or the sheet's row. */
  nowText(minutes: number, short: boolean = true): string {
    const store = this.partner;
    const today = shareDateKey(Date.now());
    const courses: CoupleTimedCourse[] = this.blocksOn(today).map((block: NativeCourseBlock): CoupleTimedCourse => {
      return { name: block.course.name, start: store?.slotStart(block.startSlot) ?? '', end: store?.slotEnd(block.endSlot) ?? '' };
    });
    return coupleNowText(this.status.partner.nickname, !!store?.result, !!store?.dateSlot(today), courses, minutes, short);
  }

  daysTogether(): number { return coupleDaysTogether(this.status.anniversary, shareDateKey(Date.now())); }

  /**
   * Asks the server who the user is bound to and fetches the partner's timetable. Unforced calls
   * are spaced out: an unbound account is asked again after ten minutes, a bound one after a minute.
   */
  async refresh(force: boolean = false): Promise<void> {
    if (!this.api || this.refreshing) return;
    const now = Date.now();
    if (!force && this.checkedAt > 0 && now - this.checkedAt < (this.bound() ? BOUND_PAUSE_MS : UNBOUND_PAUSE_MS)) return;
    // A request that fails (signed out, page not ready) is not repeated at once either.
    if (!force && now - this.attemptedAt < RETRY_PAUSE_MS) return;
    this.attemptedAt = now;
    this.refreshing = true;
    const generation = this.generation;
    const reply = await this.api({ action: 'status' });
    if (generation === this.generation && reply.ok) {
      this.applyStatus(reply.data);
      this.checkedAt = now;
      await this.loadPartner(generation);
    }
    this.refreshing = false;
  }

  private applyStatus(raw?: RawCoupleStatus): void {
    const before = this.status;
    this.status = coupleStatusFrom(raw);
    if (this.status.kind !== 'active') {
      this.applyPartner(undefined);
      if (this.syncMark) { this.syncMark = ''; this.persistence?.('sync', ''); }
    }
    if (before.kind !== this.status.kind || before.me.color !== this.status.me.color) this.revision += 1;
  }

  private async loadPartner(generation: number): Promise<void> {
    if (!this.api || !this.bound()) return;
    const reply = await this.api({ action: 'schedules' });
    if (generation !== this.generation || !reply.ok || !this.bound()) return;
    this.applyPartner(reply.data?.partner);
  }

  private applyPartner(party?: RawCoupleParty | null): void {
    let schedule: SharedSchedule | undefined = undefined;
    if (party) {
      // The share reader clamps everything a grid indexes with; a snapshot it refuses is not drawn.
      const document: RawShareDocument = { code: 'COUPLE', owner: this.status.partner.nickname, semester: party.semester,
        schedule: party.schedule, calendar: party.calendar };
      try { schedule = readSharedSchedule(document, Date.now()); } catch (_) { schedule = undefined; }
    }
    const print = schedule ? coupleFingerprint(JSON.stringify(schedule.cells) + JSON.stringify(schedule.calendar)) : '';
    if (print === this.partnerPrint) return;
    this.partnerPrint = print;
    this.dayCache.clear();
    if (schedule) {
      const store = new NativeScheduleStore();
      const raw = JSON.stringify(sharedScheduleSnapshot(schedule, Date.now()));
      store.readOnly = true;
      store.attach((request: NativeScheduleRequest) => { if (request.id) store.acceptResult(request.id, raw); }, () => undefined);
      store.markBridgeReady();
      this.partner = store;
    } else {
      this.partner = undefined;
    }
    this.revision += 1;
  }

  /**
   * Uploads the user's whole current term so the partner sees it. The same content is sent again
   * only after twelve hours, to keep its "synced" time fresh. `body` throws while the term is not
   * complete; then nothing is sent.
   */
  async sync(body: () => SharePublishBody): Promise<void> {
    if (!this.api || !this.bound() || this.syncing) return;
    let payload: SharePublishBody;
    try { payload = body(); } catch (_) { return; }
    const print = this.account + '|' + coupleFingerprint(JSON.stringify(payload));
    const now = Date.now();
    const last = this.syncMark.split('@');
    if (last.length === 2 && last[0] === print && now - Number(last[1]) >= 0 && now - Number(last[1]) < UNCHANGED_RESYNC_MS) return;
    this.syncing = true;
    const generation = this.generation;
    const reply = await this.api({ action: 'sync', body: payload });
    this.syncing = false;
    if (generation !== this.generation || !reply.ok) return;
    this.syncMark = `${print}@${now}`;
    this.persistence?.('sync', this.syncMark);
  }

  // ---- The sheet ----

  open(): void {
    this.error = '';
    this.notice = '';
    this.sheetVisible = true;
    void this.refresh(true);
  }

  close(): void {
    this.sheetVisible = false;
    this.error = '';
    this.notice = '';
  }

  /** While an invite waits, the sheet keeps asking so the inviter sees the binding happen. */
  poll(): void {
    if (this.sheetVisible && this.status.kind === 'pending' && !this.busy) void this.refresh(true);
  }

  invite(): Promise<void> { return this.change({ action: 'invite' }, ''); }

  cancelInvite(): Promise<void> { return this.change({ action: 'cancelInvite' }, ''); }

  async accept(): Promise<void> {
    const code = this.codeInput.trim();
    if (!code) return;
    await this.change({ action: 'accept', code }, '');
    if (this.bound()) {
      this.codeInput = '';
      this.notice = `已和 ${this.partnerName()} 绑定`;
    }
  }

  unbind(): Promise<void> { return this.change({ action: 'unbind' }, '已解除绑定'); }

  /** An empty date clears the anniversary. */
  setAnniversary(date: string): Promise<void> {
    const body: CoupleSettingsBody = { anniversary: date ? date : null };
    return this.change({ action: 'settings', body }, date ? '纪念日已保存' : '纪念日已清除');
  }

  swapColors(): Promise<void> {
    const body: CoupleSettingsBody = { myColor: this.status.me.color === 'blue' ? 'pink' : 'blue' };
    return this.change({ action: 'settings', body }, '配色已互换');
  }

  private async change(request: CoupleApiRequest, success: string): Promise<void> {
    if (!this.api || this.busy) return;
    this.error = '';
    this.notice = '';
    this.busy = 'change';
    const generation = this.generation;
    const reply = await this.api(request);
    if (generation !== this.generation) return;
    this.busy = '';
    if (!reply.ok) { this.error = reply.error || '请求失败，请稍后再试'; return; }
    this.applyStatus(reply.data);
    this.checkedAt = Date.now();
    this.notice = success;
    await this.loadPartner(generation);
  }
}

@Component
export struct NativeScheduleCouple {
  @ObjectLink model: NativeScheduleCoupleModel;
  @Prop dark: boolean = false;
  // Minutes since midnight, as the timetable marks "now".
  @Prop nowMinutes: number = 0;
  @Prop origin: string = 'https://cputime.cn';
  onCopy: (text: string) => void = () => undefined;
  onSend: (text: string) => void = () => undefined;
  private pollTimer: number = -1;

  aboutToAppear(): void {
    this.pollTimer = setInterval(() => this.model.poll(), 10000);
  }

  aboutToDisappear(): void {
    clearInterval(this.pollTimer);
  }

  build() {
    Scroll() {
      Column({ space: 16 }) {
        Text('情侣课表').fontSize(22).fontWeight(FontWeight.Bold).fontColor($r('app.color.app_text_primary')).width('100%')
        if (this.model.error) {
          Text(this.model.error).fontSize(13).fontColor('#B42318').width('100%')
        } else if (this.model.notice) {
          Text(this.model.notice).fontSize(13).fontColor($r('app.color.app_accent')).width('100%')
        }
        if (this.model.status.kind === 'unknown') {
          Row({ space: 8 }) {
            LoadingProgress().width(18).height(18).color($r('app.color.app_accent'))
            Text('正在读取绑定状态…').fontSize(13).fontColor($r('app.color.app_text_secondary'))
          }.width('100%')
        } else if (this.model.status.kind === 'active') {
          this.boundContent()
        } else {
          this.unboundContent()
        }
      }.width('100%').padding({ left: 20, right: 20, top: 32, bottom: 40 })
    }.width('100%').height('100%').scrollBar(BarState.Off).align(Alignment.Top).backgroundColor($r('app.color.app_surface'))
  }

  @Builder
  private person(name: string, color: string) {
    Column({ space: 6 }) {
      Text(name.substring(0, 1)).fontSize(18).fontWeight(FontWeight.Bold).fontColor(coupleTone(color, '', this.dark).text)
        .width(46).height(46).textAlign(TextAlign.Center).borderRadius(23)
        .backgroundColor(coupleTone(color, '', this.dark).fill)
        .border({ width: 1, color: coupleTone(color, '', this.dark).border, radius: 23 })
      Text(name).fontSize(13).fontWeight(600).fontColor($r('app.color.app_text_primary')).maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
    }.layoutWeight(1).alignItems(HorizontalAlign.Center)
  }

  @Builder
  private swatch(label: string, color: string) {
    Text(label).fontSize(11).fontWeight(FontWeight.Bold).fontColor(coupleTone(color, '', this.dark).text)
      .padding({ left: 10, right: 10, top: 3, bottom: 3 }).borderRadius(11)
      .backgroundColor(coupleTone(color, '', this.dark).fill)
      .border({ width: 1, color: coupleTone(color, '', this.dark).border, radius: 11 })
      .accessibilityText(label + (color === 'pink' ? '，粉色' : '，蓝色'))
  }

  @Builder
  private line(label: string, value: string) {
    Row({ space: 12 }) {
      Text(label).fontSize(14).fontColor($r('app.color.app_text_secondary'))
      Text(value).fontSize(14).fontWeight(600).fontColor($r('app.color.app_text_primary')).layoutWeight(1)
        .textAlign(TextAlign.End).maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
    }.width('100%').constraintSize({ minHeight: 44 }).accessibilityGroup(true)
  }

  @Builder
  private boundContent() {
    Row() {
      this.person(this.model.status.me.nickname || '我', this.model.status.me.color)
      Column({ space: 2 }) {
        SymbolGlyph($r('sys.symbol.heart_fill')).fontSize(24).fontColor([COUPLE_ACCENT])
        if (this.model.daysTogether() > 0) {
          Text(`第 ${this.model.daysTogether()} 天`).fontSize(12).fontWeight(600).fontColor(COUPLE_ACCENT)
        }
      }.alignItems(HorizontalAlign.Center).accessibilityGroup(true)
      this.person(this.model.partnerName(), this.model.status.partner.color)
    }.width('100%')
    Column() {
      this.line('TA 此刻', this.model.nowText(this.nowMinutes, false))
      Divider().color($r('app.color.app_divider'))
      this.line('TA 的课表', this.syncedLabel(this.model.status.partner.syncedAt, '还没有同步'))
      Divider().color($r('app.color.app_divider'))
      this.line('我的课表', this.syncedLabel(this.model.status.me.syncedAt, '打开课表后自动同步'))
      Divider().color($r('app.color.app_divider'))
      Row({ space: 8 }) {
        Text('配色').fontSize(14).fontColor($r('app.color.app_text_secondary')).layoutWeight(1)
        this.swatch('我', this.model.status.me.color)
        this.swatch('TA', this.model.status.partner.color)
        Text('互换').fontSize(14).fontWeight(600).fontColor($r('app.color.app_accent')).padding({ left: 6, top: 8, bottom: 8 })
          .id('schedule-couple-swap').onClick(() => { void this.model.swapColors(); })
      }.width('100%').constraintSize({ minHeight: 44 })
      Divider().color($r('app.color.app_divider'))
      Row({ space: 12 }) {
        Text('在课表里显示 TA 的课').fontSize(14).fontColor($r('app.color.app_text_secondary')).layoutWeight(1)
        Toggle({ type: ToggleType.Switch, isOn: this.model.visible }).selectedColor($r('app.color.app_accent'))
          .id('schedule-couple-visible').onChange((value: boolean) => this.model.setVisible(value))
      }.width('100%').constraintSize({ minHeight: 44 })
      Divider().color($r('app.color.app_divider'))
      Row({ space: 12 }) {
        Text('纪念日').fontSize(14).fontColor($r('app.color.app_text_secondary')).layoutWeight(1)
        if (this.model.status.anniversary) {
          Text('清除').fontSize(13).fontColor('#B42318').padding({ top: 8, bottom: 8 })
            .onClick(() => { void this.model.setAnniversary(''); })
        }
        Text(this.model.status.anniversary ? this.model.status.anniversary.split('-').join('.') : '未设置').fontSize(14).fontWeight(600)
          .fontColor($r('app.color.app_accent')).padding({ top: 8, bottom: 8 })
          .id('schedule-couple-anniversary').onClick(() => this.pickAnniversary())
      }.width('100%').constraintSize({ minHeight: 44 })
    }.width('100%').padding({ left: 14, right: 14 }).borderRadius(16).backgroundColor($r('app.color.app_control'))
    Text('两人的课在同一张课表里：一起上的课合并成一格，时间撞在一起的课左边是你的、右边是 TA 的，其余各占整格。配色双方看到的一样，任意一方都可以互换。')
      .fontSize(12).fontColor($r('app.color.app_text_tertiary')).width('100%')
    Text('解除绑定').fontSize(14).fontWeight(600).fontColor('#B42318').padding({ top: 8, bottom: 8 })
      .id('schedule-couple-unbind').onClick(() => this.confirmUnbind())
  }

  @Builder
  private unboundContent() {
    Text('绑定后，TA 的课会和你的课显示在同一张课表里，两人都有空的时间一目了然。任何一方都可以随时解除，解除后双方的课表快照立即删除。')
      .fontSize(13).fontColor($r('app.color.app_text_secondary')).width('100%')
    Column({ space: 8 }) {
      Text('邀请 TA').fontSize(14).fontWeight(600).fontColor($r('app.color.app_text_secondary')).width('100%').padding({ left: 4 })
      Column({ space: 12 }) {
        if (this.inviteCode()) {
          Text(this.inviteCode()).fontSize(30).fontWeight(FontWeight.Bold).fontFamily('monospace').letterSpacing(6)
            .fontColor($r('app.color.app_text_primary')).width('100%').textAlign(TextAlign.Center).copyOption(CopyOptions.LocalDevice)
            .accessibilityText('邀请码 ' + this.inviteCode().split('').join(' '))
          Text('24 小时内有效，TA 在「课表 → 更多 → 情侣课表」里输入。正在等待 TA 接受…').fontSize(12)
            .fontColor($r('app.color.app_text_secondary')).width('100%').textAlign(TextAlign.Center)
          Row({ space: 8 }) {
            Button('复制邀请').type(ButtonType.Normal).height(40).layoutWeight(1).borderRadius(12).fontSize(14)
              .fontColor($r('app.color.app_on_accent')).backgroundColor($r('app.color.app_accent'))
              .onClick(() => this.onCopy(coupleInvitation(this.inviteCode(), this.origin)))
            Button('发送').type(ButtonType.Normal).height(40).layoutWeight(1).borderRadius(12).fontSize(14)
              .fontColor($r('app.color.app_accent')).backgroundColor($r('app.color.app_accent_surface'))
              .onClick(() => this.onSend(coupleInvitation(this.inviteCode(), this.origin)))
          }.width('100%')
          Row({ space: 8 }) {
            Button('换一个').type(ButtonType.Normal).height(40).layoutWeight(1).borderRadius(12).fontSize(14)
              .fontColor($r('app.color.app_accent')).backgroundColor($r('app.color.app_surface')).enabled(!this.model.busy)
              .onClick(() => { void this.model.invite(); })
            Button('取消邀请').type(ButtonType.Normal).height(40).width(104).borderRadius(12).fontSize(14)
              .fontColor('#B42318').backgroundColor($r('app.color.app_surface')).enabled(!this.model.busy)
              .onClick(() => { void this.model.cancelInvite(); })
          }.width('100%')
        } else {
          Text('生成一个邀请码发给 TA。').fontSize(13).fontColor($r('app.color.app_text_secondary')).width('100%')
          Button(this.model.busy ? '处理中' : '生成邀请码').type(ButtonType.Normal).height(44).width('100%').borderRadius(12).fontSize(15)
            .fontColor($r('app.color.app_on_accent')).backgroundColor($r('app.color.app_accent')).enabled(!this.model.busy)
            .id('schedule-couple-invite').onClick(() => { void this.model.invite(); })
        }
      }.width('100%').padding(14).borderRadius(16).backgroundColor($r('app.color.app_control'))
    }.width('100%')
    Column({ space: 8 }) {
      Text('输入 TA 的邀请码').fontSize(14).fontWeight(600).fontColor($r('app.color.app_text_secondary')).width('100%').padding({ left: 4 })
      Row({ space: 8 }) {
        TextInput({ text: this.model.codeInput, placeholder: '6 位邀请码' }).height(44).layoutWeight(1).maxLength(20)
          .backgroundColor($r('app.color.app_surface')).borderRadius(12).id('schedule-couple-code')
          .accessibilityText('TA 的邀请码').onChange((value: string) => this.model.codeInput = value)
          .onSubmit(() => this.accept())
        Button('绑定').type(ButtonType.Normal).height(44).width(76).borderRadius(12).fontSize(14)
          .fontColor($r('app.color.app_on_accent')).backgroundColor($r('app.color.app_accent'))
          .enabled(!this.model.busy && this.model.codeInput.trim().length > 0)
          .onClick(() => this.accept())
      }.width('100%').padding(14).borderRadius(16).backgroundColor($r('app.color.app_control'))
    }.width('100%')
  }

  private inviteCode(): string {
    return this.model.status.kind === 'pending' && !this.model.status.expired ? this.model.status.code : '';
  }

  private syncedLabel(iso: string, missing: string): string {
    const label = coupleRelativeTime(iso, Date.now());
    return label ? '同步于 ' + label : missing;
  }

  private accept(): void {
    this.getUIContext().getFocusController().clearFocus();
    void this.model.accept();
  }

  // A day up to today.
  private pickAnniversary(): void {
    if (this.model.busy) return;
    const current = this.model.status.anniversary;
    const selected = current ? new Date(Number(current.substring(0, 4)), Number(current.substring(5, 7)) - 1, Number(current.substring(8, 10))) : new Date();
    DatePickerDialog.show({ start: new Date(1970, 0, 1), end: new Date(), selected,
      onDateAccept: (value: Date) => {
        const pad = (part: number): string => String(part).padStart(2, '0');
        void this.model.setAnniversary(`${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`);
      } });
  }

  private confirmUnbind(): void {
    if (this.model.busy) return;
    AlertDialog.show({ title: '解除绑定', message: `确定解除和 ${this.model.partnerName()} 的绑定吗？双方的课表快照和纪念日会立即删除。`,
      primaryButton: { value: '再想想', action: () => undefined },
      secondaryButton: { value: '解除', fontColor: '#B42318', action: () => { void this.model.unbind(); } } });
  }
}
