import styles from "./schedule.css";

type Destination = { label: string; href: string };

const primaryDefaults: Destination[] = [
  { label: "首页", href: "/home" },
  { label: "公告", href: "/announcements" },
  { label: "教务", href: "/jwxt" },
  { label: "课表", href: "/schedule" },
  { label: "服务", href: "/services" }
];

function linkTo({ label, href }: Destination) {
  const link = document.createElement("a");
  link.href = href;
  link.textContent = label;
  if (new URL(link.href).pathname === "/schedule") link.setAttribute("aria-current", "page");
  return link;
}

function createHeader(brandName: string, primary: Destination[]) {
  const header = document.createElement("header");
  header.setAttribute("data-cpu-desktop-schedule-nav", "");
  const inner = document.createElement("div");
  const brand = linkTo({ label: brandName, href: "/home" });
  brand.className = "cpu-schedule-brand";
  const icon = document.createElement("img");
  icon.src = "/favicon.svg";
  icon.alt = "";
  brand.prepend(icon);

  const nav = document.createElement("nav");
  nav.setAttribute("aria-label", "主导航");
  const menu = document.createElement("div");
  menu.popover = "auto";
  menu.className = "cpu-schedule-more";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.textContent = "更多";
  toggle.popoverTargetElement = menu;

  for (const destination of primary) {
    nav.append(linkTo(destination));
    const compactLink = linkTo(destination);
    compactLink.className = "cpu-schedule-compact-link";
    menu.append(compactLink);
  }
  for (const destination of [{ label: "消息", href: "/messages" }, { label: "我的", href: "/profile" }]) {
    if (!primary.some(item => new URL(item.href, location.origin).pathname === destination.href)) {
      menu.append(linkTo(destination));
    }
  }
  nav.append(toggle, menu);
  inner.append(brand, nav);
  header.append(inner);
  return header;
}

export function installDesktopSchedule() {
  const expanded = matchMedia("(min-width: 769px)");
  const navigation = (window as Window & { navigation?: EventTarget }).navigation;
  let primary = primaryDefaults;
  let brandName = "药大拾间";
  let mounted: { root: HTMLElement; header: HTMLElement } | undefined;
  let sheet: CSSStyleSheet | undefined;

  // Save just the visible destinations of the site's own navigation before Vue unmounts its header.
  // They retain the site's visibility rules. A direct link to the timetable uses the public defaults.
  function rememberNavigation() {
    const header = document.querySelector(".layout-root > header.topbar");
    if (!header) return;
    const destinations: Destination[] = [];
    for (const link of header.querySelectorAll<HTMLAnchorElement>(".top-nav > a[href]")) {
      const label = link.textContent?.trim();
      const url = new URL(link.href);
      if (label && url.origin === location.origin && !url.username && !url.password) {
        destinations.push({ label, href: url.href });
      }
    }
    if (destinations.length) primary = destinations;
    brandName = header.querySelector(".brand-name")?.textContent?.trim() || brandName;
  }

  function unmount() {
    if (!mounted) return;
    mounted.root.removeAttribute("data-cpu-desktop-schedule");
    mounted.header.remove();
    mounted = undefined;
  }

  function synchronize() {
    const page = document.querySelector<HTMLElement>(".layout-root > .main--bare .schedule-page");
    const main = page?.closest<HTMLElement>(".main--bare");
    const root = main?.parentElement;
    if (!root || !main || !page || page.classList.contains("has-site-header") || root.querySelector(":scope > header.topbar")) {
      unmount();
      return;
    }
    if (mounted?.root === root && mounted.header.parentElement === root) return;
    unmount();
    if (!sheet) {
      sheet = new CSSStyleSheet();
      sheet.replaceSync(styles);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    }
    const header = createHeader(brandName, primary);
    root.insertBefore(header, main);
    root.setAttribute("data-cpu-desktop-schedule", "");
    mounted = { root, header };
  }

  // The observer runs only on an expanded timetable. Vue can mount/remount the view after navigation.
  const observer = new MutationObserver(() => {
    if (isExpandedTimetable()) synchronize();
    else updateRoute();
  });
  function isExpandedTimetable() {
    return expanded.matches && /^\/schedule\/?$/.test(location.pathname);
  }
  function updateRoute() {
    observer.disconnect();
    if (!isExpandedTimetable()) {
      unmount();
      return;
    }
    observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    synchronize();
  }

  navigation?.addEventListener("navigate", rememberNavigation);
  navigation?.addEventListener("currententrychange", updateRoute);
  expanded.addEventListener("change", updateRoute);
  window.addEventListener("popstate", updateRoute);
  window.addEventListener("pageshow", updateRoute);
  updateRoute();
}
