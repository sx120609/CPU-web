import instance, { request, type RequestOptions } from "./request";

// 艾绒树洞接口。树洞的响应不进通用 GET 缓存（见 request.ts 的 defaultGetCacheTtl）。

export const TREEHOLE_CONSENT_VERSION = "2026-10-25";

export type TreeholeMode = "async" | "live";
export type TreeholeClaimStatus = "unclaimed" | "claimed" | "replied";
export type TreeholeBookingStatus = "pending" | "confirmed" | "rejected" | "cancelled" | "expired" | "done";

export const TREEHOLE_TOPICS = ["学业压力", "科研受阻", "情感", "人际关系", "家庭", "就业与未来", "身心健康", "其他"];
export type TreeholeTag = "normal" | "focus" | "crisis";
export type TreeholeRole = "visitor" | "host" | "admin";

export interface TreeholeShift {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

export interface TreeholeHelp {
  centerName: string;
  centerHotline: string;
  centerLocation: string;
  centerHours: string;
  crisisGuide: string;
  emergencyNote: string;
}

export interface TreeholeHost {
  id: number;
  code: string;
  name: string;
  intro: string;
  online: boolean;
  onlineUntil?: string | null;
  nextShiftAt: string | null;
  shifts?: TreeholeShift[];
  available?: boolean;
}

export interface TreeholeSession {
  id: number;
  mode: TreeholeMode;
  alias: string;
  status: "active" | "ended";
  role: TreeholeRole;
  createdAt: string;
  endedAt: string | null;
  lastMessageAt: string;
  unread: number;
  topics: string[];
  claimStatus: TreeholeClaimStatus;
  claimedAt: string | null;
  /** 留言待认领时为空 */
  host: TreeholeHost | null;
  contact: string | null;
  help: TreeholeHelp | null;
  tag?: TreeholeTag;
  crisis?: { id: number; status: string } | null;
  preview?: string;
}

export interface TreeholeImageRef {
  id: number;
  width: number;
  height: number;
}

export interface TreeholeRoomInvite {
  id: number;
  name: string;
  category: string;
  categoryLabel: string;
  intro: string;
  status: string;
  joined: boolean;
  application: { status: string; rejectReason: string | null } | null;
}

export interface TreeholeMessage {
  id: number;
  sender: "visitor" | "host" | "system";
  mine: boolean;
  kind: "text" | "image" | "room-invite" | "notice";
  content: string;
  image: TreeholeImageRef | null;
  room: TreeholeRoomInvite | null;
  createdAt: string;
}

export interface TreeholeRoomSummary {
  id: number;
  name: string;
  category: string;
  categoryLabel: string;
  intro: string;
  alias?: string;
  unread?: number;
  lastMessageAt?: string;
}

export interface TreeholeMe {
  consent: { agreed: boolean; version: string };
  open: boolean;
  studentOnly: boolean;
  eligible: boolean;
  canStart: boolean;
  help: TreeholeHelp;
  roles: { host: boolean; admin: boolean; siteAdmin: boolean };
  sessions: TreeholeSession[];
  rooms: TreeholeRoomSummary[];
  applications: Array<{ id: number; status: string; rejectReason: string | null; createdAt: string; room: { id: number; name: string; categoryLabel: string } }>;
}

export interface TreeholeSessionDetail {
  session: TreeholeSession;
  messages: TreeholeMessage[];
  hasMore: boolean;
  inviteRooms?: Array<{ id: number; name: string; category: string; categoryLabel: string }>;
}

export interface TreeholeRoomMessage {
  id: number;
  memberId: number;
  alias: string;
  isHost: boolean;
  mine: boolean;
  kind: "text" | "image" | "notice";
  content: string;
  image: TreeholeImageRef | null;
  recalled: boolean;
  createdAt: string;
}

export interface TreeholeRoomInfo {
  id: number;
  name: string;
  category: string;
  categoryLabel: string;
  intro: string;
  status: "active" | "closed";
  closeReason: string | null;
  createdAt: string;
}

export interface TreeholeRoomDetail {
  room: TreeholeRoomInfo;
  me: { memberId: number; alias: string; role: "host" | "visitor" } | null;
  isRoomAdmin: boolean;
  isCoreAdmin: boolean;
  canModerate: boolean;
  readOnly: boolean;
  visitorCount: number;
  hostCount: number;
  messages: TreeholeRoomMessage[];
  hasMore: boolean;
}

export interface TreeholeRoomApplication {
  id: number;
  status: string;
  note: string;
  visitorAlias: string;
  recommendedBy: string;
  reviewer: string | null;
  reviewedAt: string | null;
  rejectReason: string | null;
  createdAt: string;
}

export interface TreeholeRoomMember {
  id: number;
  alias: string;
  role: "host" | "visitor";
  seq: number | null;
  recommendedBy: string | null;
  joinedAt: string;
  mine: boolean;
}

export interface TreeholePresence {
  online: boolean;
  source: "schedule" | "manual" | "disabled";
  until: string | null;
  inShift: boolean;
  nextShiftAt: string | null;
}

export interface TreeholeBooking {
  id: number;
  startAt: string;
  endAt: string;
  status: TreeholeBookingStatus;
  place: string;
  note: string;
  host: { id: number; code: string; name: string };
  alias: string | null;
  rejectReason: string | null;
  cancelledBy: "visitor" | "host" | null;
  cancelReason: string | null;
  createdAt: string;
  decidedAt: string | null;
  cancellable: boolean;
}

export interface TreeholeScheduleHost {
  id: number;
  code: string;
  name: string;
  intro: string;
  online: boolean;
  mine: boolean;
  shifts: TreeholeShift[];
  slots: Array<{ startAt: string; endAt: string; available: boolean }>;
}

export interface TreeholeSchedule {
  slotMinutes: number;
  days: number;
  place: string;
  hosts: TreeholeScheduleHost[];
}

export interface TreeholePoolItem {
  id: number;
  alias: string;
  topics: string[];
  createdAt: string;
  preview: string;
}

export interface TreeholeRoomCard extends TreeholeRoomInfo {
  visitorCount: number;
  hostCount: number;
  joined: boolean;
  removed: boolean;
  lastMessageAt: string;
}

export interface TreeholeHostOverview {
  profile: {
    id: number;
    code: string;
    name: string;
    hostNickname: string;
    intro: string;
    isAdmin: boolean;
    presence: TreeholePresence;
    shifts: TreeholeShift[];
  };
  activeSessions: TreeholeSession[];
  endedSessions: TreeholeSession[];
  rooms: Array<TreeholeRoomSummary & { memberCount: number; hostCount: number; joined: boolean }>;
  poolCount: number;
  pendingBookings: number;
}

export interface TreeholeCrisisInput {
  crisisType: string;
  urgency: "normal" | "high" | "urgent";
  currentState: string;
  hostRecord: string;
  requestReveal: boolean;
  revealReason: string;
}

export interface TreeholeCaseSummary {
  id: number;
  status: "open" | "following" | "closed";
  urgency: "normal" | "high" | "urgent";
  crisisType: string;
  reporter: string | null;
  session: { id: number; alias: string; status: string; contact: string | null };
  hasContact: boolean;
  notes: number;
  pendingReveal: boolean;
  revealed: boolean;
  createdAt: string;
}

export interface TreeholeReveal {
  id: number;
  status: "pending" | "approved" | "rejected";
  reason: string;
  requester: string | null;
  approvals: Array<{ by: string | null; at: string }>;
  approvalCount: number;
  required: number;
  approvedByMe: boolean;
  rejectedBy: string | null;
  rejectReason: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface TreeholeCaseDetail {
  id: number;
  status: "open" | "following" | "closed";
  urgency: "normal" | "high" | "urgent";
  crisisType: string;
  currentState: string;
  hostRecord: string;
  reporter: string | null;
  createdAt: string;
  closedAt: string | null;
  session: { id: number; alias: string; status: string; mode: string; contact: string | null; contactAt: string | null; createdAt: string; host: string | null };
  notes: Array<{ id: number; author: string | null; content: string; createdAt: string }>;
  reveals: TreeholeReveal[];
}

export interface TreeholeIdentity {
  deleted: boolean;
  studentId: string | null;
  studentVerified: boolean;
  nickname: string | null;
  college: string | null;
  enrollYear: number | null;
  email: string | null;
  lastLoginAt: string | null;
  registeredAt: string;
}

export interface TreeholeStaffRow {
  id: number;
  user: { id: number; username: string; nickname: string; status: string };
  isHost: boolean;
  isAdmin: boolean;
  hostCode: string | null;
  hostNickname: string;
  name: string | null;
  intro: string;
  enabled: boolean;
  online: boolean;
  presenceSource: string;
  shifts: TreeholeShift[];
  createdAt: string;
}

export interface TreeholeAdminRoom {
  id: number;
  name: string;
  category: string;
  categoryLabel: string;
  intro: string;
  status: "active" | "closed";
  closeReason: string | null;
  closedAt: string | null;
  createdAt: string;
  lastMessageAt: string;
  visitorCount: number;
  hostCount: number;
  founders: Array<string | null>;
  messageCount: number;
}

export interface TreeholeStats {
  days: number;
  sessions: { total: number; async: number; live: number; unclaimed: number; replied: number; focus: number; crisis: number; ended: number; activeNow: number };
  topics: Array<{ topic: string; count: number }>;
  bookings: { total: number; pending: number; confirmed: number; done: number; cancelled: number };
  cases: { total: number; urgent: number; high: number; openNow: number };
  hosts: Array<{ code: string | null; name: string; enabled: boolean; online: boolean; sessions: number; bookings: number }>;
  rooms: Array<{ id: number; name: string; categoryLabel: string; status: string; members: number; messages: number }>;
  daily: Array<{ date: string; sessions: number }>;
}

export interface TreeholeAuditRow {
  id: number;
  actorUserId: number;
  actorLabel: string;
  action: string;
  targetType: string;
  targetId: number | null;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface TreeholeConfig extends TreeholeHelp {
  open: boolean;
  studentOnly: boolean;
  bookingPlace: string;
  roomRules: string;
}

type Page<T> = { total: number; page: number; size: number; list: T[] };

const quiet: RequestOptions = { suppressErrorMessage: true };

export const treeholeApi = {
  me: () => request.get<TreeholeMe>("/treehole/me"),
  consent: () => request.post<{ agreed: boolean }>("/treehole/consent", { version: TREEHOLE_CONSENT_VERSION }),
  hosts: () => request.get<{ hosts: TreeholeHost[] }>("/treehole/hosts"),
  uploadImage: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request.post<TreeholeImageRef>("/treehole/images", form, { timeout: 60_000 });
  },
  imageBlob: (id: number) => instance.get<unknown, Blob>(`/treehole/images/${id}`, { responseType: "blob", suppressErrorMessage: true } as RequestOptions),

