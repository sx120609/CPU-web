import { NativeCourseBlock, NativeScheduleStore } from './NativeScheduleStore';
import { occurrenceDateText } from './ScheduleOccurrences';
import { scheduleCleanLocation, scheduleCourseAccent, scheduleStyleCourseColor } from './ScheduleStyle';

// 分享这一天 (iOS ScheduleDayShareCard): a tall card with the day's classes in time order, each in its
// course colour, for a chat or a status update. Rendered off screen with componentSnapshot.

export interface DayShareItem {
  id: string;
  start: string;
  end: string;
  name: string;
  detail: string;
  tint: string;
  cancelled: boolean;
  moved: boolean;
}

export interface DayShareCardData {
  brand: string;
  // "11月12日 周四".
  title: string;
  // "2026-2027-1 · 第 10 周".
  subtitle: string;
  items: DayShareItem[];
  // Shown when there are no classes.
  emptyText: string;
}

/** The card for `date` from the timetable as it stands (cancelled meetings kept, struck through). */
export function dayShareCardData(store: NativeScheduleStore, date: string, brand: string): DayShareCardData {
  const slot = store.dateSlot(date);
  const adjustment = store.adjustmentOnDate(date);
  let blocks: NativeCourseBlock[] = store.blocksOnDate(date);
  if (slot) {
    const source = adjustment?.kind === 'swap' ? (store.dateSlot(adjustment.source ?? '')?.day ?? slot.day) : slot.day;
    blocks = blocks.concat(store.cancelledOnDate(date, slot.day, source));
  }
  blocks.sort((left: NativeCourseBlock, right: NativeCourseBlock) => left.startSlot - right.startSlot);
  const items: DayShareItem[] = blocks.map((block: NativeCourseBlock, index: number): DayShareItem => ({
    id: `${index}-${block.course.name}`, start: store.blockStart(block), end: store.blockEnd(block), name: block.course.name,
    detail: [scheduleCleanLocation(block.course.location), (block.course.teacher ?? '').trim()].filter((value: string) => !!value).join(' · '),
    tint: scheduleCourseAccent(scheduleStyleCourseColor(block.course.name, store.palette), false),
    cancelled: !!block.cancelled, moved: !!block.course.occurrenceFrom }));
  const parts: string[] = [];
  if (store.calendar?.school) parts.push(store.calendar.school);
  if (store.selectedSemester) parts.push(store.selectedSemester);
  if (slot) parts.push(`第 ${slot.week} 周`);
  return { brand, title: occurrenceDateText(date), subtitle: parts.join(' · '), items,
    emptyText: adjustment?.kind === 'off' ? (adjustment.note || '放假') : '这天没有课' };
}

/** "3 节课" and "08:00–11:35" for the card's header. */
export function dayShareSummary(data: DayShareCardData): string[] {
  const held = data.items.filter((item: DayShareItem) => !item.cancelled);
  if (!held.length) return ['无课'];
  return [`${held.length} 节课`, `${held[0].start}–${held[held.length - 1].end}`];
}

@Builder
export function dayShareCard(data: DayShareCardData) {
  Column() {
    Stack({ alignContent: Alignment.TopStart }) {
      Circle().width(220).height(220).fill('#1FFFFFFF').position({ x: 360, y: -90 })
      Circle().width(140).height(140).fill('#14FFFFFF').position({ x: 420, y: 120 })
      Column({ space: 8 }) {
        Text(data.brand).fontSize(18).fontWeight(FontWeight.Bold).fontColor('#E6FFFFFF')
        Text(data.title).fontSize(40).fontWeight(FontWeight.Bolder).fontColor('#FFFFFF')
        Text(data.subtitle).fontSize(15).fontWeight(FontWeight.Medium).fontColor('#D9FFFFFF')
        Row({ space: 14 }) {
          ForEach(dayShareSummary(data), (text: string) => {
            Text(text).fontSize(14).fontWeight(600).fontColor('#FFFFFF')
          }, (text: string) => text)
        }.margin({ top: 6 })
      }.alignItems(HorizontalAlign.Start).padding(28)
    }.width('100%').clip(true)
      .linearGradient({ angle: 135, colors: [['#0F766E', 0], ['#14B8A6', 0.7], ['#2DD4BF', 1]] })
    Column({ space: 14 }) {
      if (!data.items.length) {
        Column({ space: 12 }) {
          Text('☀').fontSize(54).fontColor('#F59E0B')
          Text(data.emptyText).fontSize(22).fontWeight(FontWeight.Bold).fontColor('#1C1C1E')
          Text('好好休息，或者去做点喜欢的事。').fontSize(15).fontColor('#6E6E73')
        }.width('100%').padding({ top: 60, bottom: 60 })
      }
      ForEach(data.items, (item: DayShareItem) => {
        Row({ space: 16 }) {
          Column({ space: 4 }) {
            Text(item.start).fontSize(20).fontWeight(FontWeight.Bold).fontColor('#1C1C1E')
            Text(item.end).fontSize(14).fontWeight(FontWeight.Medium).fontColor('#6E6E73')
          }.width(66).alignItems(HorizontalAlign.End)
          Column().width(6).height(56).borderRadius(3).backgroundColor(item.cancelled ? '#C7C7CC' : item.tint)
          Column({ space: 6 }) {
            Row({ space: 8 }) {
              Text(item.name).fontSize(21).fontWeight(FontWeight.Bold).fontColor(item.cancelled ? '#8E8E93' : '#1C1C1E')
                .decoration({ type: item.cancelled ? TextDecorationType.LineThrough : TextDecorationType.None })
                .maxLines(2).flexShrink(1)
              if (item.cancelled) {
                Text('停课').fontSize(12).fontWeight(600).fontColor('#8E8E93').padding({ left: 6, right: 6, top: 2, bottom: 2 })
                  .borderRadius(6).backgroundColor('#1F8E8E93')
              }
              if (item.moved) {
                Text('调课').fontSize(12).fontWeight(600).fontColor('#C2410C').padding({ left: 6, right: 6, top: 2, bottom: 2 })
                  .borderRadius(6).backgroundColor('#1FC2410C')
              }
            }
            if (item.detail) Text(item.detail).fontSize(15).fontColor('#6E6E73')
          }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        }.width('100%').alignItems(VerticalAlign.Top)
      }, (item: DayShareItem) => item.id)
    }.width('100%').padding(22)
    Row() {
      Blank()
      Text(`由 ${data.brand} 生成`).fontSize(12).fontWeight(FontWeight.Medium).fontColor('#AEAEB2')
    }.width('100%').padding({ left: 24, right: 24, bottom: 20 })
  }.width(540).backgroundColor('#FFFFFF')
}
