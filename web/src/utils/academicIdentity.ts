export type AcademicIdentity = "undergraduate" | "graduate";

const ACADEMIC_IDENTITY_KEY = "cpu-academic-identity-v1";

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

export function readAcademicIdentity(): AcademicIdentity {
  try {
    return normalizeAcademicIdentity(localStorage.getItem(ACADEMIC_IDENTITY_KEY));
  } catch {
    return DEFAULT_ACADEMIC_IDENTITY;
  }
}

export function writeAcademicIdentity(value: AcademicIdentity) {
  try {
    localStorage.setItem(ACADEMIC_IDENTITY_KEY, normalizeAcademicIdentity(value));
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
