import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";

export const SERVICE_TOOL_CODES = ["feedback", "questionnaire", "grade_check", "file_collect", "pdf_tools"] as const;
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
  grade_check: {
    code: "grade_check",
    name: "成绩表核对",
    description: "上传成绩表并按学号开放查询",
  },
  file_collect: {
    code: "file_collect",
    name: "文件收集",
    description: "创建免登录提交链接并集中收取文件",
  },
  pdf_tools: {
    code: "pdf_tools",
    name: "PDF 工具",
    description: "合并、拆分、压缩、转换和提取 PDF 内容",
  },
};

export function isServiceToolCode(code: string): code is ServiceToolCode {
  return (SERVICE_TOOL_CODES as readonly string[]).includes(code);
}

export function isSiteAdmin(role?: string | null) {
  return role === "admin";
}

export async function hasToolManagerPermission(toolCode: string, user?: { userId?: number; role?: string } | null) {
  if (!user?.userId) return false;
  if (isSiteAdmin(user.role)) return true;
  if (!isServiceToolCode(toolCode)) return false;
  const row = await prisma.toolPermission.findUnique({
    where: { toolCode_userId: { toolCode, userId: user.userId } },
    select: { id: true },
  });
  return Boolean(row);
}

export const hasToolManagePermission = hasToolManagerPermission;

export async function hasToolContentManagePermission(toolCode: string, user?: { userId?: number; role?: string } | null) {
  if (!user?.userId) return false;
  if (await hasToolManagerPermission(toolCode, user)) return true;
  if (!isServiceToolCode(toolCode)) return false;
  const setting = await getToolSetting(toolCode);
  return Boolean(setting.allowPublicManage);
}

export async function listManagerToolCodes(user?: { userId?: number; role?: string } | null) {
  if (!user?.userId) return [];
  if (isSiteAdmin(user.role)) return [...SERVICE_TOOL_CODES];
  const rows = await prisma.toolPermission.findMany({
    where: { userId: user.userId },
    select: { toolCode: true },
    orderBy: [{ toolCode: "asc" }],
  });
  return rows.map((row) => row.toolCode).filter(isServiceToolCode);
}

export const listManageableToolCodes = listManagerToolCodes;

export async function listContentManageableToolCodes(user?: { userId?: number; role?: string } | null) {
  if (!user?.userId) return [];
  const [managerCodes, settings] = await Promise.all([
    listManagerToolCodes(user),
    listToolSettings(),
  ]);
  const result = new Set<ServiceToolCode>(managerCodes);
  for (const code of SERVICE_TOOL_CODES) {
    if (settings.get(code)?.allowPublicManage) result.add(code);
  }
  return [...result];
}

export async function getToolSetting(toolCode: ServiceToolCode) {
  return prisma.toolSetting.upsert({
    where: { toolCode },
    update: {},
    create: { toolCode, isVisible: true, requireLogin: false, allowPublicManage: false },
  });
}

export async function listToolSettings() {
  const rows = await prisma.toolSetting.findMany({
    where: { toolCode: { in: [...SERVICE_TOOL_CODES] } },
  });
  const map = new Map(rows.map((row) => [row.toolCode, row]));
  const missing = SERVICE_TOOL_CODES.filter((code) => !map.has(code));
  if (missing.length) {
    const created = await Promise.all(missing.map((toolCode) => prisma.toolSetting.create({
      data: { toolCode, isVisible: true, requireLogin: false, allowPublicManage: false },
    })));
    for (const row of created) map.set(row.toolCode, row);
  }
  return map;
}

export async function updateToolSetting(toolCode: ServiceToolCode, data: { isVisible?: boolean; requireLogin?: boolean; allowPublicManage?: boolean }) {
  return prisma.toolSetting.upsert({
    where: { toolCode },
    update: data,
    create: {
      toolCode,
      isVisible: data.isVisible ?? true,
      requireLogin: data.requireLogin ?? false,
      allowPublicManage: data.allowPublicManage ?? false,
    },
  });
}

export async function assertToolUsable(toolCode: string, user?: { userId?: number; role?: string } | null) {
  if (!isServiceToolCode(toolCode)) throw new Error("INVALID_TOOL_CODE");
  const canManage = await hasToolManagerPermission(toolCode, user);
  if (canManage) return;
  const setting = await getToolSetting(toolCode);
  if (setting.requireLogin && !user?.userId) throw new Error("TOOL_LOGIN_REQUIRED");
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
