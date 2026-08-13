export type AcademicIdentity = "undergraduate" | "graduate";

const ACADEMIC_IDENTITY_KEY = "cpu-academic-identity-v1";
const ACADEMIC_IDENTITY_UNAVAILABLE_KEY_PREFIX = "cpu-academic-identity-unavailable-v1";

export const DEFAULT_ACADEMIC_IDENTITY: AcademicIdentity = "undergraduate";

export const academicIdentityOptions: Array<{
  value: AcademicIdentity;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  {
    value: "undergraduate",
    label: "本科生",
    shortLabel: "本",
    description: "课表、成绩、培养方案",
  },
  {
    value: "graduate",
    label: "研究生",
    shortLabel: "研",
    description: "当前先支持课表",
  },
];

export function normalizeAcademicIdentity(value: unknown): AcademicIdentity {
  return value === "graduate" ? "graduate" : DEFAULT_ACADEMIC_IDENTITY;
}

export function readAcademicIdentity(): AcademicIdentity | null {
  try {
    const stored = localStorage.getItem(ACADEMIC_IDENTITY_KEY);
    if (!stored) return null;
    return normalizeAcademicIdentity(stored);
  } catch {
    return null;
  }
}

export function writeAcademicIdentity(value: AcademicIdentity) {
  try {
    localStorage.setItem(ACADEMIC_IDENTITY_KEY, normalizeAcademicIdentity(value));
  } catch {
    /* ignore */
  }
}

export function clearAcademicIdentity() {
  try {
    localStorage.removeItem(ACADEMIC_IDENTITY_KEY);
  } catch {
    /* ignore */
  }
}

function academicIdentityUnavailableKey(username: string) {
  const normalized = username.trim().toLowerCase();
  return normalized
    ? `${ACADEMIC_IDENTITY_UNAVAILABLE_KEY_PREFIX}:${encodeURIComponent(normalized)}`
    : "";
}

export function readAcademicIdentityUnavailable(username?: string | null) {
  if (!username) return false;
  try {
    const key = academicIdentityUnavailableKey(username);
    return Boolean(key && localStorage.getItem(key) === "1");
  } catch {
    return false;
  }
}

export function writeAcademicIdentityUnavailable(username?: string | null, unavailable = true) {
  if (!username) return;
  try {
    const key = academicIdentityUnavailableKey(username);
    if (!key) return;
    if (unavailable) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function academicIdentityLabel(value: AcademicIdentity) {
  return value === "graduate" ? "研究生" : "本科生";
}

export function isGraduateAcademicIdentity(value: AcademicIdentity) {
  return value === "graduate";
}
