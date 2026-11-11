import { NativeScheduleCoupleModel } from './NativeScheduleCouple';
import { NativeScheduleSharingModel } from './NativeScheduleSharing';
import { SharedSchedule, sharedScheduleName } from './ScheduleSharing';
import { NativeScheduleCell } from './NativeScheduleStore';

// 叠加到我的课表 (iOS NativeScheduleOverlayPicker): whose courses are drawn beside the user's own. The
// partner's (情侣课表), one of the saved shared timetables, or nobody's. Somebody at another school is
// placed by clock time, so their bells may differ.

@Component
export struct NativeOverlayPicker {
  @ObjectLink couple: NativeScheduleCoupleModel;
  @ObjectLink sharing: NativeScheduleSharingModel;
  onDone: () => void = () => undefined;
  onOpenSharing: () => void = () => undefined;
  onOpenCouple: () => void = () => undefined;

  build() {
    Scroll() {
      Column({ space: 18 }) {
        Text('叠加到我的课表').fontSize(22).fontWeight(FontWeight.Bold).fontColor($r('app.color.app_text_primary')).width('100%')
        Row({ space: 12 }) {
          Stack() {
            Column().width(22).height(30).borderRadius(7).backgroundColor('#D90F766E').translate({ x: -5, y: 3 })
            Column().width(22).height(30).borderRadius(7).backgroundColor('#D914B8A6').translate({ x: 5, y: -3 })
          }.width(40).height(40).accessibilityLevel('no')
          Text('选一个人的课表，和你的课并排显示：一起上课、谁有空，一眼就能看出来。别的学校的同学也可以，课会按实际上课时间对齐。')
            .fontSize(13).fontColor($r('app.color.app_text_secondary')).layoutWeight(1)
        }.width('100%').alignItems(VerticalAlign.Top)
        this.section('情侣')
        Column() {
          if (this.couple.bound()) {
            this.choice(this.couple.status.partner.nickname || 'TA', this.coupleDetail(), '♥', '#E2568A',
              !this.couple.overlayCode && this.couple.visible, 'overlay-couple', () => this.choose(''))
          } else {
            this.action('绑定情侣课表', '#E2568A', 'overlay-bind', () => this.onOpenCouple())
          }
        }.width('100%').borderRadius(16).backgroundColor($r('app.color.app_control')).clip(true)
        this.section('同学的分享课表')
        Column() {
          ForEach(this.sharing.library.schedules, (schedule: SharedSchedule, index: number) => {
            Column() {
              if (index > 0) Divider().color($r('app.color.app_divider')).margin({ left: 62 })
              this.choice(sharedScheduleName(schedule), this.detail(schedule), sharedScheduleName(schedule).substring(0, 1), '#0D9488',
                this.couple.overlayCode === schedule.meta.code, 'overlay-share-' + schedule.meta.code, () => this.choose(schedule.meta.code))
            }
          }, (schedule: SharedSchedule) => schedule.meta.code)
          if (this.sharing.library.schedules.length) Divider().color($r('app.color.app_divider')).margin({ left: 62 })
          this.action(this.sharing.library.schedules.length ? '再添加一份' : '输入同学的分享码', '#0D9488', 'overlay-add',
            () => this.onOpenSharing())
        }.width('100%').borderRadius(16).backgroundColor($r('app.color.app_control')).clip(true)
        Text('分享码保存在这台设备上；对方更新课表后，这里也会跟着更新。').fontSize(12)
          .fontColor($r('app.color.app_text_tertiary')).width('100%')
        Column() {
          this.choice('不叠加', '只看自己的课', '我', '#8A94A0', !this.couple.overlayCode && !(this.couple.bound() && this.couple.visible),
            'overlay-none', () => this.choose('-'))
        }.width('100%').borderRadius(16).backgroundColor($r('app.color.app_control')).clip(true)
        Button('完成').type(ButtonType.Capsule).height(44).width('100%').fontSize(15)
          .fontColor($r('app.color.app_on_accent')).backgroundColor($r('app.color.app_accent'))
          .onClick(() => this.onDone())
      }.width('100%').padding({ left: 20, right: 20, top: 32, bottom: 40 })
    }.width('100%').height('100%').scrollBar(BarState.Off).align(Alignment.Top).backgroundColor($r('app.color.app_surface'))
  }

  @Builder
  private section(title: string) {
    Text(title).fontSize(13).fontWeight(600).fontColor($r('app.color.app_text_secondary')).width('100%').padding({ left: 4 }).margin({ bottom: -10 })
  }

  @Builder
  private choice(title: string, detail: string, mark: string, tint: string, selected: boolean, id: string, action: () => void) {
    Row({ space: 12 }) {
      Text(mark).fontSize(15).fontWeight(600).fontColor('#FFFFFF').width(36).height(36).borderRadius(18)
        .textAlign(TextAlign.Center).backgroundColor(tint)
      Column({ space: 2 }) {
        Text(title).fontSize(16).fontWeight(FontWeight.Medium).fontColor($r('app.color.app_text_primary')).maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
        Text(detail).fontSize(12).fontColor($r('app.color.app_text_secondary')).maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
      }.layoutWeight(1)
      SymbolGlyph(selected ? $r('sys.symbol.checkmark_circle_fill') : $r('sys.symbol.circle'))
        .fontSize(22).fontColor([selected ? $r('app.color.app_accent') : $r('app.color.app_text_tertiary')])
    }.width('100%').padding({ left: 14, right: 14, top: 10, bottom: 10 })
      .id(id).accessibilityGroup(true).accessibilitySelected(selected).accessibilityText(title + '，' + detail)
      .onClick(action)
  }

  @Builder
  private action(title: string, tint: string, id: string, run: () => void) {
    Row({ space: 12 }) {
      Text('＋').fontSize(16).fontWeight(600).fontColor(tint).width(36).height(36).borderRadius(18)
        .textAlign(TextAlign.Center).backgroundColor(tint + '24')
      Text(title).fontSize(16).fontColor(tint).layoutWeight(1)
    }.width('100%').padding({ left: 14, right: 14, top: 10, bottom: 10 }).id(id).onClick(run)
  }

  private coupleDetail(): string {
    return [this.couple.partnerSchool, this.couple.showing() || this.couple.visible ? '情侣课表' : '还没有同步课表']
      .filter((value: string) => !!value).join(' · ');
  }

  private detail(schedule: SharedSchedule): string {
    const parts: string[] = [];
    if (schedule.calendar.school) parts.push(schedule.calendar.school);
    let count = schedule.meta.courseCount;
    if (count <= 0) schedule.cells.forEach((cell: NativeScheduleCell) => { count += cell.courses.length; });
    parts.push(`${count} 门课`);
    if (schedule.revoked) parts.push('对方已停止分享');
    return parts.join(' · ');
  }

  // '' is the partner, '-' nobody, anything else a share code.
  private choose(code: string): void {
    if (code === '' ) {
      this.couple.setOverlay(undefined);
      this.couple.setVisible(true);
    } else if (code === '-') {
      this.couple.setOverlay(undefined);
      if (this.couple.bound()) this.couple.setVisible(false);
    } else {
      this.couple.setOverlay(this.sharing.library.schedules.find((schedule: SharedSchedule) => schedule.meta.code === code));
    }
  }
}
