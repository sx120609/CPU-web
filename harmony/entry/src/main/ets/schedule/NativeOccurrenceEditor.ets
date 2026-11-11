import { NativeCourseBlock, NativeOccurrenceChange, NativeScheduleStore } from './NativeScheduleStore';
import { occurrenceChangesNothing, occurrenceClashes, occurrenceDateText, occurrenceMove } from './ScheduleOccurrences';
import { scheduleCleanLocation } from './ScheduleStyle';
import { scheduleSecondaryText, scheduleSurface, scheduleText } from './ScheduleLayout';

// 调整这一次 (iOS ScheduleOccurrenceEditor): one meeting of a course to another date in the term,
// other periods (tap the first, then the last), another room and a note. A clash with another course
// is pointed out without stopping the save.

@Observed
export class NativeOccurrenceEditorModel {
  visible: boolean = false;
  busy: boolean = false;
  error: string = '';
  name: string = '';
  // The keys the change is saved under and the date the meeting was planned for.
  keys: string[] = [];
  date: string = '';
  target: string = '';
  startSlot: number = 1;
  endSlot: number = 1;
  // The next tap picks the last period (after a first one was picked).
  pickingEnd: boolean = false;
  location: string = '';
  note: string = '';
  originalStart: number = 1;
  originalEnd: number = 1;
  originalLocation: string = '';
  private store?: NativeScheduleStore;

  /** Opens the form for `block`, met on `date`; `existing` is an earlier change of this meeting. */
  open(store: NativeScheduleStore, block: NativeCourseBlock, keys: string[], date: string,
    existing?: NativeOccurrenceChange, original: number[] = []): void {
    this.store = store;
    this.name = block.course.name;
    this.keys = keys;
    this.date = date;
    this.originalStart = original.length === 2 ? original[0] : block.startSlot;
    this.originalEnd = original.length === 2 ? original[1] : block.endSlot;
    this.originalLocation = existing?.location ? '' : (block.course.location ?? '');
    this.target = existing?.toDate ?? date;
    this.startSlot = existing?.startSlot ?? block.startSlot;
    this.endSlot = existing?.endSlot ?? block.endSlot;
    this.location = existing?.location ?? (block.course.location ?? '');
    this.note = existing?.note ?? '';
    this.pickingEnd = false;
    this.error = '';
    this.busy = false;
    this.visible = true;
  }

  close(): void {
    if (this.busy) return;
    this.visible = false;
  }

  slots(): number[] { return this.store?.slots() ?? []; }

  /** Tap the first period, then the last; a tap before the first starts over from there. */
  pick(slot: number): void {
    if (!this.pickingEnd || slot < this.startSlot) {
      this.startSlot = slot;
      this.endSlot = slot;
      this.pickingEnd = true;
    } else {
      this.endSlot = slot;
      this.pickingEnd = false;
    }
  }

  /** Why the chosen date cannot take the meeting; empty when it can. */
  dateProblem(): string {
    const store = this.store;
    if (!store) return '';
    if (!store.dateSlot(this.target)) return '只能调到本学期的教学周内';
    const adjustment = store.adjustmentOnDate(this.target);
    if (adjustment?.kind === 'off') return '这天放假，换一天吧';
    if (adjustment?.kind === 'swap') return '这天是调休补班，换一天吧';
    return '';
  }

  clashes(): string[] {
    const store = this.store;
    if (!store) return [];
    return occurrenceClashes(store.blocksOnDate(this.target), this.keys, this.startSlot, this.endSlot);
  }

  slotTime(): string {
    const store = this.store;
    if (!store) return '';
    const start = store.slotStart(Math.min(this.startSlot, this.endSlot));
    const end = store.slotEnd(Math.max(this.startSlot, this.endSlot));
    return start && end ? `${start}–${end}` : '';
  }

  firstTerm(): Date { return this.termDate(true); }
  lastTerm(): Date { return this.termDate(false); }

  private termDate(first: boolean): Date {
    const weeks = this.store?.calendar?.weeks ?? [];
    const days = first ? (weeks[0]?.days ?? []) : (weeks[weeks.length - 1]?.days ?? []);
    const value = first ? days[0] : days[days.length - 1];
    return value ? new Date(`${value}T12:00:00`) : new Date();
  }

  async save(): Promise<void> {
    const store = this.store;
    if (!store || this.busy) return;
    const problem = this.dateProblem();
    if (problem) { this.error = problem; return; }
    const sample = occurrenceMove('', this.date, this.target, this.startSlot, this.endSlot, this.originalStart, this.originalEnd,
      this.location, this.originalLocation, this.note);
    if (occurrenceChangesNothing(sample)) { this.error = '还没有改动：换个日期、节次或教室再保存'; return; }
    this.busy = true;
    this.error = '';
    const message = await store.changeOccurrence(this.keys, this.date, sample);
    this.busy = false;
    if (message) this.error = message;
    else this.visible = false;
  }
}