  createSession: (payload: { topics: string[]; content: string; imageId: number | null }) =>
    request.post<{ id: number }>("/treehole/sessions", { mode: "async", ...payload }),
  pool: () => request.get<{ online: boolean; total: number; list: TreeholePoolItem[] }>("/treehole/host/pool"),
  claim: (id: number) => request.post<{ id: number }>(`/treehole/sessions/${id}/claim`),
  release: (id: number) => request.post<{ released: boolean }>(`/treehole/sessions/${id}/release`),
  setTopics: (id: number, topics: string[]) => request.post<{ topics: string[] }>(`/treehole/sessions/${id}/topics`, { topics }),

  schedule: () => request.get<TreeholeSchedule>("/treehole/schedule"),
  book: (payload: { hostId: number; startAt: string; note: string }) => request.post<TreeholeBooking>("/treehole/bookings", payload),
  myBookings: () => request.get<TreeholeBooking[]>("/treehole/bookings/mine"),
  hostBookings: () => request.get<{ upcoming: TreeholeBooking[]; past: TreeholeBooking[] }>("/treehole/host/bookings"),
  confirmBooking: (id: number) => request.post<TreeholeBooking>(`/treehole/bookings/${id}/confirm`),
  rejectBooking: (id: number, reason: string) => request.post<TreeholeBooking>(`/treehole/bookings/${id}/reject`, { reason }),
  cancelBooking: (id: number, reason = "") => request.post<TreeholeBooking>(`/treehole/bookings/${id}/cancel`, { reason }),
  adminBookings: (params: { status?: string; page: number }) => request.get<Page<TreeholeBooking>>("/treehole/admin/bookings", params),
  session: (id: number) => request.get<TreeholeSessionDetail>(`/treehole/sessions/${id}`),
  sessionMessages: (id: number, params: { after?: number; before?: number }) =>
    request.get<{ session: TreeholeSession; messages: TreeholeMessage[]; hasMore: boolean }>(`/treehole/sessions/${id}/messages`, params, quiet),
  send: (id: number, payload: { content: string; imageId: number | null }) => request.post<TreeholeMessage>(`/treehole/sessions/${id}/messages`, payload),
  endSession: (id: number) => request.post<{ ended: boolean }>(`/treehole/sessions/${id}/end`),
  leaveContact: (id: number, contact: string) => request.post<{ saved: boolean }>(`/treehole/sessions/${id}/contact`, { contact }),
  setTag: (id: number, tag: TreeholeTag, crisis?: TreeholeCrisisInput) => request.post<{ tag: TreeholeTag; caseId?: number }>(`/treehole/sessions/${id}/tag`, { tag, crisis }),
  inviteRoom: (id: number, roomId: number) => request.post<TreeholeMessage>(`/treehole/sessions/${id}/room-invites`, { roomId }),

