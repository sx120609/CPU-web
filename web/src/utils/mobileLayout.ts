import { onBeforeUnmount, onMounted, ref } from "vue";

const MOBILE_LAYOUT_QUERY = "(max-width: 768px)";

export function useMobileLayout() {
  const isMobileLayout = ref(typeof window !== "undefined" && window.matchMedia(MOBILE_LAYOUT_QUERY).matches);
  let mediaQuery: MediaQueryList | null = null;

  const sync = (event?: MediaQueryListEvent) => {
    isMobileLayout.value = event?.matches ?? Boolean(mediaQuery?.matches);
  };

  onMounted(() => {
    mediaQuery = window.matchMedia(MOBILE_LAYOUT_QUERY);
    sync();
    if (typeof mediaQuery.addEventListener === "function") mediaQuery.addEventListener("change", sync);
    else mediaQuery.addListener(sync);
  });

  onBeforeUnmount(() => {
    if (typeof mediaQuery?.removeEventListener === "function") mediaQuery.removeEventListener("change", sync);
    else mediaQuery?.removeListener(sync);
  });

  return isMobileLayout;
}
