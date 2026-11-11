import { coupleFingerprint, coupleHsl } from './ScheduleCouple';
import { SharePublishBody } from './ScheduleSharing';

// 宿舍课表 as a native sheet (iOS NativeDormSheet, Android ScheduleDormSheet): 一周, 空闲, 早八 and 宿舍.
// The data and every calculation come from the page (harmony/bridge/dorm.ts, which runs the site's
// dorm.ts and dormWeek.ts), so the three clients and the Web show the same answers; this file draws.

export interface DormMemberInfo {
  id: number;
  color: string;
  nickname: string;
  isOwner: boolean;
  snapshot?: DormSnapshotMeta | null;
}
export interface DormSnapshotMeta { semester: string; syncedAt: string; }
export interface DormInviteInfo { code?: string | null; expired?: boolean; }
export interface DormStatusInfo {
  status: string;
  id?: number;
  name?: string | null;
  memberLimit?: number;
  isOwner?: boolean;
  invite?: DormInviteInfo | null;
  me?: DormMemberInfo;
  members?: DormMemberInfo[];
}
export interface DormBusyInfo { id: number; courses: string[]; }
export interface DormCellInfo {
  ymd: string;
  level: string;
  ratio: number;
  summary: string;
  freeIds: number[];
  unknownIds: number[];
  busy: DormBusyInfo[];
}
export interface DormRowInfo { start: string; end: string; label: string; breakBefore: boolean; cells: DormCellInfo[]; }
export interface DormWeekInfo { monday: string; thisWeek: boolean; title: string; dates: string[]; rows: DormRowInfo[]; }
export interface DormWindowInfo { start: number; end: number; text: string; minutes: number; label: string; freeIds: number[]; }
export interface DormSpanInfo { start: number; end: number; }
export interface DormTrackInfo { id: number; busy: DormSpanInfo[] | null; }
export interface DormOptionInfo { value: number; label: string; }
export interface DormDayName { ymd: string; name: string; }
export interface DormFreeInfo {
  date: string;
  title: string;
  minFree: number;
  options: DormOptionInfo[];
  windowStart: number;
  windowEnd: number;
  windows: DormWindowInfo[];
  empty: string;
  unknownNames: string;
  tracks: DormTrackInfo[];
  days: DormDayName[];
}
export interface DormDutyInfo { id: number; nickname: string; color: string; course: string; time: string; }
export interface DormMorningDayInfo { ymd: string; title: string; none: string; duties: DormDutyInfo[]; }
export interface DormNextInfo { title: string; names: string; }
export interface DormMorningInfo { summary: string; next?: DormNextInfo | null; days: DormMorningDayInfo[]; }
export interface DormViewInfo { today: string; ready: boolean; week: DormWeekInfo; free: DormFreeInfo; morning: DormMorningInfo; }
export interface DormReplyData extends DormStatusInfo {
  view?: DormViewInfo;
}
export interface DormViewReply { status?: DormStatusInfo; view?: DormViewInfo; }
export interface DormReply { data?: DormViewReply | DormStatusInfo; error?: string; status?: number; }
export interface DormRequest {
  action: string;
  monday?: string;
  freeDate?: string;
  minFree?: number;
  refresh?: boolean;
  code?: string;
  userId?: number;
  body?: SharePublishBody | DormSettingsBody;
}
export interface DormSettingsBody { myColor?: string; name?: string | null; }
export type DormApi = (request: DormRequest) => Promise<DormReply>;

export const DORM_COLORS: string[] = ['blue', 'pink', 'purple', 'teal', 'green', 'amber', 'orange', 'red'];
const DORM_HUES: number[] = [214, 338, 268, 178, 138, 42, 22, 358];
const UNCHANGED_RESYNC_MS: number = 12 * 60 * 60 * 1000;

/** A member's colour (the site's dormPersonTone): `name` is for text on the page, `border` for marks. */
export function dormTone(color: string, dark: boolean): string[] {
  const hue = DORM_HUES[Math.max(0, DORM_COLORS.indexOf(color))];
  return dark ? [coupleHsl(hue, 48, 29), coupleHsl(hue, 62, 50), coupleHsl(hue, 75, 74)]
    : [coupleHsl(hue, 88, 93), coupleHsl(hue, 72, 77), coupleHsl(hue, 62, 30)];
}

