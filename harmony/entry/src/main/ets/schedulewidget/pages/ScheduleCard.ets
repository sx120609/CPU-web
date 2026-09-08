import { ScheduleCardView } from '../ScheduleCardView';

const storage = new LocalStorage();

@Entry(storage)
@Component
struct ScheduleCard {
  @LocalStorageProp('state') private state: string = 'loading';
  @LocalStorageProp('title') private title: string = '药大课表';
  @LocalStorageProp('subtitle') private subtitle: string = '正在同步课程';
  @LocalStorageProp('leftTitle') private leftTitle: string = '';
  @LocalStorageProp('rightTitle') private rightTitle: string = '';
  @LocalStorageProp('primaryCourses') private primaryCourses: string = '[]';
  @LocalStorageProp('secondaryCourses') private secondaryCourses: string = '[]';
  @LocalStorageProp('footer') private footer: string = '';
  @LocalStorageProp('theme') private theme: string = 'color-glass';
  @LocalStorageProp('accent') private accent: string = '#6D5DFC';
  @LocalStorageProp('semester') private semester: string = '';
  @LocalStorageProp('currentWeek') private currentWeek: number = 0;
  @LocalStorageProp('primaryWeek') private primaryWeek: number = 0;
  @LocalStorageProp('secondaryWeek') private secondaryWeek: number = 0;
  @LocalStorageProp('primaryRemaining') private primaryRemaining: number = 0;
  @LocalStorageProp('secondaryRemaining') private secondaryRemaining: number = 0;
  @LocalStorageProp('dimension') private dimension: number = 2;
  @LocalStorageProp('variant') private variant: string = 'desktop';
  @LocalStorageProp('layout') private layout: string = '';

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
      layout: this.layout
    })
    }.width('100%').height('100%')
    .onClick(() => {
      postCardAction(this, { action: 'router', abilityName: 'EntryAbility',
        params: { targetUrl: 'cpuweb://schedule?source=widget&week=current' } });
    })
  }
}
