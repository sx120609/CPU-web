CREATE TABLE IF NOT EXISTS "song_comments" (
  "id" serial PRIMARY KEY NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "song_id" integer NOT NULL,
  "user_id" integer NOT NULL,
  "content" text NOT NULL
);

CREATE INDEX IF NOT EXISTS "song_comments_song_id_idx" ON "song_comments" ("song_id");
CREATE INDEX IF NOT EXISTS "song_comments_created_at_idx" ON "song_comments" ("created_at");
