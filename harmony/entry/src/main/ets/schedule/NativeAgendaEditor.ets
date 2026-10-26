import { LengthMetrics } from '@kit.ArkUI';
import { NativeAgendaItem, NativeScheduleStore } from './NativeScheduleStore';
import { agendaDateOf, agendaDayNumber, agendaOn, agendaWeekday, NativeAgendaDraft, NativeAgendaModel,
  NativeAgendaOccurrence } from './NativeAgenda';

// 日程 inside the timetable: the editor for one item and 日程与待办 (a line to jot one down, the open
// to-dos, the next seven days and 微信和 QQ 也提醒). Both are one panel over the timetable, so a 日程
// is never more than a tap away from the grid it is drawn on. Every change goes through the page
// (NativeAgendaModel), the same records as the Web timetable, Android, iOS and 药大拾间 NEXT.

interface AgendaChoice {
  value: number;
  label: string;
}

interface AgendaRepeatChoice {
  value: string;
  label: string;
}

interface AgendaDay {
  date: string;
  title: string;
  entries: NativeAgendaOccurrence[];
}

const REMIND_CHOICES: AgendaChoice[] = [
  { value: -1, label: '不提醒' }, { value: 0, label: '准时' }, { value: 5, label: '5 分钟前' }, { value: 15, label: '15 分钟前' },
  { value: 30, label: '30 分钟前' }, { value: 60, label: '1 小时前' }, { value: 1440, label: '1 天前' }
];
const REPEAT_CHOICES: AgendaRepeatChoice[] = [
  { value: 'none', label: '不重复' }, { value: 'daily', label: '每天' }, { value: 'weekdays', label: '工作日' },
  { value: 'weekly', label: '每周' }, { value: 'monthly', label: '每月' }
];
const WEEKDAYS: string[] = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const CHINA_OFFSET_MS = 8 * 3600000;
const DAY_MS = 86400000;

/** Today in the timetable's time zone (Asia/Shanghai), YYYY-MM-DD. */
export function agendaToday(now: number = Date.now()): string {
  return agendaDateOf(Math.floor((now + CHINA_OFFSET_MS) / DAY_MS));
}

/** 今天 / 明天 / 昨天 / 10月23日 for a YYYY-MM-DD; empty for none. */
export function agendaShortDay(date: string, today: string = agendaToday()): string {
  const day = agendaDayNumber(date);
  if (day < 0) return '';
  const offset = day - agendaDayNumber(today);
  if (offset === 0) return '今天';
  if (offset === 1) return '明天';
  if (offset === -1) return '昨天';
  return `${Number(date.substring(5, 7))}月${Number(date.substring(8, 10))}日`;
}

/** What is still to do: past to-dos left unticked, then the ones without a day (Web `agendaOpen`). */
export function agendaOpenTodos(items: NativeAgendaItem[], today: string): NativeAgendaItem[] {
  const candidates = items.filter((item: NativeAgendaItem) => (!item.repeat || item.repeat === 'none') && !item.done);
  const todayNumber = agendaDayNumber(today);
  const overdue = candidates.filter((item: NativeAgendaItem) => !item.start && agendaDayNumber(item.date) >= 0
    && agendaDayNumber(item.date) < todayNumber).sort((a: NativeAgendaItem, b: NativeAgendaItem) => a.date.localeCompare(b.date));
  const undated = candidates.filter((item: NativeAgendaItem) => !item.date)
    .sort((a: NativeAgendaItem, b: NativeAgendaItem) => a.createdAt - b.createdAt);
  return overdue.concat(undated);
}

function draftSays(draft: NativeAgendaDraft): boolean {
  return !!draft.date || !!draft.start || draft.remind >= 0 || (!!draft.repeat && draft.repeat !== 'none') || !!draft.location;
}

function draftSummary(draft: NativeAgendaDraft): string {
  const parts: string[] = [draft.date ? agendaShortDay(draft.date) : '不设日期'];
  if (draft.start) parts.push(draft.end ? `${draft.start}–${draft.end}` : draft.start);
  const repeat = REPEAT_CHOICES.find((choice: AgendaRepeatChoice) => choice.value === draft.repeat);
  if (repeat && repeat.value !== 'none') parts.push(repeat.label);
  if (draft.remind >= 0) parts.push('提醒');
  if (draft.location) parts.push('@' + draft.location);
  return `会记作「${draft.title}」：${parts.join(' · ')}`;
}

