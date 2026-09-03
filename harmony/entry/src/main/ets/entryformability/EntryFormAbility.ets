import Want from '@ohos.app.ability.Want';
import { formBindingData, FormExtensionAbility, formInfo } from '@kit.FormKit';
import {
  initialScheduleWidgetBinding,
  refreshRegisteredScheduleForm,
  registerScheduleForm,
  removeScheduleForm
} from '../common/ScheduleWidgetService';

const FORM_ID_KEY = 'ohos.extra.param.key.form_identity';
const FORM_DIMENSION_KEY = 'ohos.extra.param.key.form_dimension';
const FORM_NAME_KEY = 'ohos.extra.param.key.form_name';

export default class EntryFormAbility extends FormExtensionAbility {
  onAddForm(want: Want): formBindingData.FormBindingData {
    const formId = String(want.parameters?.[FORM_ID_KEY] ?? '');
    const dimension = Number(want.parameters?.[FORM_DIMENSION_KEY] ?? formInfo.FormDimension.Dimension_2_2);
    const formName = String(want.parameters?.[FORM_NAME_KEY] ?? 'schedule');
    if (formId) {
      void registerScheduleForm(this.context, formId, dimension, formName)
        .then(() => refreshRegisteredScheduleForm(this.context, formId))
        .catch(() => undefined);
    }
    return formBindingData.createFormBindingData(initialScheduleWidgetBinding(dimension, formName));
  }

  onUpdateForm(formId: string): void {
    void refreshRegisteredScheduleForm(this.context, formId).catch(() => undefined);
  }

  onRemoveForm(formId: string): void {
    void removeScheduleForm(this.context, formId).catch(() => undefined);
  }

  onAcquireFormState(_want: Want): formInfo.FormState {
    return formInfo.FormState.READY;
  }
}
