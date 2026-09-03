import Want from '@ohos.app.ability.Want';
import { formBindingData, FormExtensionAbility, formInfo } from '@kit.FormKit';
import {
  initialScheduleWidgetBinding,
  refreshScheduleForm,
  registerScheduleForm,
  removeScheduleForm,
  scheduleFormDimension
} from '../common/ScheduleWidgetService';

const FORM_ID_KEY = 'ohos.extra.param.key.form_identity';
const FORM_DIMENSION_KEY = 'ohos.extra.param.key.form_dimension';

export default class EntryFormAbility extends FormExtensionAbility {
  onAddForm(want: Want): formBindingData.FormBindingData {
    const formId = String(want.parameters?.[FORM_ID_KEY] ?? '');
    const dimension = Number(want.parameters?.[FORM_DIMENSION_KEY] ?? formInfo.FormDimension.Dimension_2_2);
    if (formId) {
      void registerScheduleForm(this.context, formId, dimension)
        .then(() => refreshScheduleForm(this.context, formId, dimension))
        .catch(() => undefined);
    }
    return formBindingData.createFormBindingData(initialScheduleWidgetBinding(dimension));
  }

  onUpdateForm(formId: string): void {
    void scheduleFormDimension(this.context, formId)
      .then((dimension: number) => refreshScheduleForm(this.context, formId, dimension))
      .catch(() => undefined);
  }

  onRemoveForm(formId: string): void {
    void removeScheduleForm(this.context, formId).catch(() => undefined);
  }

  onAcquireFormState(_want: Want): formInfo.FormState {
    return formInfo.FormState.READY;
  }
}