@Observed
export class NativeAgendaEditorModel {
  visible: boolean = false;
  // 'list' is 日程与待办, 'edit' one item.
  mode: string = 'edit';
  // The editor was opened from the list and returns to it when done.
  fromList: boolean = false;
  busy: boolean = false;
  error: string = '';
  id: string = '';
  text: string = '';
  date: string = '';
  start: string = '';
  end: string = '';
  location: string = '';
  note: string = '';
  remind: number = -1;
  repeat: string = 'none';
  until: string = '';
  done: boolean = false;
  doneDates: string[] = [];
  createdAt: number = 0;
  // Until a field is changed by hand, a new item's fields follow what its text says.
  touched: boolean = false;
  parsedTitle: string = '';
  hint: string = '';
  quick: string = '';
  quickHint: string = '';
  message: string = '';
  private quickDraft?: NativeAgendaDraft;
  private agenda?: NativeAgendaModel;
  private baseDate: string = '';
  private baseStart: string = '';
  private timer: number = -1;
  private sequence: number = 0;

  attach(agenda: NativeAgendaModel): void {
    this.agenda = agenda;
  }

  openList(): void {
    this.mode = 'list';
    this.fromList = false;
    this.error = '';
    this.message = '';
    this.visible = true;
  }

  openItem(item: NativeAgendaItem, fromList: boolean = false): void {
    this.reset(fromList);
    this.id = item.id;
    this.text = item.title;
    this.date = item.date;
    this.start = item.start;
    this.end = item.end;
    this.location = item.location;
    this.note = item.note;
    this.remind = item.remind;
    this.repeat = item.repeat || 'none';
    this.until = item.until;
    this.done = item.done;
    this.doneDates = item.doneDates.slice();
    this.createdAt = item.createdAt;
    this.touched = true;
    this.visible = true;
  }

  /** A new item on `date` (empty for none) at `start`. */
  openNew(date: string, start: string = '', fromList: boolean = false): void {
    this.reset(fromList);
    this.baseDate = agendaDayNumber(date) >= 0 ? date : '';
    this.baseStart = this.baseDate ? start : '';
    this.date = this.baseDate;
    this.start = this.baseStart;
    this.visible = true;
  }

  close(): void {
    clearTimeout(this.timer);
    this.visible = false;
    this.busy = false;
  }

  isNew(): boolean {
    return !this.id;
  }

  setText(value: string): void {
    this.text = value;
    if (this.touched) return;
    clearTimeout(this.timer);
    const sequence = ++this.sequence;
    if (!value.trim()) {
      this.follow(undefined);
      return;
    }
    this.timer = setTimeout(() => {
      this.agenda?.parse(value, (draft?: NativeAgendaDraft) => {
        if (sequence === this.sequence && !this.touched) this.follow(draft && draftSays(draft) ? draft : undefined);
      });
    }, 250);
  }

  setDate(value: string): void {
    this.touch();
    this.date = value;
    if (!value) {
      this.start = '';
      this.end = '';
      this.remind = -1;
      this.repeat = 'none';
      this.until = '';
    } else if (this.until && this.until < value) {
      this.until = '';
    }
  }

  setTimed(on: boolean): void {
    this.touch();
    this.start = on ? (this.start || '09:00') : '';
    if (!on) this.end = '';
  }

  setStart(value: string): void {
    this.touch();
    this.start = value;
    if (this.end && this.end <= value) this.end = '';
  }

  setEnd(value: string): void {
    this.touch();
    this.end = value > this.start ? value : '';
  }

  setRemind(value: number): void {
    this.touch();
    this.remind = value;
  }

  setRepeat(value: string): void {
    this.touch();
    this.repeat = value;
    if (value === 'none') this.until = '';
  }

