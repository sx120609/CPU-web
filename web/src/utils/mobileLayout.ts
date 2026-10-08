import { computed, type ComputedRef } from "vue";
import { PHONE_MAX_QUERY } from "./formFactorCore";
import { useFormFactor } from "./formFactor";

/** The phone media query; touch tablets below 1024 px and native shells are compact as well (see formFactor). */
export const MOBILE_LAYOUT_QUERY = PHONE_MAX_QUERY;

/** True while the phone component tree is rendered. Read-only: it follows the shared form-factor classifier. */
export function useMobileLayout(): ComputedRef<boolean> {
  const formFactor = useFormFactor();
  return computed(() => formFactor.value.compact);
}