/** A dorm invite link or code as typed or pasted: the code, or ''. */
export function dormCodeFrom(input: string): string {
  const text = (input ?? '').trim();
  const match = /[?&]code=([A-Za-z0-9]{4,12})/.exec(text);
  const code = (match ? match[1] : text).replace(/\s+/g, '').toUpperCase();
  return /^[A-Z0-9]{4,12}$/.test(code) ? code : '';
}

@Observed
export class NativeDormModel {
  visible: boolean = false;
  // week | free | morning | room
  page: string = 'week';
  status: DormStatusInfo = { status: 'unknown' };
  view?: DormViewInfo;
  busy: boolean = false;
  error: string = '';
  notice: string = '';
  codeInput: string = '';
  monday: string = '';
  freeDate: string = '';
  minFree: number = 0;
  // The week cell looked at: "row:day", '' for none.
  cell: string = '';
  private api?: DormApi;
  private account: string = '';
  private syncMark: string = '';
  private persistence?: (mark: string) => void;

  attach(api: DormApi, persistence: (mark: string) => void): void {
    this.api = api;
    this.persistence = persistence;
  }

  restore(mark: string): void { this.syncMark = mark; }

  adopt(account: string): void {
    if (account === this.account) return;
    this.account = account;
    this.status = { status: 'unknown' };
    this.view = undefined;
    this.visible = false;
  }

  /** Opens the sheet; a code from an invite link is filled in for joining. */
  open(code: string = ''): void {
    this.visible = true;
    this.error = '';
    this.notice = '';
    if (code) this.codeInput = code;
    void this.load(true);
  }

  close(): void { this.visible = false; this.cell = ''; }

  active(): boolean { return this.status.status === 'active'; }

  async load(refresh: boolean = false): Promise<void> {
    if (!this.api) return;
    this.busy = true;
    const reply = await this.api({ action: 'view', monday: this.monday, freeDate: this.freeDate, minFree: this.minFree, refresh });
    this.busy = false;
    if (reply.error) { this.error = reply.error; return; }
    const data = reply.data as DormViewReply;
    this.status = data.status ?? { status: 'none' };
    this.view = data.view;
    if (this.view) {
      this.monday = this.view.week.monday;
      this.freeDate = this.view.free.date;
    }
  }

  moveWeek(delta: number): void {
    const monday = this.view?.week.monday ?? '';
    if (!monday) return;
    this.monday = new Date(Date.UTC(Number(monday.substring(0, 4)), Number(monday.substring(5, 7)) - 1,
      Number(monday.substring(8, 10)) + delta * 7)).toISOString().substring(0, 10);
    this.cell = '';
    void this.load();
  }

  pickDay(date: string): void {
    this.freeDate = date;
    this.page = 'free';
    void this.load();
  }

  pickMinFree(value: number): void {
    this.minFree = value;
    void this.load();
  }

  name(id: number): string {
    return (this.status.members ?? []).find((member: DormMemberInfo) => member.id === id)?.nickname || '室友';
  }

  color(id: number): string {
    return (this.status.members ?? []).find((member: DormMemberInfo) => member.id === id)?.color || 'blue';
  }

  async change(request: DormRequest, success: string): Promise<void> {
    if (!this.api || this.busy) return;
    this.busy = true;
    this.error = '';
    this.notice = '';
    const reply = await this.api(request);
    this.busy = false;
    if (reply.error) { this.error = reply.error; return; }
    this.notice = success;
    await this.load(true);
  }

