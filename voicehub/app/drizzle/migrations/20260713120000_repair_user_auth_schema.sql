DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_type t
		JOIN pg_namespace n ON n.oid = t.typnamespace
		WHERE n.nspname = 'public' AND t.typname = 'user_status'
	) THEN
		CREATE TYPE "public"."user_status" AS ENUM ('active', 'withdrawn');
	END IF;
END
$$;--> statement-breakpoint

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "status" "public"."user_status";--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "statusChangedAt" timestamp DEFAULT now();--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "statusChangedBy" integer;--> statement-breakpoint
UPDATE "User" SET "status" = 'active' WHERE "status" IS NULL;--> statement-breakpoint
ALTER TABLE "User" ALTER COLUMN "status" SET DEFAULT 'active';--> statement-breakpoint
ALTER TABLE "User" ALTER COLUMN "status" SET NOT NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "user_status_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"old_status" "public"."user_status",
	"new_status" "public"."user_status" NOT NULL,
	"reason" text,
	"operator_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_user_status" ON "User" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_status_logs_user_id" ON "user_status_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_status_logs_created_at" ON "user_status_logs" USING btree ("created_at" DESC);--> statement-breakpoint

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'User_statusChangedBy_User_id_fk'
			AND conrelid = '"User"'::regclass
	) THEN
		ALTER TABLE "User"
			ADD CONSTRAINT "User_statusChangedBy_User_id_fk"
			FOREIGN KEY ("statusChangedBy") REFERENCES "User"("id")
			ON DELETE set null ON UPDATE no action;
	END IF;
END
$$;--> statement-breakpoint

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'user_status_logs_user_id_User_id_fk'
			AND conrelid = 'user_status_logs'::regclass
	) THEN
		ALTER TABLE "user_status_logs"
			ADD CONSTRAINT "user_status_logs_user_id_User_id_fk"
			FOREIGN KEY ("user_id") REFERENCES "User"("id")
			ON DELETE cascade ON UPDATE no action;
	END IF;
END
$$;--> statement-breakpoint

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'user_status_logs_operator_id_User_id_fk'
			AND conrelid = 'user_status_logs'::regclass
	) THEN
		ALTER TABLE "user_status_logs"
			ADD CONSTRAINT "user_status_logs_operator_id_User_id_fk"
			FOREIGN KEY ("operator_id") REFERENCES "User"("id")
			ON DELETE set null ON UPDATE no action;
	END IF;
END
$$;--> statement-breakpoint

INSERT INTO "user_status_logs" ("user_id", "old_status", "new_status", "reason", "created_at")
SELECT u."id", NULL, 'active', '系统迁移初始化', u."createdAt"
FROM "User" u
WHERE NOT EXISTS (
	SELECT 1
	FROM "user_status_logs" l
	WHERE l."user_id" = u."id" AND l."reason" = '系统迁移初始化'
);
