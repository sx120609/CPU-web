import UIAbility from '@ohos.app.ability.UIAbility';
import AbilityConstant from '@ohos.app.ability.AbilityConstant';
import Want from '@ohos.app.ability.Want';
import window from '@ohos.window';
import { APP_URL, destinationUrlForDeepLink } from '../common/AppConfig';
import { refreshAllScheduleForms } from '../common/ScheduleWidgetService';
import { requestNativeScheduleOpen } from '../schedule/NativeScheduleHost';

export default class EntryAbility extends UIAbility {
  private mainWindow?: window.Window;

  private updateSafeInsets(): void {
    if (!this.mainWindow) return;
    const system = this.mainWindow.getWindowAvoidArea(window.AvoidAreaType.TYPE_SYSTEM);
    const navigation = this.mainWindow.getWindowAvoidArea(window.AvoidAreaType.TYPE_NAVIGATION_INDICATOR);
    AppStorage.setOrCreate('systemTopInsetPx', system.topRect.height);
    AppStorage.setOrCreate('systemBottomInsetPx', Math.max(system.bottomRect.height, navigation.bottomRect.height));
  }
  private applyWant(want: Want, initial: boolean): void {
    const routedUrl = String(want.parameters?.targetUrl ?? '');
    const deepLinkUrl = destinationUrlForDeepLink(want.uri || routedUrl);
    if (initial) {
      AppStorage.setOrCreate('launchUrl', APP_URL);
      AppStorage.setOrCreate('nativeTab', 0);
    }
    if (deepLinkUrl) {
      AppStorage.set('nativeTab', 2);
      requestNativeScheduleOpen();
    }
  }

  onCreate(want: Want, _launchParam: AbilityConstant.LaunchParam): void {
    AppStorage.setOrCreate('abilityContext', this.context);
    this.applyWant(want, true);
    void refreshAllScheduleForms(this.context).catch(() => undefined);
  }

  onNewWant(want: Want, _launchParam: AbilityConstant.LaunchParam): void {
    this.applyWant(want, false);
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    void windowStage.getMainWindow().then(async (mainWindow) => {
      this.mainWindow = mainWindow;
      await mainWindow.setWindowLayoutFullScreen(true);
      this.updateSafeInsets();
      mainWindow.on('avoidAreaChange', () => this.updateSafeInsets());
      windowStage.loadContent('pages/Index');
    }).catch(() => windowStage.loadContent('pages/Index'));
  }

  onWindowStageDestroy(): void {
    this.mainWindow?.off('avoidAreaChange');
    this.mainWindow = undefined;
  }
}