  /**
   * Uploads the user's whole current term while they are in a dorm. The same content goes again
   * only after twelve hours, to keep its 同步于 fresh; `force` (立即同步) always sends it.
   */
  async sync(body: () => SharePublishBody, force: boolean = false): Promise<boolean> {
    if (!this.api) return false;
    let payload: SharePublishBody;
    try { payload = body(); } catch (_) { return false; }
    if (this.status.status === 'unknown') {
      const reply = await this.api({ action: 'status' });
      if (!reply.error && reply.data) this.status = reply.data as DormStatusInfo;
    }
    if (!this.active()) return false;
    const print = this.account + '|' + coupleFingerprint(JSON.stringify(payload));
    const now = Date.now();
    const last = this.syncMark.split('@');
    const serverHas = this.status.me?.snapshot?.semester === payload.semester;
    if (!force && serverHas && last.length === 2 && last[0] === print && now - Number(last[1]) < UNCHANGED_RESYNC_MS) return false;
    const reply = await this.api({ action: 'sync', body: payload });
    if (reply.error) { if (force) this.error = reply.error; return false; }
    this.syncMark = `${print}@${now}`;
    this.persistence?.(this.syncMark);
    return true;
  }
}

@Component
export struct NativeDormSheet {
  @ObjectLink model: NativeDormModel;
  @Prop dark: boolean = false;
  publishBody: () => SharePublishBody = () => { throw new Error('整学期课表还没有加载完，请刷新课表后再试'); };

  build() {
    Column() {
      Row() {
        Text(this.model.status.name || '宿舍课表').fontSize(20).fontWeight(FontWeight.Bold)
          .fontColor($r('app.color.app_text_primary')).layoutWeight(1).maxLines(1)
        if (this.model.busy) LoadingProgress().width(20).height(20).color($r('app.color.app_accent'))
        Text('刷新').fontSize(14).fontColor($r('app.color.app_accent')).padding(8).margin({ right: 40 })
          .id('dorm-refresh').onClick(() => { void this.model.load(true); })
      }.width('100%').padding({ left: 20, right: 12, top: 20 })
      if (this.model.error) {
        Text(this.model.error).fontSize(13).fontColor('#B42318').width('100%').padding({ left: 20, right: 20, top: 4 })
      } else if (this.model.notice) {
        Text(this.model.notice).fontSize(13).fontColor($r('app.color.app_accent')).width('100%').padding({ left: 20, right: 20, top: 4 })
      }
      if (this.model.status.status === 'unknown') {
        Column() { LoadingProgress().width(28).height(28).color($r('app.color.app_accent')) }
          .width('100%').layoutWeight(1).justifyContent(FlexAlign.Center)
      } else if (!this.model.active()) {
        Scroll() { this.joinPage() }.width('100%').layoutWeight(1).scrollBar(BarState.Off).align(Alignment.Top)
      } else {
        Row({ space: 2 }) {
          this.tab('一周', 'week')
          this.tab('空闲', 'free')
          this.tab('早八', 'morning')
          this.tab('宿舍', 'room')
        }.width('100%').padding(2).margin({ left: 16, right: 16, top: 10 }).borderRadius(10).backgroundColor($r('app.color.app_divider'))
          .constraintSize({ maxWidth: 520 })
        Scroll() {
          Column({ space: 14 }) {
            if (!this.model.view?.ready && this.model.page !== 'room') {
              Text('还没有人同步课表。打开课表会自动同步，也可以在「宿舍」里立即同步；室友同步后点「刷新」就能看到。')
                .fontSize(13).fontColor($r('app.color.app_text_secondary')).width('100%')
            }
            if (this.model.page === 'week') this.weekPage()
            else if (this.model.page === 'free') this.freePage()
            else if (this.model.page === 'morning') this.morningPage()
            else this.roomPage()
          }.width('100%').padding({ left: 16, right: 16, top: 14, bottom: 40 })
        }.width('100%').layoutWeight(1).scrollBar(BarState.Off).align(Alignment.Top)
      }
    }.width('100%').height('100%').backgroundColor($r('app.color.app_surface'))
  }

  @Builder
  private tab(title: string, page: string) {
    Text(title).fontSize(14).fontWeight(this.model.page === page ? 600 : 400).layoutWeight(1).height(32).textAlign(TextAlign.Center)
      .borderRadius(8).fontColor(this.model.page === page ? $r('app.color.app_text_primary') : $r('app.color.app_text_secondary'))
      .backgroundColor(this.model.page === page ? $r('app.color.app_surface') : Color.Transparent)
      .id('dorm-tab-' + page).onClick(() => { this.model.page = page; this.model.cell = ''; })
  }