  setUntil(value: string): void {
    this.touch();
    this.until = value && value >= this.date ? value : '';
  }

  setLocation(value: string): void {
    this.touch();
    this.location = value;
  }

  setNote(value: string): void {
    this.touch();
    this.note = value;
  }

  save(): void {
    if (this.busy || !this.agenda) return;
    const title = (this.touched ? this.text : (this.parsedTitle || this.text)).trim();
    if (!title) {
      this.error = '先写个标题';
      return;
    }
    const item: NativeAgendaItem = {
      id: this.id, title: title, date: this.date, start: this.date ? this.start : '', end: this.start ? this.end : '',
      location: this.location.trim(), note: this.note, remind: this.date ? this.remind : -1,
      repeat: this.date ? this.repeat : 'none', until: this.repeat !== 'none' ? this.until : '',
      done: this.done, doneDates: this.doneDates, createdAt: this.createdAt
    };
    this.busy = true;
    this.error = '';
    this.agenda.save(item, (error: string) => {
      this.busy = false;
      if (error) this.error = error;
      else this.finish();
    });
  }

  remove(): void {
    if (this.busy || !this.agenda || !this.id) return;
    this.busy = true;
    this.error = '';
    this.agenda.remove(this.id, (error: string) => {
      this.busy = false;
      if (error) this.error = error;
      else this.finish();
    });
  }

  setQuick(value: string): void {
    this.quick = value;
    this.message = '';
    clearTimeout(this.timer);
    const sequence = ++this.sequence;
    if (!value.trim()) {
      this.quickDraft = undefined;
      this.quickHint = '';
      return;
    }
    this.timer = setTimeout(() => {
      this.agenda?.parse(value, (draft?: NativeAgendaDraft) => {
        if (sequence !== this.sequence) return;
        this.quickDraft = draft && draft.title ? draft : undefined;
        this.quickHint = this.quickDraft ? draftSummary(this.quickDraft) : '';
      });
    }, 250);
  }

  canQuickAdd(): boolean {
    return !this.busy && !!this.quickDraft;
  }

  quickAdd(): void {
    const draft = this.quickDraft;
    if (!draft || this.busy || !this.agenda) return;
    const item: NativeAgendaItem = {
      id: '', title: draft.title, date: draft.date, start: draft.start, end: draft.end, location: draft.location, note: '',
      remind: draft.remind, repeat: draft.repeat || 'none', until: '', done: false, doneDates: [], createdAt: 0
    };
    this.busy = true;
    this.agenda.save(item, (error: string, saved?: NativeAgendaItem) => {
      this.busy = false;
      if (error) {
        this.message = error;
        return;
      }
      this.quick = '';
      this.quickDraft = undefined;
      this.quickHint = '';
      this.message = saved && saved.date ? `已添加到${agendaShortDay(saved.date)}` : '已添加到待办';
    });
  }

  toggle(id: string, date: string, done: boolean): void {
    this.agenda?.toggle(id, date, done);
  }

  setRelay(on: boolean): void {
    this.agenda?.setRelay(on);
  }

  private follow(draft?: NativeAgendaDraft): void {
    if (draft) {
      this.parsedTitle = draft.title;
      this.date = draft.date || this.baseDate;
      this.start = draft.start || (draft.date ? '' : this.baseStart);
      this.end = draft.end;
      this.location = draft.location;
      this.remind = this.date ? draft.remind : -1;
      this.repeat = this.date ? (draft.repeat || 'none') : 'none';
      this.hint = `会记作「${draft.title}」，日期和时间已从文字里读出，可在下面修改`;
    } else {
      this.parsedTitle = '';
      this.date = this.baseDate;
      this.start = this.baseStart;
      this.end = '';
      this.location = '';
      this.remind = -1;
      this.repeat = 'none';
      this.hint = '';
    }
  }

  // A field changed by hand: the text stops steering the form, and keeps only the title it read.
  private touch(): void {
    if (this.touched) return;
    clearTimeout(this.timer);
    if (this.parsedTitle) this.text = this.parsedTitle;
    this.touched = true;
    this.parsedTitle = '';
    this.hint = '';
  }

