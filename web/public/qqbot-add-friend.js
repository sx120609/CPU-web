(() => {
  const qq = new URLSearchParams(window.location.search).get("uin")?.replace(/\D/g, "") || "";
  const qqNumber = document.getElementById("qq-number");
  const actions = document.getElementById("actions");
  const hint = document.getElementById("hint");
  if (!/^\d{5,20}$/.test(qq)) {
    qqNumber.textContent = "账号信息无效";
    hint.textContent = "请返回药大拾间重新获取添加二维码。";
    hint.classList.add("error");
    return;
  }

  qqNumber.textContent = qq;
  actions.hidden = false;
  document.getElementById("open-qq").href = `mqqapi://card/show_pslcard?src_type=internal&version=1&uin=${qq}&card_type=person&source=sharecard`;
  document.getElementById("copy-qq").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    try {
      await navigator.clipboard.writeText(qq);
    } catch {
      const input = document.createElement("textarea");
      input.value = qq;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
    button.textContent = "已复制 QQ 号";
  });
})();
