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
    // 没有可用的同站来源时，保留链接的登录页回退地址。
  }
}