  private finish(): void {
    if (this.fromList) this.mode = 'list';
    else this.visible = false;
  }

  private reset(fromList: boolean): void {
    clearTimeout(this.timer);
    this.sequence += 1;
    this.mode = 'edit';
    this.fromList = fromList;
    this.busy = false;
    this.error = '';
    this.id = '';
    this.text = '';
    this.date = '';
    this.start = '';
    this.end = '';
    this.location = '';
    this.note = '';
    this.remind = -1;
    this.repeat = 'none';
    this.until = '';
    this.done = false;
    this.doneDates = [];
    this.createdAt = 0;
    this.touched = false;
    this.parsedTitle = '';
    this.hint = '';
    this.baseDate = '';
    this.baseStart = '';
  }
}

@Component
export struct NativeAgendaEditor {
  @ObjectLink model: NativeAgendaEditorModel;
  @ObjectLink store: NativeScheduleStore;

  build() {
    Column({ space: 12 }) {
      if (this.model.mode === 'list') {
        this.listView()
      } else {
        this.editView()
      }
    }.width('100%').height('100%').padding({ left: 16, right: 16, top: 24, bottom: 28 })
      .backgroundColor($r('app.color.app_surface'))
  }

  // ---- One item ----

  @Builder
  private editView() {
    Row({ space: 8 }) {
      if (this.model.fromList) {
        Text('‹').fontSize(26).fontColor($r('app.color.app_accent')).padding({ right: 4 })
          .accessibilityText('返回日程与待办').onClick(() => { if (!this.model.busy) this.model.mode = 'list'; })
      }
      Text(this.model.isNew() ? '新建日程' : '编辑日程').fontSize(22).fontWeight(FontWeight.Bold)
        .fontColor($r('app.color.app_text_primary')).layoutWeight(1)
      if (this.model.busy) LoadingProgress().width(22).height(22)
    }.width('100%').height(44).padding({ right: 42 })
    if (this.model.error) {
      Text(this.model.error).fontSize(14).fontColor('#B42318').width('100%')
    }
    Scroll() {
      Column({ space: 12 }) {
        Column({ space: 6 }) {
          TextInput({ text: this.model.text, placeholder: this.model.isNew() ? '写下要做的事，例如「周五 14:00 组会 @药学楼」' : '标题' })
            .height(52).maxLength(120).fontSize(17).backgroundColor(Color.Transparent).padding({ left: 14, right: 14 })
            .accessibilityText('日程标题').enterKeyType(EnterKeyType.Done)
            .onChange((value: string) => this.model.setText(value))
            .onSubmit(() => this.model.save())
          if (this.model.hint) {
            Text(this.model.hint).fontSize(12).fontColor($r('app.color.app_text_secondary')).width('100%')
              .padding({ left: 14, right: 14, bottom: 10 })
          }
        }.width('100%').borderRadius(16).backgroundColor($r('app.color.app_control'))
        Column() {
          Row({ space: 12 }) {
            Text('日期').fontSize(16).fontColor($r('app.color.app_text_primary')).layoutWeight(1)
            Text(this.model.date ? `${agendaShortDay(this.model.date)} · ${WEEKDAYS[Math.max(0, agendaWeekday(this.model.date) - 1)]}` : '不设日期')
              .fontSize(15).fontColor(this.model.date ? $r('app.color.app_text_primary') : $r('app.color.app_text_secondary'))
            // Clearing the day is its own choice, as on the Web: the item becomes a to-do without one.
            if (this.model.date) {
              Text('不设日期').fontSize(13).fontWeight(600).fontColor($r('app.color.app_accent')).padding({ top: 8, bottom: 8 })
                .onClick(() => this.model.setDate(''))
            }
          }.width('100%').height(48).padding({ left: 14, right: 14 })
            .accessibilityText('日期，' + (this.model.date || '不设日期')).onClick(() => this.pickDate(false))
          Row({ space: 12 }) {
            Text('设定时间').fontSize(16).fontColor($r('app.color.app_text_primary')).layoutWeight(1)
            Toggle({ type: ToggleType.Switch, isOn: !!this.model.start }).selectedColor($r('app.color.app_accent'))
              .enabled(!!this.model.date).accessibilityText('设定时间')
              .onChange((on: boolean) => { if (on !== !!this.model.start) this.model.setTimed(on); })
          }.width('100%').height(48).padding({ left: 14, right: 8 })
            .border({ width: { top: 0.5 }, color: $r('app.color.app_divider') })
          if (this.model.start) {
            Row({ space: 8 }) {
              this.timeField('开始', this.model.start, false)
              this.timeField('结束（选填）', this.model.end, true)
            }.width('100%').padding({ left: 14, right: 14, top: 10, bottom: 12 })
              .border({ width: { top: 0.5 }, color: $r('app.color.app_divider') })
          }
        }.width('100%').borderRadius(16).backgroundColor($r('app.color.app_control')).clip(true)
        this.sectionTitle('提醒')
        Flex({ wrap: FlexWrap.Wrap, space: { main: LengthMetrics.vp(6), cross: LengthMetrics.vp(6) } }) {
          ForEach(REMIND_CHOICES, (choice: AgendaChoice) => {
            this.chip(choice.label, this.model.remind === choice.value, !!this.model.date || choice.value < 0,
              () => this.model.setRemind(choice.value))
          }, (choice: AgendaChoice) => String(choice.value) + ':' + (this.model.remind === choice.value ? 1 : 0) + (this.model.date ? 'd' : ''))
        }.width('100%')
        if (this.model.date) {
          this.sectionTitle('重复')
          Flex({ wrap: FlexWrap.Wrap, space: { main: LengthMetrics.vp(6), cross: LengthMetrics.vp(6) } }) {
            ForEach(REPEAT_CHOICES, (choice: AgendaRepeatChoice) => {
              this.chip(choice.label, this.model.repeat === choice.value, true, () => this.model.setRepeat(choice.value))
            }, (choice: AgendaRepeatChoice) => choice.value + ':' + (this.model.repeat === choice.value ? 1 : 0))
          }.width('100%')
          if (this.model.repeat !== 'none') {
            Row({ space: 12 }) {
              Text('重复到').fontSize(16).fontColor($r('app.color.app_text_primary')).layoutWeight(1)
              Text(this.model.until ? agendaShortDay(this.model.until) : '一直重复').fontSize(15)
                .fontColor(this.model.until ? $r('app.color.app_text_primary') : $r('app.color.app_text_secondary'))
              if (this.model.until) {
                Text('一直重复').fontSize(13).fontWeight(600).fontColor($r('app.color.app_accent')).padding({ top: 8, bottom: 8 })
                  .onClick(() => this.model.setUntil(''))
              }
            }.width('100%').height(48).padding({ left: 14, right: 14 }).borderRadius(16).backgroundColor($r('app.color.app_control'))
              .onClick(() => this.pickDate(true))
          }
        }
        Column() {
          Row({ space: 12 }) {
            Text('地点').fontSize(16).fontColor($r('app.color.app_text_primary')).width(40)
            TextInput({ text: this.model.location, placeholder: '选填' }).height(48).maxLength(40).layoutWeight(1).textAlign(TextAlign.End)
              .backgroundColor(Color.Transparent).padding({ left: 0, right: 0 }).accessibilityText('地点')
              .onChange((value: string) => { if (value !== this.model.location) this.model.setLocation(value); })
          }.width('100%').padding({ left: 14, right: 14 }).border({ width: { bottom: 0.5 }, color: $r('app.color.app_divider') })
          TextArea({ text: this.model.note, placeholder: '备注（选填）' }).height(88).maxLength(1000).fontSize(15)
            .backgroundColor(Color.Transparent).padding({ left: 14, right: 14, top: 10 }).accessibilityText('备注')
            .onChange((value: string) => { if (value !== this.model.note) this.model.setNote(value); })
        }.width('100%').borderRadius(16).backgroundColor($r('app.color.app_control')).clip(true)
        if (!this.model.isNew()) {
          Button('删除这条日程').type(ButtonType.Normal).height(48).width('100%').borderRadius(16).fontSize(15)
            .fontColor('#B42318').backgroundColor($r('app.color.app_control'))
            .onClick(() => this.confirmDelete())
        }
      }.width('100%').padding({ bottom: 12 }).enabled(!this.model.busy)
    }.layoutWeight(1).width('100%').scrollBar(BarState.Off).align(Alignment.Top)
    Button(this.model.busy ? '处理中' : this.model.isNew() ? '添加' : '保存').height(48).width('100%').fontSize(16)
      .backgroundColor($r('app.color.app_accent')).fontColor($r('app.color.app_on_accent'))
      .enabled(!this.model.busy && !!this.model.text.trim())
      .onClick(() => this.model.save())
  }

