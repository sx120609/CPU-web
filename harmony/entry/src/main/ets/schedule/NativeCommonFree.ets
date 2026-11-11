import { nativeScheduleStoreOf, NativeScheduleStore } from './NativeScheduleStore';
import { NativeScheduleCoupleModel } from './NativeScheduleCouple';
import { NativeScheduleSharingModel } from './NativeScheduleSharing';
import { SharedSchedule, sharedScheduleName, sharedScheduleSnapshot } from './ScheduleSharing';
import { CommonFreeDay, commonFreeBusy, commonFreeClock, commonFreeDays, commonFreeDuration, commonFreeSpan,
  commonFreeTermDates, CommonFreeWindow } from './ScheduleCommonFree';
import { occurrenceDateText } from './ScheduleOccurrences';
import { scheduleTodayDate } from './ScheduleStyle';

// 找共同空闲 (iOS NativeCommonFreeView): pick whose timetables to compare, the dates, the shortest
// window worth having and the part of the day; the free times come out by date, each day drawn as
// a bar of classes and gaps. A window can become a 日程.

const DURATIONS: number[] = [30, 60, 120, 180];
const SPANS: string[] = ['day', 'evening', 'all'];
const SPAN_TITLES: string[] = ['白天', '晚上', '全天'];

function shiftDate(date: string, days: number): string {
  return new Date(Date.UTC(Number(date.substring(0, 4)), Number(date.substring(5, 7)) - 1, Number(date.substring(8, 10)) + days))
    .toISOString().substring(0, 10);
}

@Component
export struct NativeCommonFree {
  @ObjectLink store: NativeScheduleStore;
  @ObjectLink couple: NativeScheduleCoupleModel;
  @ObjectLink sharing: NativeScheduleSharingModel;
  onAgenda?: (date: string, start: string) => void;
  onDone: () => void = () => undefined;
  @State private withPartner: boolean = true;
  @State private chosen: string[] = [];
  @State private from: string = '';
  @State private to: string = '';
  @State private minimum: number = 60;
  @State private span: string = 'all';
  @State private days: CommonFreeDay[] = [];
  private mine?: NativeScheduleStore;

  aboutToAppear(): void {
    const today = scheduleTodayDate(Date.now());
    this.from = today;
    this.to = shiftDate(today, 6);
    const snapshot = this.store.completeSnapshot();
    this.mine = snapshot ? nativeScheduleStoreOf(snapshot) : this.store;
    if (!this.couple.partnerStore()?.result && this.sharing.library.schedules.length) {
      this.chosen = [this.couple.overlayCode || this.sharing.library.schedules[0].meta.code];
    }
    this.compute();
  }

