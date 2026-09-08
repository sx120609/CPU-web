export class NativeWebHeaderState {
  path: string = '/home';
  title: string = '药大拾间';
  visible: boolean = true;
  back: boolean = false;
  authenticated: boolean = false;
  unread: number = 0;
  directUnread: number = 0;
}

@Component
export struct NativeWebHeader {
  @Prop state: NativeWebHeaderState = new NativeWebHeaderState();
  @Prop blocked: boolean = false;
  onAction: (action: string) => void = () => undefined;

  build() {
    Row({ space: 2 }) {
      if (this.state.back) this.iconButton($r('sys.symbol.chevron_left'), '返回', 'back')
      else {
        Button() { Image($r('app.media.app_icon')).width(28).height(28).borderRadius(7).accessibilityLevel('no') }
          .type(ButtonType.Normal).width(40).height(44).padding(0).backgroundColor(Color.Transparent)
          .accessibilityText('药大拾间，返回首页').onClick(() => this.onAction('home'))
      }
      Text(this.state.title).fontSize(18).fontWeight(FontWeight.Bold)
        .fontColor($r('app.color.app_text_primary')).layoutWeight(1).maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis }).minFontSize(15).maxFontSize(18)
        .heightAdaptivePolicy(TextHeightAdaptivePolicy.MIN_FONT_SIZE_FIRST)
        .margin({ left: 2, right: 6 })
      this.iconButton($r('sys.symbol.arrow_clockwise'), '刷新页面', 'refresh')
      if (this.state.authenticated) {
        Button() {
          Stack({ alignContent: Alignment.TopEnd }) {
            SymbolGlyph($r('sys.symbol.bell')).fontSize(21).fontColor([$r('app.color.app_text_primary')])
            if (this.state.unread > 0) {
              Circle().width(7).height(7).fill($r('app.color.app_accent'))
            }
          }.width(24).height(24)
        }.type(ButtonType.Normal).width(44).height(44).padding(0).borderRadius(22)
          .backgroundColor(Color.Transparent).enabled(!this.blocked)
          .accessibilityText(this.state.unread > 0 ? `消息，${this.state.unread}条未读` : '消息')
          .onClick(() => this.onAction('messages'))
      } else {
        Button('登录').type(ButtonType.Normal).height(44).padding({ left: 8, right: 8 })
          .fontSize(14).fontColor($r('app.color.app_accent')).borderRadius(22)
          .backgroundColor(Color.Transparent).enabled(!this.blocked).onClick(() => this.onAction('login'))
      }
      this.iconButton($r('sys.symbol.square_grid_2x2'), '更多', 'more')
    }.width('100%').height(56).padding({ left: 6, right: 8 })
      .backgroundColor($r('app.color.app_background'))
  }

  @Builder
  private iconButton(symbol: Resource, label: string, action: string) {
    Button() { SymbolGlyph(symbol).fontSize(21).fontColor([$r('app.color.app_text_primary')]) }
      .type(ButtonType.Normal).width(44).height(44).padding(0).borderRadius(22)
      .backgroundColor(Color.Transparent).enabled(!this.blocked).accessibilityText(label)
      .onClick(() => this.onAction(action))
  }
}
