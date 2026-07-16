CREATE TABLE IF NOT EXISTS "mytrion_profile_defaults" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"profile_name" text NOT NULL,
	"profile_key" text NOT NULL,
	"allowed_mytrions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"home_mytrion" text,
	"all_department_access" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "worker_mytrion_access" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"zoho_user_id" text NOT NULL,
	"user_name" text,
	"email" text,
	"profile_name" text,
	"allowed_mytrions" jsonb,
	"denied_mytrions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"home_mytrion" text,
	"all_department_access" boolean,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mytrion_profile_defaults_tenant_profile_uk" ON "mytrion_profile_defaults" USING btree ("tenant_id","profile_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mytrion_profile_defaults_tenant_idx" ON "mytrion_profile_defaults" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "worker_mytrion_access_tenant_user_uk" ON "worker_mytrion_access" USING btree ("tenant_id","zoho_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "worker_mytrion_access_tenant_idx" ON "worker_mytrion_access" USING btree ("tenant_id");