  hostOverview: () => request.get<TreeholeHostOverview>("/treehole/host/overview"),
  hostSessions: (params: { status: "active" | "ended"; page: number }) => request.get<Page<TreeholeSession>>("/treehole/host/sessions", params),
  setPresence: (action: "online" | "offline") => request.post<TreeholePresence>("/treehole/host/presence", { action }),
  updateHostProfile: (payload: { intro?: string; hostNickname?: string }) =>
    request.patch<{ intro: string; hostNickname: string; name: string }>("/treehole/host/profile", payload),

  room: (id: number) => request.get<TreeholeRoomDetail>(`/treehole/rooms/${id}`),
  roomMessages: (id: number, params: { after?: number; before?: number }) =>
    request.get<{ room: TreeholeRoomInfo; messages: TreeholeRoomMessage[]; recalledIds: number[]; hasMore: boolean; memberActive: boolean }>(`/treehole/rooms/${id}/messages`, params, quiet),
  sendRoom: (id: number, payload: { content: string; imageId: number | null }) => request.post<TreeholeRoomMessage>(`/treehole/rooms/${id}/messages`, payload),
  leaveRoom: (id: number) => request.post<{ left: boolean }>(`/treehole/rooms/${id}/leave`),
  enterRoom: (id: number) => request.post<{ memberId: number }>(`/treehole/rooms/${id}/enter`),
  closeRoom: (id: number, reason: string) => request.post<{ closed: boolean }>(`/treehole/rooms/${id}/close`, { reason }),
  roomMembers: (id: number) => request.get<TreeholeRoomMember[]>(`/treehole/rooms/${id}/members`),
  removeMember: (roomId: number, memberId: number, reason: string) => request.post<{ removed: boolean }>(`/treehole/rooms/${roomId}/members/${memberId}/remove`, { reason }),
  recallRoomMessage: (roomId: number, messageId: number) => request.post<{ recalled: boolean }>(`/treehole/rooms/${roomId}/messages/${messageId}/recall`),
  rooms: (category?: string) => request.get<{ rules: string; categories: Array<{ value: string; label: string }>; rooms: TreeholeRoomCard[] }>("/treehole/rooms", category ? { category } : undefined),
  createRoom: (payload: { name: string; category: string; intro: string }) => request.post<{ id: number }>("/treehole/rooms", payload),
  joinRoom: (id: number) => request.post<{ memberId: number; alias: string }>(`/treehole/rooms/${id}/join`, { agree: true }),