@Component
export struct NativeOccurrenceEditor {
  @ObjectLink model: NativeOccurrenceEditorModel;
  @Prop dark: boolean = false;

  build() {
    Column({ space: 14 }) {
      Column({ space: 4 }) {
        Text('调整这一次').fontSize(20).fontWeight(FontWeight.Bold).fontColor(scheduleText(this.dark)).width('100%')
        Text(`「${this.model.name}」原定 ${occurrenceDateText(this.model.date)} 第 ${this.model.originalStart}–${this.model.originalEnd} 节，只改这一次。`)
          .fontSize(13).fontColor(scheduleSecondaryText(this.dark)).width('100%')
      }.padding({ right: 40 })
      Row({ space: 12 }) {
        Text('日期').fontSize(15).fontColor(scheduleText(this.dark)).width(48)
        Text(occurrenceDateText(this.model.target)).fontSize(15).fontWeight(600).fontColor('#0F766E').layoutWeight(1)
        Button('换一天').type(ButtonType.Capsule).height(30).fontSize(13).fontColor('#0F766E').backgroundColor('#140F766E')
          .id('occurrence-date')
          .onClick(() => this.pickDate())
      }.width('100%')
      if (this.model.dateProblem()) {
        Text(this.model.dateProblem()).fontSize(12).fontColor('#C2410C').width('100%')
      }
      Column({ space: 8 }) {
        Row() {
          Text('节次').fontSize(15).fontColor(scheduleText(this.dark)).layoutWeight(1)
          Text(`第 ${Math.min(this.model.startSlot, this.model.endSlot)}–${Math.max(this.model.startSlot, this.model.endSlot)} 节 ${this.model.slotTime()}`)
            .fontSize(13).fontColor(scheduleSecondaryText(this.dark))
        }.width('100%')
        Text(this.model.pickingEnd ? '再点最后一节' : '先点第一节，再点最后一节').fontSize(12)
          .fontColor(scheduleSecondaryText(this.dark)).width('100%')
        Flex({ wrap: FlexWrap.Wrap }) {
          ForEach(this.model.slots(), (slot: number) => {
            Text(String(slot)).fontSize(14).fontWeight(600).width(40).height(36).textAlign(TextAlign.Center).borderRadius(10)
              .margin({ right: 6, bottom: 6 })
              .fontColor(this.chosen(slot) ? '#FFFFFF' : scheduleText(this.dark))
              .backgroundColor(this.chosen(slot) ? '#0F766E' : (this.dark ? '#2A2F35' : '#EEF2F1'))
              .id('occurrence-slot-' + slot)
              .accessibilityText('第' + slot + '节').accessibilitySelected(this.chosen(slot))
              .onClick(() => this.model.pick(slot))
          }, (slot: number) => String(slot))
        }.width('100%')
      }
      if (this.model.clashes().length) {
        Text(`和「${this.model.clashes().join('」「')}」时间重叠，仍可保存。`).fontSize(12).fontColor('#C2410C').width('100%')
      }
      Column({ space: 6 }) {
        Text('教室').fontSize(13).fontColor(scheduleSecondaryText(this.dark)).width('100%')
        TextInput({ text: this.model.location, placeholder: scheduleCleanLocation(this.model.originalLocation) || '不变' })
          .maxLength(60).height(42).id('occurrence-location')
          .onChange((value: string) => this.model.location = value)
        Text('备注').fontSize(13).fontColor(scheduleSecondaryText(this.dark)).width('100%')
        TextInput({ text: this.model.note, placeholder: '例如：改到线上' })
          .maxLength(80).height(42).id('occurrence-note')
          .onChange((value: string) => this.model.note = value)
      }
      if (this.model.error) {
        Text(this.model.error).fontSize(13).fontColor('#DC2626').width('100%')
      }
      Button(this.model.busy ? '正在保存…' : '保存这一次').width('100%').height(46).fontSize(15)
        .fontColor('#FFFFFF').backgroundColor('#0F766E').enabled(!this.model.busy)
        .id('occurrence-save')
        .onClick(() => { void this.model.save(); })
    }.width('100%').padding({ left: 20, right: 20, top: 24, bottom: 28 }).backgroundColor(scheduleSurface(this.dark))
  }

  private chosen(slot: number): boolean {
    return slot >= Math.min(this.model.startSlot, this.model.endSlot) && slot <= Math.max(this.model.startSlot, this.model.endSlot);
  }

  private pickDate(): void {
    const current = new Date(`${this.model.target}T12:00:00`);
    DatePickerDialog.show({
      start: this.model.firstTerm(), end: this.model.lastTerm(), selected: current, lunar: false,
      onDateAccept: (value: Date) => {
        this.model.target = `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
        this.model.error = '';
      }
    });
  }
}
