import type { Prisma } from "@prisma/client";

/**
 * 论坛按学校隔离：板块带 schoolId，帖子、回复、点赞都经由板块归属学校。
 * 帖子本身不另存 schoolId，免得各处发帖代码漏填后静默落到默认学校。
 */

/** 按学校找板块（slug 只在同校内唯一）。 */
export function boardSlugKey(schoolId: string, slug: string): Prisma.BoardWhereUniqueInput {
  return { schoolId_slug: { schoolId, slug } };
}

export function topicsOfSchool(schoolId: string): Prisma.TopicWhereInput {
  return { board: { schoolId } };
}

export function repliesOfSchool(schoolId: string): Prisma.ReplyWhereInput {
  return { topic: { board: { schoolId } } };
}

/** 帖子（连同它的板块）是否属于这所学校；不属于时一律按“不存在”处理。 */
export function topicBelongsToSchool(topic: { board?: { schoolId: string } | null } | null | undefined, schoolId: string) {
  return Boolean(topic?.board && topic.board.schoolId === schoolId);
}
