const backLink = document.getElementById('policy-back-link');
if (backLink && document.referrer && window.history.length > 1) {
  try {
    const previousPage = new URL(document.referrer);
    if (previousPage.origin === window.location.origin && previousPage.href !== window.location.href) {
      backLink.addEventListener('click', (event) => {
        event.preventDefault();
        window.history.back();
      });
    }
  } catch {
    // 没有可用的同站来源时，保留链接自带的回退地址。
  }
}

const toc = document.querySelector('.legal-toc');
if (toc) {
  // 桌面端目录常开；手机上默认收起，点了目录项就收回去。
  const wide = window.matchMedia('(min-width: 901px)');
  const syncOpen = () => { toc.open = wide.matches; };
  syncOpen();
  wide.addEventListener('change', syncOpen);
  toc.addEventListener('click', (event) => {
    if (!wide.matches && event.target instanceof Element && event.target.closest('a')) toc.open = false;
  });

  const entries = [...toc.querySelectorAll('a[href^="#"]')]
    .map((link) => ({ link, heading: document.getElementById(link.getAttribute('href').slice(1)) }))
    .filter((entry) => entry.heading);
  let queued = false;
  const markCurrent = () => {
    queued = false;
    const line = (document.querySelector('.legal-bar')?.offsetHeight || 0) + 24;
    let current = null;
    for (const entry of entries) {
      if (entry.heading.getBoundingClientRect().top <= line) current = entry;
    }
    for (const entry of entries) {
      if (entry === current) entry.link.setAttribute('aria-current', 'true');
      else entry.link.removeAttribute('aria-current');
    }
  };
  window.addEventListener('scroll', () => {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(markCurrent);
  }, { passive: true });
  markCurrent();
}