  // ---- 日程与待办 ----

  @Builder
  private listView() {
    Row() {
      Text('日程与待办').fontSize(22).fontWeight(FontWeight.Bold).fontColor($r('app.color.app_text_primary')).layoutWeight(1)
    }.width('100%').height(44).padding({ right: 42 })
    if (!this.store.agendaAvailable) {
      Text('登录后就能记日程，并在课表里看到它们。').fontSize(14).fontColor($r('app.color.app_text_secondary')).width('100%')
    } else {
      Scroll() {
        Column({ space: 12 }) {
          Row({ space: 8 }) {
            TextInput({ text: this.model.quick, placeholder: '一句话记下，例如「明天下午3点 实验报告」' })
              .height(44).maxLength(120).layoutWeight(1).borderRadius(12).backgroundColor($r('app.color.app_control'))
              .accessibilityText('一句话记下日程').enterKeyType(EnterKeyType.Done)
              .onChange((value: string) => { if (value !== this.model.quick) this.model.setQuick(value); })
              .onSubmit(() => this.model.quickAdd())
            Button('添加').height(44).fontSize(15).backgroundColor($r('app.color.app_accent')).fontColor($r('app.color.app_on_accent'))
              .enabled(this.model.canQuickAdd()).onClick(() => this.model.quickAdd())
          }.width('100%')
          if (this.model.quickHint || this.model.message) {
            Text(this.model.quickHint || this.model.message).fontSize(12).fontColor($r('app.color.app_text_secondary')).width('100%')
          }
          this.sectionTitle('待办')
          Column() {
            if (!agendaOpenTodos(this.store.agendaItems, agendaToday()).length) {
              this.emptyRow('没有待办')
            }
            ForEach(agendaOpenTodos(this.store.agendaItems, agendaToday()), (item: NativeAgendaItem) => {
              this.entryRow(agendaShortDay(item.date), !!item.date, false, item.title, item.date ? '已过日期，还没完成' : '',
                () => this.model.toggle(item.id, item.date || agendaToday(), true), () => this.model.openItem(item, true))
            }, (item: NativeAgendaItem) => item.id)
            this.addRow('添加不设日期的待办', () => this.model.openNew('', '', true))
          }.width('100%').borderRadius(16).backgroundColor($r('app.color.app_control')).clip(true)
          this.sectionTitle('接下来一周')
          Column() {
            if (!this.upcoming().length) {
              this.emptyRow('接下来一周没有安排')
            }
            ForEach(this.upcoming(), (day: AgendaDay) => {
              Text(day.title).fontSize(12).fontWeight(600).fontColor($r('app.color.app_text_secondary')).width('100%')
                .padding({ left: 14, right: 14, top: 10, bottom: 2 })
              ForEach(day.entries, (entry: NativeAgendaOccurrence) => {
                this.entryRow(entry.item.start ? (entry.item.end ? `${entry.item.start}–${entry.item.end}` : entry.item.start) : '全天',
                  false, entry.done, entry.item.title, this.entryDetail(entry.item),
                  () => this.model.toggle(entry.item.id, entry.date, !entry.done), () => this.model.openItem(entry.item, true))
              }, (entry: NativeAgendaOccurrence) => entry.item.id + ':' + entry.date + ':' + (entry.done ? 1 : 0))
            }, (day: AgendaDay) => day.date + ':' + day.entries.map((entry: NativeAgendaOccurrence) =>
              entry.item.id + (entry.done ? '1' : '0') + entry.item.title + entry.item.start).join(','))
            this.addRow('添加到今天', () => this.model.openNew(agendaToday(), '', true))
          }.width('100%').borderRadius(16).backgroundColor($r('app.color.app_control')).clip(true)
          Row({ space: 12 }) {
            Column({ space: 3 }) {
              Text('微信和 QQ 也提醒').fontSize(16).fontColor($r('app.color.app_text_primary')).width('100%')
              Text('设了提醒的日程到点时，服务器发一条站内通知，并转到你绑定的微信和 QQ；这台设备也会在通知栏提醒。')
                .fontSize(12).fontColor($r('app.color.app_text_secondary')).width('100%')
            }.layoutWeight(1)
            Toggle({ type: ToggleType.Switch, isOn: this.store.agendaRelay }).selectedColor($r('app.color.app_accent'))
              .accessibilityText('微信和 QQ 也提醒')
              .onChange((on: boolean) => { if (on !== this.store.agendaRelay) this.model.setRelay(on); })
          }.width('100%').padding(14).borderRadius(16).backgroundColor($r('app.color.app_control'))
          Text('网页、手机 App 和药大拾间 NEXT 用的是同一份日程，在哪里改都会同步。').fontSize(12)
            .fontColor($r('app.color.app_text_tertiary')).width('100%').padding({ left: 4, right: 4 })
        }.width('100%').padding({ bottom: 12 })
      }.layoutWeight(1).width('100%').scrollBar(BarState.Off).align(Alignment.Top)
    }
  }