  // ---- 一周 ----

  @Builder
  private weekPage() {
    if (this.model.view) {
      Row() {
        Text('‹').fontSize(22).fontColor($r('app.color.app_text_primary')).padding({ left: 8, right: 8 })
          .id('dorm-week-previous').onClick(() => this.model.moveWeek(-1))
        Text(this.model.view.week.title).fontSize(14).fontWeight(600).fontColor($r('app.color.app_text_primary'))
          .layoutWeight(1).textAlign(TextAlign.Center)
        Text('›').fontSize(22).fontColor($r('app.color.app_text_primary')).padding({ left: 8, right: 8 })
          .id('dorm-week-next').onClick(() => this.model.moveWeek(1))
      }.width('100%')
      Column({ space: 2 }) {
        Row({ space: 2 }) {
          Text('').width(34)
          ForEach(this.model.view.week.dates, (date: string, index: number) => {
            Column() {
              Text(['一', '二', '三', '四', '五', '六', '日'][index]).fontSize(11).fontWeight(600)
                .fontColor(date === this.model.view?.today ? $r('app.color.app_accent') : $r('app.color.app_text_secondary'))
              Text(date.substring(8)).fontSize(10).fontColor($r('app.color.app_text_tertiary'))
            }.layoutWeight(1)
          }, (date: string) => date)
        }.width('100%')
        ForEach(this.model.view.week.rows, (row: DormRowInfo, rowIndex: number) => {
          Row({ space: 2 }) {
            Column() {
              Text(row.label).fontSize(11).fontWeight(600).fontColor($r('app.color.app_text_primary'))
              Text(row.start).fontSize(8).fontColor($r('app.color.app_text_tertiary'))
            }.width(34)
            ForEach(row.cells, (cell: DormCellInfo, dayIndex: number) => {
              Stack() {
                if (cell.freeIds.length && cell.level !== 'all') {
                  Text(String(cell.freeIds.length)).fontSize(10).fontWeight(600).fontColor($r('app.color.app_text_primary'))
                }
              }.layoutWeight(1).height(30).borderRadius(5)
                .backgroundColor(this.cellFill(cell))
                .border({ width: this.model.cell === `${rowIndex}:${dayIndex}` ? 2 : cell.level === 'unknown' ? 0.6 : 0,
                  color: this.model.cell === `${rowIndex}:${dayIndex}` ? $r('app.color.app_accent') : $r('app.color.app_divider'), radius: 5,
                  style: cell.level === 'unknown' ? BorderStyle.Dashed : BorderStyle.Solid })
                .id(`dorm-cell-${rowIndex}-${dayIndex}`)
                .accessibilityText(cell.summary)
                .onClick(() => this.model.cell = `${rowIndex}:${dayIndex}`)
            }, (cell: DormCellInfo) => cell.ymd)
          }.width('100%').margin({ top: row.breakBefore ? 6 : 0 })
        }, (row: DormRowInfo) => row.label + row.start)
      }.width('100%')
      Row({ space: 12 }) {
        this.legend(this.cellFill({ ymd: '', level: 'all', ratio: 1, summary: '', freeIds: [], unknownIds: [], busy: [] }), '全员有空')
        this.legend(this.cellFill({ ymd: '', level: 'some', ratio: 0.5, summary: '', freeIds: [], unknownIds: [], busy: [] }), '部分有空')
        this.legend(this.cellFill({ ymd: '', level: 'none', ratio: 0, summary: '', freeIds: [], unknownIds: [], busy: [] }), '都在上课')
      }.width('100%')
      if (this.selectedCell()) this.cellDetail()
    }
  }

  @Builder
  private legend(color: string, text: string) {
    Row({ space: 4 }) {
      Column().width(12).height(12).borderRadius(3).backgroundColor(color)
      Text(text).fontSize(11).fontColor($r('app.color.app_text_secondary'))
    }
  }

