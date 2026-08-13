CREATE TABLE "mytrion_announcement_views" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"announcement_id" text NOT NULL,
	"viewer_user_id" text NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mytrion_announcement_views" ADD CONSTRAINT "mytrion_announcement_views_announcement_id_mytrion_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."mytrion_announcements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mytrion_announcement_views_announcement_viewer_uk" ON "mytrion_announcement_views" USING btree ("tenant_id","announcement_id","viewer_user_id");