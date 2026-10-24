import instance, { request, type RequestOptions } from "./request";

// 艾绒树洞接口。树洞的响应不进通用 GET 缓存（见 request.ts 的 defaultGetCacheTtl）。

export const TREEHOLE_CONSENT_VERSION = "2026-10-25";

export type TreeholeMode = "async" | "live";
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
  host: TreeholeHost;
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

export interface TreeholeHostOverview {
  profile: {
    id: number;
    code: string;
    name: string;
    intro: string;
    isAdmin: boolean;
    presence: TreeholePresence;
    shifts: TreeholeShift[];
  };
  activeSessions: TreeholeSession[];
  endedSessions: TreeholeSession[];
  rooms: Array<TreeholeRoomSummary & { memberCount: number; hostCount: number; joined: boolean; pendingApplications: number }>;
  proposals: Array<{ id: number; name: string; category: string; categoryLabel: string; intro: string; proposer: string; signers: string[]; signed: boolean; mine: boolean; createdAt: string }>;
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
  applicationCount: number;
  pendingApplications: number;
}

export interface TreeholeStats {
  days: number;
  sessions: { total: number; async: number; live: number; focus: number; crisis: number; ended: number; activeNow: number };
  cases: { total: number; urgent: number; high: number; openNow: number };
  hosts: Array<{ code: string | null; name: string; enabled: boolean; online: boolean; sessions: number }>;
  rooms: Array<{ id: number; name: string; categoryLabel: string; status: string; members: number; messages: number }>;
  applications: Record<string, number>;
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

  createSession: (payload: { mode: TreeholeMode; hostId: number | null; content: string; imageId: number | null }) =>
    request.post<{ id: number }>("/treehole/sessions", payload),
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
  updateHostProfile: (intro: string) => request.patch<{ intro: string }>("/treehole/host/profile", { intro }),

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
  roomApplications: (roomId: number, status: "pending" | "all") => request.get<TreeholeRoomApplication[]>(`/treehole/rooms/${roomId}/applications`, { status }),
  applyRoom: (messageId: number, note: string) => request.post<{ id: number; status: string }>("/treehole/room-applications", { messageId, note }),
  cancelApplication: (id: number) => request.post<{ cancelled: boolean }>(`/treehole/room-applications/${id}/cancel`),
  reviewApplication: (id: number, approve: boolean, reason = "") => request.post<{ status: string; alias: string | null }>(`/treehole/room-applications/${id}/review`, { approve, reason }),
  proposeRoom: (payload: { name: string; category: string; intro: string }) => request.post<{ id: number }>("/treehole/room-proposals", payload),
  signProposal: (id: number) => request.post<{ created: boolean; roomId: number | null; signatures: number }>(`/treehole/room-proposals/${id}/sign`),
  cancelProposal: (id: number) => request.post<{ cancelled: boolean }>(`/treehole/room-proposals/${id}/cancel`),

  adminOverview: () => request.get<{ isAdmin: boolean; isSiteAdmin: boolean; counts: { openCases: number; pendingReveals: number; activeSessions: number; activeRooms: number } | null }>("/treehole/admin/overview"),
  adminSessions: (params: { tag?: string; status?: string; mode?: string; page: number }) => request.get<Page<TreeholeSession>>("/treehole/admin/sessions", params),
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
  updateStaff: (id: number, payload: Partial<{ isHost: boolean; isAdmin: boolean; hostCode: string; enabled: boolean; intro: string }>) => request.patch<TreeholeStaffRow>(`/treehole/admin/staff/${id}`, payload),
  saveShifts: (id: number, shifts: TreeholeShift[]) => request.put<TreeholeStaffRow>(`/treehole/admin/staff/${id}/shifts`, { shifts }),
  adminRooms: () => request.get<TreeholeAdminRoom[]>("/treehole/admin/rooms"),
  stats: (days: number) => request.get<TreeholeStats>("/treehole/admin/stats", { days }),
  audit: (params: { page: number; action?: string }) => request.get<Page<TreeholeAuditRow>>("/treehole/admin/audit", params),
  config: () => request.get<TreeholeConfig>("/treehole/admin/config"),
  saveConfig: (payload: TreeholeConfig) => request.put<TreeholeConfig>("/treehole/admin/config", payload),
};