  @Builder
  private cellDetail() {
    Column({ space: 8 }) {
      Text(this.selectedCell()?.summary ?? '').fontSize(15).fontWeight(600).fontColor($r('app.color.app_text_primary')).width('100%')
      if (this.selectedCell()?.freeIds.length) {
        Text('有空：' + (this.selectedCell()?.freeIds ?? []).map((id: number) => this.model.name(id)).join('、')).fontSize(13)
          .fontColor($r('app.color.app_text_secondary')).width('100%')
      }
      ForEach(this.selectedCell()?.busy ?? [], (item: DormBusyInfo) => {
        Row({ space: 6 }) {
          Circle().width(8).height(8).fill(dormTone(this.model.color(item.id), this.dark)[1])
          Text(`${this.model.name(item.id)}：${item.courses.join('、')}`).fontSize(13).fontColor($r('app.color.app_text_primary')).layoutWeight(1)
        }.width('100%')
      }, (item: DormBusyInfo) => String(item.id))
      if (this.selectedCell()?.unknownIds.length) {
        Text('没有数据：' + (this.selectedCell()?.unknownIds ?? []).map((id: number) => this.model.name(id)).join('、')).fontSize(12)
          .fontColor($r('app.color.app_text_tertiary')).width('100%')
      }
      Text('看这天的空闲时段 ›').fontSize(13).fontWeight(600).fontColor($r('app.color.app_accent')).width('100%')
        .id('dorm-cell-free').onClick(() => this.model.pickDay(this.selectedCell()?.ymd ?? ''))
    }.width('100%').padding(14).borderRadius(14).backgroundColor($r('app.color.app_control'))
  }

  // ---- 空闲 ----

