import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";

export const SERVICE_TOOL_CODES = ["feedback", "questionnaire"] as const;
export type ServiceToolCode = typeof SERVICE_TOOL_CODES[number];

export const SERVICE_TOOL_META: Record<ServiceToolCode, { code: ServiceToolCode; name: string; description: string }> = {
  feedback: {
    code: "feedback",
    name: "需求反馈",
    description: "收集校园服务与小工具需求",
  },
  questionnaire: {
    code: "questionnaire",
    name: "在线问卷",
    description: "创建、发布和统计轻量问卷",
  },
};

export function isServiceToolCode(code: string): code is ServiceToolCode {
  return (SERVICE_TOOL_CODES as readonly string[]).includes(code);
}

export function isSiteAdmin(role?: string | null) {
  return role === "admin";
}

export async function hasToolManagePermission(toolCode: string, user?: { userId?: number; role?: string } | null) {
  if (!user?.userId) return false;
  if (isSiteAdmin(user.role)) return true;
  if (!isServiceToolCode(toolCode)) return false;
  const row = await prisma.toolPermission.findUnique({
    where: { toolCode_userId: { toolCode, userId: user.userId } },
    select: { id: true },
  });
  return Boolean(row);
}

export async function listManageableToolCodes(user?: { userId?: number; role?: string } | null) {
  if (!user?.userId) return [];
  if (isSiteAdmin(user.role)) return [...SERVICE_TOOL_CODES];
  const rows = await prisma.toolPermission.findMany({
    where: { userId: user.userId },
    select: { toolCode: true },
    orderBy: [{ toolCode: "asc" }],
  });
  return rows.map((row) => row.toolCode).filter(isServiceToolCode);
}

export function managerSelect() {
  return {
    id: true,
    toolCode: true,
    role: true,
    createdAt: true,
    user: {
      select: {
        id: true,
        username: true,
        nickname: true,
        avatar: true,
        role: true,
      },
    },
  } satisfies Prisma.ToolPermissionSelect;
}
