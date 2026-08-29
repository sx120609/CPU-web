const pendingClass = "cpu-image-pending";
const readyClass = "cpu-image-ready";
const errorClass = "cpu-image-error";

let installed = false;

function settleImage(image: HTMLImageElement, ready: boolean) {
  image.classList.remove(pendingClass, readyClass, errorClass);
  image.classList.add(ready ? readyClass : errorClass);
}

function prepareImage(image: HTMLImageElement) {
  if (!image.hasAttribute("decoding")) image.decoding = "async";
  if (!image.hasAttribute("loading") && image.dataset.imageEager !== "true") image.loading = "lazy";

  const source = image.currentSrc || image.getAttribute("src") || image.getAttribute("srcset") || "";
  if (!source) return;
  if (image.complete) {
    settleImage(image, image.naturalWidth > 0 && image.naturalHeight > 0);
    return;
  }
  image.classList.remove(readyClass, errorClass);
  image.classList.add(pendingClass);
}

function prepareTree(node: Node) {
  if (node instanceof HTMLImageElement) prepareImage(node);
  if (!(node instanceof Element || node instanceof Document)) return;
  node.querySelectorAll<HTMLImageElement>("img").forEach(prepareImage);
}

export function installUnifiedImageLoading() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  document.addEventListener("load", (event) => {
    if (event.target instanceof HTMLImageElement) settleImage(event.target, true);
  }, true);
  document.addEventListener("error", (event) => {
    if (event.target instanceof HTMLImageElement) settleImage(event.target, false);
  }, true);
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        if (mutation.target instanceof HTMLImageElement) prepareImage(mutation.target);
        continue;
      }
      mutation.addedNodes.forEach(prepareTree);
    }
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["src", "srcset"],
  });
  prepareTree(document);
}
