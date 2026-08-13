CREATE TABLE "mytrion_announcements" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"target_departments" jsonb NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mytrion_announcement_reads" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"announcement_id" text NOT NULL,
	"reader_user_id" text NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mytrion_announcement_reads" ADD CONSTRAINT "mytrion_announcement_reads_announcement_id_mytrion_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."mytrion_announcements"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "mytrion_announcement_reads_announcement_reader_uk" ON "mytrion_announcement_reads" USING btree ("tenant_id","announcement_id","reader_user_id");
--> statement-breakpoint
CREATE INDEX "mytrion_announcement_reads_reader_time_idx" ON "mytrion_announcement_reads" USING btree ("tenant_id","reader_user_id","read_at");
--> statement-breakpoint
CREATE INDEX "mytrion_announcements_tenant_published_idx" ON "mytrion_announcements" USING btree ("tenant_id","published_at");
