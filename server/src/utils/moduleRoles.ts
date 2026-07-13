export const MODULE_ADMIN_ROLES = ["admin", "super_admin"] as const;

export type ModuleAdminRole = typeof MODULE_ADMIN_ROLES[number];
export type ModuleRoleKey = "voiceHubRole" | "lostFoundRole";

type ModuleRoleUser = {
  role?: string | null;
  voiceHubRole?: string | null;
  lostFoundRole?: string | null;
};

export function normalizeModuleAdminRole(value?: string | null): ModuleAdminRole | null {
  return value === "admin" || value === "super_admin" ? value : null;
}

export function hasModuleAdminRole(value?: string | null) {
  return normalizeModuleAdminRole(value) !== null;
}

export function isModuleSuperAdmin(user: ModuleRoleUser | null | undefined, key: ModuleRoleKey) {
  return user?.role === "admin" || normalizeModuleAdminRole(user?.[key]) === "super_admin";
}