  @Builder
  private entryRow(time: string, late: boolean, done: boolean, title: string, detail: string, onToggle: () => void, onOpen: () => void) {
    Row() {
      Text(time).fontSize(12).fontWeight(600).maxLines(1).width(84)
        .fontColor(late ? '#B42318' : $r('app.color.app_text_primary'))
      Stack() {
        if (done) Text('✓').fontSize(11).fontColor($r('app.color.app_on_accent'))
      }.width(18).height(18).borderRadius(9).margin({ right: 10 })
        .backgroundColor(done ? $r('app.color.app_accent') : Color.Transparent)
        .border({ width: done ? 0 : 1.5, color: $r('app.color.app_text_secondary'), radius: 9 })
        .responseRegion({ x: -10, y: -13, width: 38, height: 44 })
        .accessibilityText(done ? '标为未完成' : '标为完成')
        .onClick(() => onToggle())
      Column({ space: 2 }) {
        Text(title).fontSize(15).fontColor($r('app.color.app_text_primary')).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          .decoration({ type: done ? TextDecorationType.LineThrough : TextDecorationType.None }).width('100%')
        if (detail) {
          Text(detail).fontSize(12).fontColor($r('app.color.app_text_secondary')).maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
        }
      }.layoutWeight(1)
    }.width('100%').constraintSize({ minHeight: 48 }).padding({ left: 14, right: 14, top: 4, bottom: 4 }).opacity(done ? 0.55 : 1)
      .border({ width: { bottom: 0.5 }, color: $r('app.color.app_divider') })
      .onClick(() => onOpen())
  }

