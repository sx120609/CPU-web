import { NATIVE_TAB_BAR_HEIGHT } from './NativeNavigationLayout';

@Component
export struct NativeTabBar {
  @Prop selected: number = 0;
  @Prop dark: boolean = false;
  onSelect: (index: number) => void = () => undefined;

  @Builder
  private item(index: number, title: string, symbol: Resource) {
    Button() {
      Column({ space: 1 }) {
        SymbolGlyph(symbol).fontSize(22).fontWeight(FontWeight.Medium)
          .fontColor([this.selected === index ? (this.dark ? '#88DCCA' : '#087E73') : (this.dark ? '#C8CDD6' : '#31353E')])
        Text(title).fontSize(12).fontWeight(this.selected === index ? FontWeight.Bold : FontWeight.Medium)
          .fontColor(this.selected === index ? (this.dark ? '#88DCCA' : '#087E73') : (this.dark ? '#C8CDD6' : '#31353E'))
          .maxLines(1)
      }.width('100%').height(46).justifyContent(FlexAlign.Center)
    }.type(ButtonType.Normal).height(48).layoutWeight(1).padding(0).borderRadius(20)
      .backgroundColor(this.selected === index ? (this.dark ? '#384640' : '#E4EBE9') : Color.Transparent)
      .animation({ duration: 180, curve: Curve.EaseOut })
      .accessibilityText(`${title}${this.selected === index ? '，已选中' : ''}`)
      .accessibilitySelected(this.selected === index)
      .onClick(() => this.onSelect(index))
  }

  build() {
    Row({ space: 2 }) {
      this.item(0, '首页', $r('sys.symbol.house_fill'))
      this.item(1, '教务', $r('sys.symbol.book_pages_fill'))
      this.item(2, '课表', $r('sys.symbol.calendar'))
      this.item(3, '服务', $r('sys.symbol.square_grid_2x2'))
      this.item(4, '我的', $r('sys.symbol.person_fill'))
    }.width('100%').height(NATIVE_TAB_BAR_HEIGHT).padding(4).borderRadius(29)
      .backgroundColor(this.dark ? '#252931' : '#F9FAFC')
      .border({ width: 0.5, color: this.dark ? '#515760' : '#D8DDE4' })
      .shadow({ radius: 12, offsetY: 3, color: this.dark ? '#20000000' : '#100D2436' })
  }
}