  @Builder
  private freePage() {
    if (this.model.view) {
      Scroll() {
        Row({ space: 6 }) {
          ForEach(this.model.view.free.days, (day: DormDayName) => {
            Column() {
              Text(day.name).fontSize(13).fontWeight(600)
                .fontColor(day.ymd === this.model.view?.free.date ? $r('app.color.app_on_accent') : $r('app.color.app_text_primary'))
              Text(day.ymd.substring(5)).fontSize(10)
                .fontColor(day.ymd === this.model.view?.free.date ? $r('app.color.app_on_accent') : $r('app.color.app_text_secondary'))
            }.padding({ left: 10, right: 10, top: 6, bottom: 6 }).borderRadius(10)
              .backgroundColor(day.ymd === this.model.view?.free.date ? $r('app.color.app_accent') : $r('app.color.app_control'))
              .onClick(() => this.model.pickDay(day.ymd))
          }, (day: DormDayName) => day.ymd)
        }
      }.scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off).width('100%')
      Row({ space: 6 }) {
        ForEach(this.model.view.free.options, (option: DormOptionInfo) => {
          Text(option.label).fontSize(12).padding({ left: 10, right: 10, top: 5, bottom: 5 }).borderRadius(12)
            .fontColor(option.value === this.model.view?.free.minFree ? $r('app.color.app_on_accent') : $r('app.color.app_text_primary'))
            .backgroundColor(option.value === this.model.view?.free.minFree ? $r('app.color.app_accent') : $r('app.color.app_control'))
            .id('dorm-min-' + option.value).onClick(() => this.model.pickMinFree(option.value))
        }, (option: DormOptionInfo) => String(option.value))
      }.width('100%')
      Text(this.model.view.free.title + ' 的空闲时段').fontSize(15).fontWeight(600).fontColor($r('app.color.app_text_primary')).width('100%')
      if (this.model.view.free.empty) {
        Text(this.model.view.free.empty).fontSize(13).fontColor($r('app.color.app_text_secondary')).width('100%')
      }
      ForEach(this.model.view.free.windows, (window: DormWindowInfo) => {
        Row({ space: 12 }) {
          Column().width(4).height(34).borderRadius(2).backgroundColor('#14B8A6')
          Column({ space: 2 }) {
            Text(window.text).fontSize(16).fontWeight(600).fontColor($r('app.color.app_text_primary'))
            Text(window.label + ' · ' + window.freeIds.map((id: number) => this.model.name(id)).join('、')).fontSize(12)
              .fontColor($r('app.color.app_text_secondary')).maxLines(2)
          }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        }.width('100%').padding(10).borderRadius(12).backgroundColor($r('app.color.app_control'))
      }, (window: DormWindowInfo) => window.text)
      if (this.model.view.free.unknownNames) {
        Text('没有课表数据：' + this.model.view.free.unknownNames).fontSize(12).fontColor($r('app.color.app_text_tertiary')).width('100%')
      }
      Text('每人当天的课').fontSize(13).fontWeight(600).fontColor($r('app.color.app_text_secondary')).width('100%').margin({ top: 4 })
      ForEach(this.model.view.free.tracks, (track: DormTrackInfo) => {
        Row({ space: 8 }) {
          Text(this.model.name(track.id)).fontSize(12).fontColor(dormTone(this.model.color(track.id), this.dark)[2]).width(56).maxLines(1)
          Stack({ alignContent: Alignment.TopStart }) {
            Column().width('100%').height(10).borderRadius(5).backgroundColor(track.busy ? '#3314B8A6' : $r('app.color.app_divider'))
            ForEach(track.busy ?? [], (span: DormSpanInfo) => {
              Column().width(`${this.share(span.end - span.start)}%`).height(10).borderRadius(5)
                .backgroundColor(dormTone(this.model.color(track.id), this.dark)[1])
                .position({ x: `${this.share(span.start - (this.model.view?.free.windowStart ?? 0))}%`, y: 0 })
            }, (span: DormSpanInfo) => `${span.start}-${span.end}`)
          }.layoutWeight(1).height(10)
        }.width('100%')
      }, (track: DormTrackInfo) => String(track.id))
    }
  }

  private share(minutes: number): number {
    const view = this.model.view;
    if (!view) return 0;
    const span = Math.max(1, view.free.windowEnd - view.free.windowStart);
    return Math.max(0, Math.min(100, minutes * 100 / span));
  }

  // ---- 早八 ----

  @Builder
  private morningPage() {
    if (this.model.view) {
      if (this.model.view.morning.next) {
        Column({ space: 4 }) {
          Text(this.model.view.morning.next.title).fontSize(13).fontColor($r('app.color.app_text_secondary')).width('100%')
          Text(this.model.view.morning.next.names).fontSize(18).fontWeight(600).fontColor($r('app.color.app_text_primary')).width('100%')
        }.width('100%').padding(14).borderRadius(14).backgroundColor($r('app.color.app_control'))
      } else if (this.model.view.morning.summary) {
        Text(this.model.view.morning.summary).fontSize(14).fontColor($r('app.color.app_text_secondary')).width('100%')
      }
      ForEach(this.model.view.morning.days, (day: DormMorningDayInfo) => {
        Column({ space: 6 }) {
          Text(day.title).fontSize(14).fontWeight(600).fontColor($r('app.color.app_text_primary')).width('100%')
          if (!day.duties.length) {
            Text(day.none).fontSize(13).fontColor($r('app.color.app_text_tertiary')).width('100%')
          }
          ForEach(day.duties, (duty: DormDutyInfo) => {
            Row({ space: 8 }) {
              Circle().width(8).height(8).fill(dormTone(duty.color, this.dark)[1])
              Text(duty.nickname).fontSize(14).fontWeight(600).fontColor(dormTone(duty.color, this.dark)[2])
              Text(`${duty.time} ${duty.course}`).fontSize(13).fontColor($r('app.color.app_text_secondary')).layoutWeight(1).maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
            }.width('100%')
          }, (duty: DormDutyInfo) => String(duty.id))
        }.width('100%').padding(12).borderRadius(12).backgroundColor($r('app.color.app_control'))
      }, (day: DormMorningDayInfo) => day.ymd)
    }
  }

  // ---- 宿舍 ----

  @Builder
  private roomPage() {
    Column() {
      ForEach(this.model.status.members ?? [], (member: DormMemberInfo, index: number) => {
        Row({ space: 10 }) {
          Text(member.nickname.substring(0, 1)).fontSize(15).fontWeight(600).width(36).height(36).borderRadius(18)
            .textAlign(TextAlign.Center).fontColor(dormTone(member.color, this.dark)[2]).backgroundColor(dormTone(member.color, this.dark)[0])
            .border({ width: 1, color: dormTone(member.color, this.dark)[1], radius: 18 })
          Column({ space: 2 }) {
            Row({ space: 6 }) {
              Text(member.nickname + (member.id === this.model.status.me?.id ? '（我）' : '')).fontSize(15).fontColor($r('app.color.app_text_primary'))
              if (member.isOwner) {
                Text('舍长').fontSize(10).fontColor('#C2410C').padding({ left: 5, right: 5 }).borderRadius(6).backgroundColor('#1FC2410C')
              }
            }
            Text(member.snapshot ? `已同步 ${member.snapshot.semester}` : '还没有同步课表').fontSize(12).fontColor($r('app.color.app_text_secondary'))
          }.layoutWeight(1).alignItems(HorizontalAlign.Start)
          if (this.model.status.isOwner && member.id !== this.model.status.me?.id) {
            Text('移出').fontSize(13).fontColor('#B42318').padding(6)
              .onClick(() => this.confirmRemove(member))
          }
        }.width('100%').padding({ left: 12, right: 8, top: 8, bottom: 8 })
          .border({ width: { top: index > 0 ? 0.5 : 0 }, color: $r('app.color.app_divider') })
      }, (member: DormMemberInfo) => `${member.id}:${member.color}:${member.snapshot?.syncedAt ?? ''}`)
    }.width('100%').borderRadius(16).backgroundColor($r('app.color.app_control'))
    Column({ space: 8 }) {
      Text('我的颜色').fontSize(13).fontColor($r('app.color.app_text_secondary')).width('100%')
      Row() {
        ForEach(DORM_COLORS, (color: string) => {
          Column().width(26).height(26).borderRadius(13).backgroundColor(dormTone(color, this.dark)[0])
            .border({ width: color === this.model.status.me?.color ? 2.5 : 1,
              color: color === this.model.status.me?.color ? $r('app.color.app_text_primary') : dormTone(color, this.dark)[1], radius: 13 })
            .onClick(() => { if (color !== this.model.status.me?.color) void this.model.change({ action: 'settings', body: { myColor: color } }, '颜色已保存'); })
        }, (color: string) => color)
      }.width('100%').justifyContent(FlexAlign.SpaceBetween)
    }.width('100%').padding(14).borderRadius(16).backgroundColor($r('app.color.app_control'))
    Column({ space: 10 }) {
      if (this.inviteCode()) {
        Text('宿舍码').fontSize(13).fontColor($r('app.color.app_text_secondary')).width('100%')
        Text(this.inviteCode()).fontSize(28).fontWeight(FontWeight.Bold).fontFamily('monospace').letterSpacing(6)
          .fontColor($r('app.color.app_text_primary')).width('100%').textAlign(TextAlign.Center).copyOption(CopyOptions.LocalDevice)
        Text('24 小时内有效，室友在「课表 → 更多 → 宿舍课表」里输入就能加入。').fontSize(12)
          .fontColor($r('app.color.app_text_secondary')).width('100%').textAlign(TextAlign.Center)
      }
      if (this.model.status.isOwner) {
        Button(this.inviteCode() ? '换一个宿舍码' : '生成宿舍码').type(ButtonType.Capsule).height(40).width('100%').fontSize(14)
          .fontColor($r('app.color.app_accent')).backgroundColor($r('app.color.app_surface')).enabled(!this.model.busy)
          .onClick(() => { void this.model.change({ action: 'invite' }, '宿舍码已更新'); })
      }
      Button('立即同步我的课表').type(ButtonType.Capsule).height(40).width('100%').fontSize(14)
        .fontColor($r('app.color.app_on_accent')).backgroundColor($r('app.color.app_accent')).enabled(!this.model.busy)
        .id('dorm-sync')
        .onClick(() => {
          void this.model.sync(this.publishBody, true).then((done: boolean) => {
            if (done) { this.model.notice = '已同步'; void this.model.load(true); }
          });
        })
    }.width('100%').padding(14).borderRadius(16).backgroundColor($r('app.color.app_control'))
    Text('退出宿舍').fontSize(14).fontWeight(600).fontColor('#B42318').padding(8)
      .onClick(() => this.confirmLeave())
  }

  // ---- Not in a dorm ----

  @Builder
  private joinPage() {
    Column({ space: 16 }) {
      Text('和室友互相看课表：一周谁有空、哪段时间大家都空着、谁哪天要早起。课表只在宿舍成员之间可见，随时可以退出。')
        .fontSize(13).fontColor($r('app.color.app_text_secondary')).width('100%')
      Column({ space: 10 }) {
        Text('用宿舍码加入').fontSize(14).fontWeight(600).fontColor($r('app.color.app_text_primary')).width('100%')
        Row({ space: 8 }) {
          TextInput({ text: this.model.codeInput, placeholder: '6 位宿舍码' }).height(44).layoutWeight(1).maxLength(40)
            .id('dorm-code').onChange((value: string) => this.model.codeInput = value)
          Button('加入').type(ButtonType.Normal).height(44).width(72).borderRadius(12)
            .fontColor($r('app.color.app_on_accent')).backgroundColor($r('app.color.app_accent'))
            .enabled(!this.model.busy && !!dormCodeFrom(this.model.codeInput))
            .onClick(() => { void this.model.change({ action: 'join', code: dormCodeFrom(this.model.codeInput) }, '已加入宿舍'); })
        }.width('100%')
      }.width('100%').padding(14).borderRadius(16).backgroundColor($r('app.color.app_control'))
      Column({ space: 10 }) {
        Text('还没有宿舍').fontSize(14).fontWeight(600).fontColor($r('app.color.app_text_primary')).width('100%')
        Button('我建宿舍').type(ButtonType.Capsule).height(42).width('100%').fontSize(15)
          .fontColor($r('app.color.app_on_accent')).backgroundColor($r('app.color.app_accent')).enabled(!this.model.busy)
          .id('dorm-create').onClick(() => { void this.model.change({ action: 'invite' }, '宿舍已建好，把宿舍码发给室友'); })
      }.width('100%').padding(14).borderRadius(16).backgroundColor($r('app.color.app_control'))
    }.width('100%').padding({ left: 16, right: 16, top: 16, bottom: 40 })
  }

  private inviteCode(): string {
    const invite = this.model.status.invite;
    return invite?.code && !invite.expired ? invite.code : '';
  }

  private selectedCell(): DormCellInfo | undefined {
    const parts = this.model.cell.split(':');
    if (parts.length !== 2 || !this.model.view) return undefined;
    return this.model.view.week.rows[Number(parts[0])]?.cells[Number(parts[1])];
  }

  private cellFill(cell: DormCellInfo): string {
    if (cell.level === 'all') return this.dark ? '#0F766E' : '#5EEAD4';
    if (cell.level === 'some') return this.dark ? `rgba(20,184,166,${0.18 + cell.ratio * 0.4})` : `rgba(20,184,166,${0.12 + cell.ratio * 0.35})`;
    if (cell.level === 'none') return this.dark ? '#2A2F35' : '#ECEFF1';
    return '#00000000';
  }

  private confirmRemove(member: DormMemberInfo): void {
    AlertDialog.show({ title: '移出宿舍', message: `确定把 ${member.nickname} 移出宿舍吗？TA 的课表快照会一起删除。`,
      primaryButton: { value: '取消', action: () => undefined },
      secondaryButton: { value: '移出', fontColor: '#B42318', action: () => { void this.model.change({ action: 'remove', userId: member.id }, '已移出'); } } });
  }

  private confirmLeave(): void {
    AlertDialog.show({ title: '退出宿舍', message: '退出后你的课表快照会删除；舍长退出时会转给最早加入的室友。',
      primaryButton: { value: '再想想', action: () => undefined },
      secondaryButton: { value: '退出', fontColor: '#B42318', action: () => { void this.model.change({ action: 'leave' }, '已退出宿舍'); } } });
  }
}