  @Builder
  private emptyRow(text: string) {
    Text(text).fontSize(13).fontColor($r('app.color.app_text_secondary')).width('100%').padding({ left: 14, right: 14, top: 12, bottom: 12 })
      .border({ width: { bottom: 0.5 }, color: $r('app.color.app_divider') })
  }

  @Builder
  private addRow(label: string, action: () => void) {
    Text('＋ ' + label).fontSize(15).fontWeight(FontWeight.Medium).fontColor($r('app.color.app_accent')).width('100%').height(46)
      .padding({ left: 14, right: 14 }).onClick(() => action())
  }

  @Builder
  private sectionTitle(title: string) {
    Text(title).fontSize(14).fontWeight(600).fontColor($r('app.color.app_text_secondary')).width('100%').padding({ left: 4, right: 4 })
  }

  @Builder
  private chip(title: string, selected: boolean, enabled: boolean, action: () => void) {
    Button(title).type(ButtonType.Normal).height(34).padding({ left: 12, right: 12 }).borderRadius(9).fontSize(13).fontWeight(FontWeight.Medium)
      .fontColor(selected ? $r('app.color.app_accent') : $r('app.color.app_text_secondary'))
      .backgroundColor(selected ? $r('app.color.app_accent_surface') : $r('app.color.app_surface'))
      .border({ width: 1, color: selected ? $r('app.color.app_accent') : $r('app.color.app_divider'), radius: 9 })
      .opacity(enabled ? 1 : 0.45).enabled(enabled)
      .accessibilityText(title + (selected ? '，已选' : '，未选')).accessibilitySelected(selected)
      .onClick(() => action())
  }

