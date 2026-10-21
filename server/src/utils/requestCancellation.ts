import type { Request, Response } from "express";

/** Cancel work that has not started when the HTTP caller leaves. Running work
 * keeps its capacity permit until it actually settles. */
export function requestCancellation(req: Request, res: Response) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const close = () => { if (!res.writableFinished) abort(); };
  req.once("aborted", abort);
  res.once("close", close);
  if (req.aborted || res.destroyed) abort();
  return {
    signal: controller.signal,
    dispose() { req.off("aborted", abort); res.off("close", close); },
  };
}