  build() {
    Column() {
    // The title stays put: the sheet's close button floats over it, not over the list scrolling by.
    Row() {
      Text('找共同空闲').fontSize(22).fontWeight(FontWeight.Bold).fontColor($r('app.color.app_text_primary')).layoutWeight(1)
    }.width('100%').padding({ left: 16, right: 64, top: 24, bottom: 6 })
    Scroll() {
      Column({ space: 18 }) {
        this.title('和谁比', this.otherCount() === 0 ? '只看自己的空闲' : `共 ${this.otherCount() + 1} 人`)
        Scroll() {
          Row({ space: 10 }) {
            this.person('我', '我的课表', '#0F766E', true, 'free-me', () => undefined)
            if (this.couple.bound()) {
              this.person(this.couple.status.partner.nickname || 'TA', this.couple.partnerStore()?.result ? '情侣课表' : '还没同步',
                '#E2568A', this.withPartner && !!this.couple.partnerStore()?.result, 'free-partner',
                () => { this.withPartner = !this.withPartner; this.compute(); })
            }
            ForEach(this.sharing.library.schedules, (schedule: SharedSchedule) => {
              this.person(sharedScheduleName(schedule), schedule.calendar.school || '分享课表', '#0D9488',
                this.chosen.includes(schedule.meta.code), 'free-share-' + schedule.meta.code, () => this.toggle(schedule.meta.code))
            }, (schedule: SharedSchedule) => schedule.meta.code)
          }.padding({ top: 2, bottom: 2 })
        }.scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off).width('100%')
        if (!this.couple.bound() && !this.sharing.library.schedules.length) {
          Text('保存同学的分享码或绑定情侣课表后，就能在这里一起比较。').fontSize(13).fontColor($r('app.color.app_text_secondary')).width('100%')
        }
        this.title('条件', '')
        Column() {
          this.dateRow('开始日期', this.from, true)
          Divider().color($r('app.color.app_divider')).margin({ left: 14 })
          this.dateRow('结束日期', this.to, false)
          Divider().color($r('app.color.app_divider')).margin({ left: 14 })
          Column({ space: 8 }) {
            Text('至少空出').fontSize(13).fontColor($r('app.color.app_text_secondary')).width('100%')
            this.segments(DURATIONS.map((value: number) => value < 60 ? `${value} 分钟` : `${value / 60} 小时`),
              DURATIONS.indexOf(this.minimum), 'free-minimum', (index: number) => { this.minimum = DURATIONS[index]; this.compute(); })
          }.padding({ left: 14, right: 14, top: 10, bottom: 10 })
          Divider().color($r('app.color.app_divider')).margin({ left: 14 })
          Column({ space: 8 }) {
            Text('时段').fontSize(13).fontColor($r('app.color.app_text_secondary')).width('100%')
            this.segments(SPAN_TITLES, SPANS.indexOf(this.span), 'free-span', (index: number) => { this.span = SPANS[index]; this.compute(); })
          }.padding({ left: 14, right: 14, top: 10, bottom: 10 })
        }.width('100%').borderRadius(16).backgroundColor($r('app.color.app_control'))
        this.title('空闲时段', this.total() ? `${this.total()} 段` : '')
        if (!this.days.length) {
          this.empty('所选日期不在大家都有课表的学期内')
        } else if (!this.total()) {
          this.empty('这些天没有满足条件的共同空闲，试试缩短时长或换个时段')
        } else {
          ForEach(this.days.filter((day: CommonFreeDay) => day.windows.length > 0), (day: CommonFreeDay) => {
            this.dayCard(day)
          }, (day: CommonFreeDay) => day.date + ':' + day.windows.length + ':' + this.minimum + this.span)
        }
        Text('比较的是各自的课表（含停课、调课和调休），不包括日程等个人安排。').fontSize(12)
          .fontColor($r('app.color.app_text_tertiary')).width('100%')
      }.width('100%').padding({ left: 16, right: 16, top: 12, bottom: 40 })
    }.width('100%').layoutWeight(1).scrollBar(BarState.Off).align(Alignment.Top)
    }.width('100%').height('100%').backgroundColor($r('app.color.app_surface'))
  }

  @Builder
  private title(text: string, trailing: string) {
    Row() {
      Text(text).fontSize(13).fontWeight(600).fontColor($r('app.color.app_text_secondary')).layoutWeight(1)
      if (trailing) Text(trailing).fontSize(13).fontColor($r('app.color.app_text_secondary'))
    }.width('100%').padding({ left: 4, right: 4 }).margin({ bottom: -8 })
  }

  @Builder
  private person(name: string, detail: string, tint: string, selected: boolean, id: string, action: () => void) {
    Column({ space: 4 }) {
      Text(name.substring(0, 1)).fontSize(16).fontWeight(600).fontColor(selected ? '#FFFFFF' : tint)
        .width(40).height(40).borderRadius(20).textAlign(TextAlign.Center)
        .backgroundColor(selected ? tint : tint + '22')
      Text(name).fontSize(13).fontWeight(600).fontColor($r('app.color.app_text_primary')).maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
      Text(detail).fontSize(10).fontColor($r('app.color.app_text_secondary')).maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
    }.width(76).padding({ top: 10, bottom: 10 }).borderRadius(14)
      .backgroundColor($r('app.color.app_control'))
      .border({ width: selected ? 1.5 : 0, color: tint, radius: 14 })
      .id(id).accessibilityGroup(true).accessibilitySelected(selected).accessibilityText(name + '，' + detail)
      .onClick(action)
  }

  @Builder
  private dateRow(label: string, value: string, start: boolean) {
    Row() {
      Text(label).fontSize(15).fontColor($r('app.color.app_text_primary')).layoutWeight(1)
      Text(occurrenceDateText(value)).fontSize(15).fontWeight(600).fontColor($r('app.color.app_accent'))
    }.width('100%').padding({ left: 14, right: 14, top: 12, bottom: 12 }).id(start ? 'free-from' : 'free-to')
      .onClick(() => this.pickDate(start))
  }

  @Builder
  private segments(titles: string[], selected: number, id: string, pick: (index: number) => void) {
    Row({ space: 2 }) {
      ForEach(titles, (title: string, index: number) => {
        Text(title).fontSize(13).fontWeight(index === selected ? 600 : 400).layoutWeight(1).height(30).textAlign(TextAlign.Center)
          .borderRadius(8).fontColor(index === selected ? $r('app.color.app_text_primary') : $r('app.color.app_text_secondary'))
          .backgroundColor(index === selected ? $r('app.color.app_surface') : Color.Transparent)
          .id(id + '-' + index).onClick(() => pick(index))
      }, (title: string) => title)
    }.width('100%').padding(2).borderRadius(10).backgroundColor($r('app.color.app_divider'))
  }

  @Builder
  private dayCard(day: CommonFreeDay) {
    Column({ space: 12 }) {
      Row({ space: 8 }) {
        Text(occurrenceDateText(day.date)).fontSize(16).fontWeight(600).fontColor($r('app.color.app_text_primary'))
        if (this.relative(day.date)) {
          Text(this.relative(day.date)).fontSize(11).fontWeight(600).fontColor($r('app.color.app_accent')).padding({ left: 7, right: 7, top: 2, bottom: 2 })
            .borderRadius(9).backgroundColor($r('app.color.app_accent_surface'))
        }
        Blank()
        Text(`${day.windows.length} 段`).fontSize(12).fontColor($r('app.color.app_text_secondary'))
      }.width('100%')
      this.bar(day)
      ForEach(day.windows, (window: CommonFreeWindow) => {
        Row({ space: 12 }) {
          Column().width(4).height(34).borderRadius(2).linearGradient({ angle: 180, colors: [['#14B8A6', 0], ['#0F766E', 1]] })
          Column({ space: 2 }) {
            Text(`${commonFreeClock(window.start)} – ${commonFreeClock(window.end)}`).fontSize(16).fontWeight(600)
              .fontColor($r('app.color.app_text_primary'))
            Text(commonFreeDuration(window.end - window.start)).fontSize(12).fontColor($r('app.color.app_text_secondary'))
          }.layoutWeight(1).alignItems(HorizontalAlign.Start)
          if (this.onAgenda) {
            Button('建日程').type(ButtonType.Capsule).height(30).fontSize(13).fontColor($r('app.color.app_accent'))
              .backgroundColor($r('app.color.app_accent_surface'))
              .onClick(() => {
                const date = window.date;
                const start = commonFreeClock(window.start);
                this.onDone();
                setTimeout(() => this.onAgenda?.(date, start), 400);
              })
          }
        }.width('100%')
      }, (window: CommonFreeWindow) => window.date + '@' + window.start)
    }.width('100%').padding(14).borderRadius(16).backgroundColor($r('app.color.app_control'))
  }

  // The day from the start to the end of the chosen span: classes grey, free windows in the brand colour.
  @Builder
  private bar(day: CommonFreeDay) {
    Stack({ alignContent: Alignment.TopStart }) {
      Column().width('100%').height(10).borderRadius(5).backgroundColor($r('app.color.app_divider'))
      ForEach(day.windows, (window: CommonFreeWindow) => {
        Column().width(`${this.share(window.end - window.start)}%`).height(10).borderRadius(5).backgroundColor('#14B8A6')
          .position({ x: `${this.share(window.start - commonFreeSpan(this.span)[0])}%`, y: 0 })
      }, (window: CommonFreeWindow) => window.date + '@' + window.start)
    }.width('100%').height(10).accessibilityLevel('no')
  }

  private share(minutes: number): number {
    const span = commonFreeSpan(this.span);
    return Math.max(0, Math.min(100, minutes * 100 / (span[1] - span[0])));
  }

  @Builder
  private empty(text: string) {
    Column({ space: 10 }) {
      SymbolGlyph($r('sys.symbol.calendar')).fontSize(30).fontColor([$r('app.color.app_text_tertiary')])
      Text(text).fontSize(14).fontColor($r('app.color.app_text_secondary')).textAlign(TextAlign.Center)
    }.width('100%').padding({ top: 28, bottom: 28, left: 20, right: 20 }).borderRadius(16).backgroundColor($r('app.color.app_control'))
  }

  private toggle(code: string): void {
    this.chosen = this.chosen.includes(code) ? this.chosen.filter((item: string) => item !== code) : this.chosen.concat([code]);
    this.compute();
  }

  private otherCount(): number {
    return (this.withPartner && this.couple.partnerStore()?.result ? 1 : 0) + this.chosen.length;
  }

  private total(): number {
    let total = 0;
    this.days.forEach((day: CommonFreeDay) => { total += day.windows.length; });
    return total;
  }

  private relative(date: string): string {
    const today = scheduleTodayDate(Date.now());
    return date === today ? '今天' : date === shiftDate(today, 1) ? '明天' : '';
  }

  private participants(): NativeScheduleStore[] {
    const list: NativeScheduleStore[] = [];
    if (this.mine) list.push(this.mine);
    const partner = this.couple.partnerStore();
    if (this.withPartner && partner?.result) list.push(partner);
    this.sharing.library.schedules.forEach((schedule: SharedSchedule) => {
      if (this.chosen.includes(schedule.meta.code)) list.push(nativeScheduleStoreOf(sharedScheduleSnapshot(schedule, Date.now())));
    });
    return list;
  }

  private compute(): void {
    const stores = this.participants();
    const span = commonFreeSpan(this.span);
    const now = new Date(Date.now() + 8 * 3600000);
    this.days = commonFreeDays(stores.map((store: NativeScheduleStore) => commonFreeTermDates(store.calendar?.weeks ?? [])),
      (date: string) => {
        let ranges: number[][] = [];
        stores.forEach((store: NativeScheduleStore) => { ranges = ranges.concat(commonFreeBusy(store, date)); });
        return ranges;
      }, this.from, this.to, span[0], span[1], this.minimum, scheduleTodayDate(Date.now()),
      now.getUTCHours() * 60 + now.getUTCMinutes());
  }

  private pickDate(start: boolean): void {
    const value = start ? this.from : this.to;
    DatePickerDialog.show({ start: new Date(2020, 0, 1), end: new Date(2035, 11, 31), selected: new Date(`${value}T12:00:00`),
      onDateAccept: (picked: Date) => {
        const date = `${picked.getFullYear()}-${String(picked.getMonth() + 1).padStart(2, '0')}-${String(picked.getDate()).padStart(2, '0')}`;
        if (start) { this.from = date; if (this.to < date) this.to = date; }
        else this.to = date < this.from ? this.from : date;
        this.compute();
      } });
  }
}
