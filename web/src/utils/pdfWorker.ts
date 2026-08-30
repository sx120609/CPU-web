export function resolvePdfWorkerUrl(bundledWorkerUrl: string, pageOrigin: string) {
  const worker = new URL(bundledWorkerUrl, pageOrigin);
  const page = new URL(pageOrigin);
  return new URL(`${worker.pathname}${worker.search}${worker.hash}`, page.origin).toString();
}