  adminOverview: () => request.get<{ isAdmin: boolean; isSiteAdmin: boolean; counts: { openCases: number; pendingReveals: number; activeSessions: number; activeRooms: number } | null }>("/treehole/admin/overview"),
  adminSessions: (params: { tag?: string; status?: string; mode?: string; claim?: string; topic?: string; page: number }) => request.get<Page<TreeholeSession>>("/treehole/admin/sessions", params),
  adminCases: (status: string) => request.get<TreeholeCaseSummary[]>("/treehole/admin/cases", { status }),
  adminCase: (id: number) => request.get<TreeholeCaseDetail>(`/treehole/admin/cases/${id}`),
  addCaseNote: (id: number, content: string) => request.post<TreeholeCaseDetail>(`/treehole/admin/cases/${id}/notes`, { content }),
  setCaseStatus: (id: number, status: string) => request.patch<TreeholeCaseDetail>(`/treehole/admin/cases/${id}`, { status }),
  requestReveal: (id: number, reason: string) => request.post<TreeholeCaseDetail>(`/treehole/admin/cases/${id}/reveals`, { reason }),
  approveReveal: (id: number) => request.post<TreeholeCaseDetail>(`/treehole/admin/reveals/${id}/approve`),
  rejectReveal: (id: number, reason: string) => request.post<TreeholeCaseDetail>(`/treehole/admin/reveals/${id}/reject`, { reason }),
  revealIdentity: (id: number) => request.get<TreeholeIdentity>(`/treehole/admin/reveals/${id}/identity`),
  staff: () => request.get<TreeholeStaffRow[]>("/treehole/admin/staff"),
  appointStaff: (payload: { username: string; isHost: boolean; isAdmin: boolean; hostCode: string }) => request.post<TreeholeStaffRow>("/treehole/admin/staff", payload),
  updateStaff: (id: number, payload: Partial<{ isHost: boolean; isAdmin: boolean; hostCode: string; hostNickname: string; enabled: boolean; intro: string }>) => request.patch<TreeholeStaffRow>(`/treehole/admin/staff/${id}`, payload),
  saveShifts: (id: number, shifts: TreeholeShift[]) => request.put<TreeholeStaffRow>(`/treehole/admin/staff/${id}/shifts`, { shifts }),
  adminRooms: () => request.get<TreeholeAdminRoom[]>("/treehole/admin/rooms"),
  stats: (days: number) => request.get<TreeholeStats>("/treehole/admin/stats", { days }),
  audit: (params: { page: number; action?: string }) => request.get<Page<TreeholeAuditRow>>("/treehole/admin/audit", params),
  config: () => request.get<TreeholeConfig>("/treehole/admin/config"),
  saveConfig: (payload: TreeholeConfig) => request.put<TreeholeConfig>("/treehole/admin/config", payload),
};
