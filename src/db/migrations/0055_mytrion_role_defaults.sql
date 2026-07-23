CREATE TABLE IF NOT EXISTS "mytrion_role_defaults" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"role_name" text NOT NULL,
	"role_key" text NOT NULL,
	"allowed_mytrions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"home_mytrion" text,
	"all_department_access" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mytrion_role_defaults_tenant_role_uk" ON "mytrion_role_defaults" USING btree ("tenant_id","role_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mytrion_role_defaults_tenant_idx" ON "mytrion_role_defaults" USING btree ("tenant_id");