  @Builder
  private timeField(title: string, value: string, end: boolean) {
    Column({ space: 2 }) {
      Text(title).fontSize(12).fontColor($r('app.color.app_text_secondary'))
      Text(value || '不设').fontSize(16).fontWeight(FontWeight.Medium)
        .fontColor(value ? $r('app.color.app_text_primary') : $r('app.color.app_text_secondary'))
    }.layoutWeight(1).alignItems(HorizontalAlign.Start).padding({ left: 12, right: 12, top: 8, bottom: 8 })
      .borderRadius(10).backgroundColor($r('app.color.app_surface')).border({ width: 1, color: $r('app.color.app_divider'), radius: 10 })
      .accessibilityText(`${title}，${value || '不设'}`)
      .onClick(() => this.pickTime(value, end))
  }

  private upcoming(): AgendaDay[] {
    const today = agendaToday();
    const first = agendaDayNumber(today);
    const days: AgendaDay[] = [];
    for (let offset = 0; offset < 7; offset += 1) {
      const date = agendaDateOf(first + offset);
      const entries = agendaOn(this.store.agendaItems, date);
      if (entries.length) days.push({ date: date, title: `${agendaShortDay(date, today)} · ${WEEKDAYS[agendaWeekday(date) - 1]}`, entries: entries });
    }
    return days;
  }

  private entryDetail(item: NativeAgendaItem): string {
    const repeat = REPEAT_CHOICES.find((choice: AgendaRepeatChoice) => choice.value === item.repeat);
    return [item.location, repeat && repeat.value !== 'none' ? repeat.label : ''].filter((part: string) => !!part).join(' · ');
  }

  private pickDate(until: boolean): void {
    if (this.model.busy) return;
    const current = until ? (this.model.until || this.model.date) : (this.model.date || agendaToday());
    const selected = new Date(Number(current.substring(0, 4)), Number(current.substring(5, 7)) - 1, Number(current.substring(8, 10)));
    const pad = (part: number): string => String(part).padStart(2, '0');
    DatePickerDialog.show({ start: new Date(2020, 0, 1), end: new Date(2040, 11, 31), selected,
      onDateAccept: (value: Date) => {
        const picked = `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
        if (until) this.model.setUntil(picked); else this.model.setDate(picked);
      } });
  }

  private pickTime(value: string, end: boolean): void {
    if (this.model.busy) return;
    const base = value || (end ? this.model.start : '09:00') || '09:00';
    const selected = new Date();
    selected.setHours(Number(base.substring(0, 2)) + (end && !value ? 1 : 0), Number(base.substring(3, 5)), 0, 0);
    const pad = (part: number): string => String(part).padStart(2, '0');
    TimePickerDialog.show({ selected, useMilitaryTime: true,
      onAccept: (result: TimePickerResult) => {
        const picked = `${pad(result.hour ?? 0)}:${pad(result.minute ?? 0)}`;
        if (end) this.model.setEnd(picked); else this.model.setStart(picked);
      } });
  }

  private confirmDelete(): void {
    if (this.model.busy) return;
    AlertDialog.show({ title: `删除「${this.model.text}」？`,
      message: this.model.repeat !== 'none' ? '这是重复的日程，所有日子的都会删除。' : '删除后其他设备上也会删除。',
      primaryButton: { value: '取消', action: () => undefined },
      secondaryButton: { value: '删除', fontColor: '#B42318', action: () => this.model.remove() } });
  }
}
