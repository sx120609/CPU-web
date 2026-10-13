import { createWorkshopSDK, createLocalPreviewSDK } from "./workshop/sdk.js";

const preview =
  window.parent === window &&
  new URLSearchParams(location.search).get("preview") === "1";
const sdk = preview
  ? createLocalPreviewSDK({ appId: "my-extension", type: "extension" })
  : createWorkshopSDK();
const status = document.querySelector("#status");
try {
  const environment = await sdk.getEnvironment();
  status.textContent = `已连接：${environment.name}（${environment.slot}）`;
} catch (error) {
  status.textContent = error.message;
}
document.querySelector("#close").addEventListener("click", async () => {
  try {
    await sdk.close();
  } catch (error) {
    status.textContent = error.message;
  }
});
