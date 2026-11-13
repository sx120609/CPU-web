import { ScheduleCardView } from '../ScheduleCardView';

const storage = new LocalStorage();

@Entry(storage)
@Component
struct ScheduleCard {
  @LocalStorageProp('state') private state: string = 'loading';
  @LocalStorageProp('title') private title: string = '课表';
  @LocalStorageProp('subtitle') private subtitle: string = '正在同步课程';
  @LocalStorageProp('leftTitle') private leftTitle: string = '';
  @LocalStorageProp('rightTitle') private rightTitle: string = '';
  @LocalStorageProp('primaryCourses') private primaryCourses: string = '[]';
  @LocalStorageProp('secondaryCourses') private secondaryCourses: string = '[]';
  @LocalStorageProp('footer') private footer: string = '';
  @LocalStorageProp('theme') private theme: string = 'color-glass';
  @LocalStorageProp('accent') private accent: string = '#0F8F7F';
  @LocalStorageProp('semester') private semester: string = '';
  @LocalStorageProp('currentWeek') private currentWeek: number = 0;
  @LocalStorageProp('primaryWeek') private primaryWeek: number = 0;
  @LocalStorageProp('secondaryWeek') private secondaryWeek: number = 0;
  @LocalStorageProp('primaryRemaining') private primaryRemaining: number = 0;
  @LocalStorageProp('secondaryRemaining') private secondaryRemaining: number = 0;
  @LocalStorageProp('dimension') private dimension: number = 2;
  @LocalStorageProp('variant') private variant: string = 'desktop';
  @LocalStorageProp('layout') private layout: string = '';
  @LocalStorageProp('mode') private mode: string = 'today';
  @LocalStorageProp('dayNote') private dayNote: string = '';
  @LocalStorageProp('badge') private badge: string = '';
  @LocalStorageProp('restTitle') private restTitle: string = '今日无课';
  @LocalStorageProp('restDetail') private restDetail: string = '';
  @LocalStorageProp('lockLine') private lockLine: string = '今日无课';
  @LocalStorageProp('leadLabel') private leadLabel: string = '当前';
  @LocalStorageProp('trailLabel') private trailLabel: string = '接下来';
  @LocalStorageProp('rightNote') private rightNote: string = '';
  @LocalStorageProp('lunar') private lunar: string = '';
  @LocalStorageProp('badgeStatutory') private badgeStatutory: boolean = false;
  @LocalStorageProp('rightLunar') private rightLunar: string = '';
  @LocalStorageProp('rightBadge') private rightBadge: string = '';
  @LocalStorageProp('rightBadgeStatutory') private rightBadgeStatutory: boolean = false;
  @LocalStorageProp('lockTitle') private lockTitle: string = '';
  @LocalStorageProp('lockDay') private lockDay: string = '';
  @LocalStorageProp('cardStyle') private cardStyle: string = 'classic';
  @LocalStorageProp('background') private cardPhoto: string = '';
  @LocalStorageProp('veil') private veil: number = 0.55;
  @LocalStorageProp('textSize') private textSize: string = 'standard';
  @LocalStorageProp('showProgress') private showProgress: boolean = true;
  @LocalStorageProp('showWeek') private showWeek: boolean = true;
  @LocalStorageProp('hideCompleted') private hideCompleted: boolean = false;
  @LocalStorageProp('countdown') private countdown: string = '';
  @LocalStorageProp('primaryEmpty') private primaryEmpty: string = '';
  @LocalStorageProp('previewLabel') private previewLabel: string = '';
  @LocalStorageProp('previewDetail') private previewDetail: string = '';
  @LocalStorageProp('previewCourses') private previewCourses: string = '[]';
  @LocalStorageProp('previewCount') private previewCount: number = 0;
  @LocalStorageProp('previewSummary') private previewSummary: string = '';

  build() {
    Column() {
    ScheduleCardView({
      state: this.state,
      title: this.title,
      subtitle: this.subtitle,
      leftTitle: this.leftTitle,
      rightTitle: this.rightTitle,
      primaryCourses: this.primaryCourses,
      secondaryCourses: this.secondaryCourses,
      footer: this.footer,
      theme: this.theme,
      accent: this.accent,
      semester: this.semester,
      currentWeek: this.currentWeek,
      primaryWeek: this.primaryWeek,
      secondaryWeek: this.secondaryWeek,
      primaryRemaining: this.primaryRemaining,
      secondaryRemaining: this.secondaryRemaining,
      dimension: this.dimension,
      variant: this.variant,
      layout: this.layout,
      mode: this.mode,
      dayNote: this.dayNote,
      badge: this.badge,
      restTitle: this.restTitle,
      restDetail: this.restDetail,
      lockLine: this.lockLine,
      leadLabel: this.leadLabel,
      trailLabel: this.trailLabel,
      rightNote: this.rightNote,
      lunar: this.lunar,
      badgeStatutory: this.badgeStatutory,
      rightLunar: this.rightLunar,
      rightBadge: this.rightBadge,
      rightBadgeStatutory: this.rightBadgeStatutory,
      lockTitle: this.lockTitle,
      cardStyle: this.cardStyle,
      cardPhoto: this.cardPhoto,
      veil: this.veil,
      lockDay: this.lockDay,
      textSize: this.textSize,
      showProgress: this.showProgress,
      showWeek: this.showWeek,
      hideCompleted: this.hideCompleted,
      countdown: this.countdown,
      primaryEmpty: this.primaryEmpty,
      previewLabel: this.previewLabel,
      previewDetail: this.previewDetail,
      previewCourses: this.previewCourses,
      previewCount: this.previewCount,
      previewSummary: this.previewSummary
    })
    }.width('100%').height('100%')
    .onClick(() => {
      postCardAction(this, { action: 'router', abilityName: 'EntryAbility',
        params: { targetUrl: 'cpuweb://schedule?source=widget&week=current' } });
    })
  }
}
