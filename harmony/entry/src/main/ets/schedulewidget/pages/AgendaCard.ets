// 日程 card (iOS AgendaWidget): to-dos past their day, the next two weeks and to-dos without a date;
// the circle ticks one off on the desktop (kept until the app is next opened), the rest opens the app.

interface CardRow {
  id: string;
  date: string;
  title: string;
  when: string;
  done: boolean;
  overdue: boolean;
}

const storage = new LocalStorage();

@Entry(storage)
@Component
struct AgendaCard {
  @LocalStorageProp('state') private state: string = 'empty';
  @LocalStorageProp('rows') private rows: string = '[]';
  @LocalStorageProp('count') private count: number = 0;
  @LocalStorageProp('dimension') private dimension: number = 2;
  @LocalStorageProp('cardStyle') private cardStyle: string = 'classic';

  build() {
    Column({ space: 6 }) {
      Row() {
        Text('日程').fontSize(14).fontWeight(FontWeight.Bold).fontColor($r('app.color.widget_text')).layoutWeight(1)
          .fontFamily(this.cardStyle === 'paper' ? 'serif' : this.cardStyle === 'board' ? 'monospace' : 'HarmonyOS Sans')
        if (this.count > 0) {
          Text(String(this.count)).fontSize(12).fontWeight(600).fontColor('#FFFFFF').padding({ left: 6, right: 6 })
            .height(18).borderRadius(9).backgroundColor('#0F8F7F')
        }
      }.width('100%')
      if (this.state !== 'ready') {
        Text('打开 App 后，日程会出现在这里').fontSize(12).fontColor($r('app.color.widget_secondary')).width('100%').layoutWeight(1)
      } else if (!this.list().length) {
        Text('这两周没有日程，也没有待办').fontSize(12).fontColor($r('app.color.widget_secondary')).width('100%').layoutWeight(1)
      } else {
        Column({ space: this.dimension === 2 ? 4 : 6 }) {
          ForEach(this.list(), (row: CardRow) => {
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
                Text(row.title).fontSize(13).fontWeight(500).fontColor($r('app.color.widget_text')).maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
                  .decoration({ type: row.done ? TextDecorationType.LineThrough : TextDecorationType.None })
                if (this.dimension !== 2) {
                  Text(row.when).fontSize(10).fontColor(row.overdue ? '#DC2626' : $r('app.color.widget_secondary')).width('100%')
                }
              }.layoutWeight(1).alignItems(HorizontalAlign.Start)
              if (this.dimension === 2) {
                Text(row.when).fontSize(10).fontColor(row.overdue ? '#DC2626' : $r('app.color.widget_secondary')).maxLines(1)
              }
            }.width('100%').opacity(row.done ? 0.55 : 1)
          }, (row: CardRow) => row.id + row.date + (row.done ? '1' : '0'))
        }.width('100%').layoutWeight(1)
      }
    }.width('100%').height('100%').padding(14)
    .backgroundColor(this.cardStyle === 'paper' ? $r('app.color.widget_paper') : this.cardStyle === 'board' ? $r('app.color.widget_board')
      : $r('app.color.widget_surface'))
    .borderRadius(this.cardStyle === 'classic' ? 22 : 8)
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
