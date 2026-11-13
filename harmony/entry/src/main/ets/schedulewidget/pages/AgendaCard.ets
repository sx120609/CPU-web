// 日程 card (iOS AgendaWidget): to-dos past their day, the next two weeks and to-dos without a date;
// the circle ticks one off on the desktop (kept until the app is next opened), the rest opens the app.
import { widgetTextScales } from '../../common/ScheduleWidgetOptions';
import { agendaRowsThatFit, chooseCardScale } from '../ScheduleCardLayout';

interface CardRow {
  id: string;
  date: string;
  title: string;
  when: string;
  done: boolean;
  overdue: boolean;
}

const PADDING = 14;
// 标题一行 14fp、行高 18，和列表隔 6。
const HEADER = 24;

const storage = new LocalStorage();

@Entry(storage)
@Component
struct AgendaCard {
  @LocalStorageProp('state') private state: string = 'empty';
  @LocalStorageProp('rows') private rows: string = '[]';
  @LocalStorageProp('count') private count: number = 0;
  @LocalStorageProp('dimension') private dimension: number = 2;
  @LocalStorageProp('cardStyle') private cardStyle: string = 'classic';
  // 文字大小跟 App 里的卡片设置：auto | small | standard | large。
  @LocalStorageProp('textSize') private textSize: string = 'standard';
  @State private cardWidth: number = 0;
  @State private cardHeight: number = 0;

  // 2×2 一条一行（圆圈 18 高），其余标题 16 + 时间 12 两行。
  private rowHeight(): number {
    return this.dimension === 2 ? 18 : 28;
  }

  private rowSpacing(): number {
    return this.dimension === 2 ? 4 : 6;
  }

  private baseHeight(): number {
    return (this.cardHeight > 0 ? this.cardHeight : this.dimension === 4 ? 340 : 158) - PADDING * 2;
  }

  // 整块内容一起缩放（同课表卡片）；自适应在条目少、放得下时放大。
  private textScale(): number {
    if (this.cardHeight <= 0 || this.cardWidth <= 0) return 1;
    const scales = widgetTextScales(this.textSize);
    if (scales.length === 1) return scales[0];
    const count = this.list().length;
    return chooseCardScale(scales, this.baseHeight(), HEADER + Math.max(1, count) * this.rowHeight()
      + Math.max(0, count - 1) * this.rowSpacing());
  }

  // 放得下的才画，免得最后一条被卡片边缘切掉一半。
  private shown(): CardRow[] {
    const rows = this.list();
    return rows.slice(0, agendaRowsThatFit(this.baseHeight() / this.textScale() - HEADER, this.rowHeight(), this.rowSpacing(), rows.length));
  }

  private canvasWidth(): Length {
    return this.textScale() === 1 ? '100%' : (this.cardWidth - PADDING * 2) / this.textScale();
  }

  private canvasHeight(): Length {
    return this.textScale() === 1 ? '100%' : this.baseHeight() / this.textScale();
  }

  build() {
    Column() {
      Column({ space: 6 }) {
        Row() {
          Text('日程').fontSize(14).lineHeight(18).fontWeight(FontWeight.Bold).fontColor($r('app.color.widget_text')).layoutWeight(1)
            .fontFamily(this.cardStyle === 'paper' ? 'serif' : this.cardStyle === 'board' ? 'monospace' : 'HarmonyOS Sans')
          if (this.count > 0) {
            Text(String(this.count)).fontSize(12).fontWeight(600).fontColor('#FFFFFF').padding({ left: 6, right: 6 })
              .height(18).borderRadius(9).backgroundColor('#0F8F7F')
          }
        }.width('100%').height(18)
        if (this.state !== 'ready') {
          Text('打开 App 后，日程会出现在这里').fontSize(12).fontColor($r('app.color.widget_secondary')).width('100%').layoutWeight(1)
        } else if (!this.list().length) {
          Text('这两周没有日程，也没有待办').fontSize(12).fontColor($r('app.color.widget_secondary')).width('100%').layoutWeight(1)
        } else {
          Column({ space: this.rowSpacing() }) {
            ForEach(this.shown(), (row: CardRow) => {
              Row({ space: 8 }) {
                Stack() {
                  if (row.done) Text('✓').fontSize(10).fontColor('#FFFFFF')
                }.width(18).height(18).borderRadius(9)
                  .backgroundColor(row.done ? '#0F8F7F' : Color.Transparent)
                  .border({ width: row.done ? 0 : 1.5, color: row.overdue ? '#DC2626' : $r('app.color.widget_secondary'), radius: 9 })
                  .onClick(() => {
                    postCardAction(this, { action: 'message', params: { action: 'toggle', id: row.id, date: row.date } });
                  })
                Column() {
                  Text(row.title).fontSize(13).lineHeight(16).fontWeight(500).fontColor($r('app.color.widget_text')).maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
                    .decoration({ type: row.done ? TextDecorationType.LineThrough : TextDecorationType.None })
                  if (this.dimension !== 2) {
                    Text(row.when).fontSize(10).lineHeight(12).fontColor(row.overdue ? '#DC2626' : $r('app.color.widget_secondary'))
                      .maxLines(1).width('100%')
                  }
                }.layoutWeight(1).alignItems(HorizontalAlign.Start)
                if (this.dimension === 2) {
                  Text(row.when).fontSize(10).fontColor(row.overdue ? '#DC2626' : $r('app.color.widget_secondary')).maxLines(1)
                }
              }.width('100%').height(this.rowHeight()).opacity(row.done ? 0.55 : 1)
            }, (row: CardRow) => row.id + row.date + (row.done ? '1' : '0') + row.title + row.when)
          }.width('100%').layoutWeight(1).justifyContent(FlexAlign.Start)
        }
      }
      .width(this.canvasWidth())
      .height(this.canvasHeight())
      .scale({ x: this.textScale(), y: this.textScale(), centerX: 0, centerY: 0 })
    }.width('100%').height('100%').padding(PADDING).alignItems(HorizontalAlign.Start)
    .clip(true)
    .backgroundColor(this.cardStyle === 'paper' ? $r('app.color.widget_paper') : this.cardStyle === 'board' ? $r('app.color.widget_board')
      : $r('app.color.widget_surface'))
    .borderRadius(this.cardStyle === 'classic' ? 22 : 8)
    // onAreaChange 在卡片里不可用；onSizeChange 可以。
    .onSizeChange((_previous: SizeOptions, size: SizeOptions) => {
      this.cardWidth = Number(size.width ?? 0);
      this.cardHeight = Number(size.height ?? 0);
    })
    .onClick(() => {
      postCardAction(this, { action: 'router', abilityName: 'EntryAbility', params: { targetUrl: 'cpuweb://schedule?action=agendaList' } });
    })
  }

  private list(): CardRow[] {
    try {
      const rows = JSON.parse(this.rows) as CardRow[];
      return Array.isArray(rows) ? rows : [];
    } catch (_) {
      return [];
    }
  }
}
