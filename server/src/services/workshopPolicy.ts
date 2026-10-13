import { Errors } from "../utils/response";

export type WorkshopViewer = { userId: number; role: string };
export type WorkshopPolicyWork = {
  id: string;
  authorId: number;
  disabled: boolean;
  publishedVersionId: string | null;
  runtimeRevision: number;
};
export type WorkshopPolicyVersion = { id: string; workId: string; status: string; runtimeRevision: number };

export function isWorkshopAdmin(viewer?: WorkshopViewer) {
  return viewer?.role === "admin";
}
export function canManageWorkshop(work: Pick<WorkshopPolicyWork, "authorId">, viewer?: WorkshopViewer) {
  return Boolean(viewer && (viewer.userId === work.authorId || isWorkshopAdmin(viewer)));
}
export function assertWorkshopOwner(work: Pick<WorkshopPolicyWork, "authorId">, viewer: WorkshopViewer) {
  if (work.authorId !== viewer.userId) throw Errors.forbidden("只有作者可以提交作品版本");
}
export function assertWorkshopAdmin(viewer?: WorkshopViewer) {
  if (!isWorkshopAdmin(viewer)) throw Errors.forbidden("只有管理员可以审核和管理工坊作品");
}
export function assertWorkshopSubmission(
  work: WorkshopPolicyWork,
  version: WorkshopPolicyVersion,
  viewer: WorkshopViewer,
) {
  assertWorkshopOwner(work, viewer);
  if (work.disabled) throw Errors.forbidden("作品已被停用，请联系管理员");
  if (
    !["DRAFT", "REJECTED"].includes(version.status) &&
    !(version.status === "APPROVED" && work.publishedVersionId === null)
  ) {
    throw Errors.conflict("只有草稿、退回版本或已下架的版本可以提交审核");
  }
}
export function assertWorkshopReview(
  work: WorkshopPolicyWork,
  version: WorkshopPolicyVersion,
  viewer: WorkshopViewer,
) {
  assertWorkshopAdmin(viewer);
  if (work.disabled) throw Errors.conflict("请先启用作品再审核");
  if (version.status !== "PENDING") throw Errors.conflict("此版本已经审核或尚未提交");
}
export function isWorkshopPublished(
  work: WorkshopPolicyWork,
  version?: Pick<WorkshopPolicyVersion, "id" | "workId" | "status"> | null,
) {
  return (
    !work.disabled &&
    Boolean(
      version &&
      version.workId === work.id &&
      version.status === "APPROVED" &&
      work.publishedVersionId === version.id,
    )
  );
}

export type WorkshopRuntimeTicket = {
  kind: "public" | "preview";
  workId: string;
  versionId: string;
  workRevision: number;
  versionRevision: number;
  viewerId?: number;
  expires: number;
};
export function isWorkshopTicketCurrent(
  ticket: WorkshopRuntimeTicket,
  work: WorkshopPolicyWork,
  version: WorkshopPolicyVersion,
  viewer?: WorkshopViewer,
  now = Date.now(),
) {
  if (
    ticket.expires <= now ||
    ticket.workId !== work.id ||
    ticket.versionId !== version.id ||
    version.workId !== work.id ||
    ticket.workRevision !== work.runtimeRevision ||
    ticket.versionRevision !== version.runtimeRevision ||
    work.disabled
  )
    return false;
  if (ticket.kind === "public") return isWorkshopPublished(work, version);
  return Boolean(ticket.viewerId === viewer?.userId && canManageWorkshop(work, viewer));
}

export const WORKSHOP_SAVE_MAX_BYTES = 64 * 1024;
export const WORKSHOP_SAVE_ACCOUNT_BYTES = 2 * 1024 * 1024;
/** JSON wire size is also our quota measure; reject objects that cannot be JSON. */
export function workshopSaveBytes(data: unknown) {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(data);
  } catch {
    throw Errors.badRequest("存档必须是 JSON 数据");
  }
  if (encoded === undefined) throw Errors.badRequest("存档必须是 JSON 数据");
  const bytes = Buffer.byteLength(encoded, "utf8");
  if (bytes > WORKSHOP_SAVE_MAX_BYTES) throw Errors.badRequest("每件作品的存档最多 64 KiB");
  return bytes;
}
