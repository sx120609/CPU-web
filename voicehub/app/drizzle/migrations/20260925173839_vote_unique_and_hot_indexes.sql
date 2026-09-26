-- 迁移在同一事务中执行：先锁住投票表的写入，避免清理与建唯一索引之间插入新的重复票
LOCK TABLE "Vote" IN SHARE ROW EXCLUSIVE MODE;--> statement-breakpoint
-- 清理重复投票：每个 (songId, userId) 只保留 id 最小的一条
DELETE FROM "Vote" AS "duplicate"
USING "Vote" AS "kept"
WHERE "duplicate"."songId" = "kept"."songId"
	AND "duplicate"."userId" = "kept"."userId"
	AND "duplicate"."id" > "kept"."id";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "Vote_songId_userId_unique" ON "Vote" USING btree ("songId","userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Vote_userId_idx" ON "Vote" USING btree ("userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Notification_userId_idx" ON "Notification" USING btree ("userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Schedule_songId_idx" ON "Schedule" USING btree ("songId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "song_replay_requests_user_id_idx" ON "song_replay_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Song_requesterId_idx" ON "Song" USING btree ("requesterId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Song_semester_idx" ON "Song" USING btree ("semester");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "UserIdentity_userId_idx" ON "UserIdentity" USING btree ("userId");
