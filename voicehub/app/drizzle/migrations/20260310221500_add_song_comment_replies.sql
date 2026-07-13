ALTER TABLE "song_comments"
ADD COLUMN IF NOT EXISTS "parent_comment_id" integer;

CREATE INDEX IF NOT EXISTS "song_comments_parent_comment_id_idx"
ON "song_comments" ("parent_comment_id");
