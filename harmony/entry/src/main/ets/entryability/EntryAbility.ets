import UIAbility from '@ohos.app.ability.UIAbility';
import AbilityConstant from '@ohos.app.ability.AbilityConstant';
import Want from '@ohos.app.ability.Want';
import window from '@ohos.window';
import { APP_URL, destinationUrlForDeepLink } from '../common/AppConfig';

export default class EntryAbility extends UIAbility {
  private applyWant(want: Want, initial: boolean): void {
    const routedUrl = String(want.parameters?.targetUrl ?? '');
    const deepLinkUrl = destinationUrlForDeepLink(want.uri || routedUrl);
    if (initial) AppStorage.setOrCreate('launchUrl', APP_URL);
    if (deepLinkUrl) AppStorage.set('launchUrl', deepLinkUrl);
  }

  onCreate(want: Want, _launchParam: AbilityConstant.LaunchParam): void {
    AppStorage.setOrCreate('abilityContext', this.context);
    this.applyWant(want, true);
  }

  onNewWant(want: Want, _launchParam: AbilityConstant.LaunchParam): void {
    this.applyWant(want, false);
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    windowStage.loadContent('pages/Index');
  }
}
