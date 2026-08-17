CREATE TABLE "mini_app_password_resets" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"carrier_user_id" text NOT NULL,
	"registration_id" text,
	"carrier_id" text,
	"company_name" text,
	"login" text NOT NULL,
	"profile" text NOT NULL,
	"agent_zoho_user_id" text,
	"agent_name" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"note" text,
	"resolved_by_zoho_user_id" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_delete_grants" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"zoho_user_id" text NOT NULL,
	"source" text NOT NULL,
	"granted_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mytrion_agent_availability" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"zoho_user_id" text NOT NULL,
	"availability" text DEFAULT 'available' NOT NULL,
	"availability_note" text,
	"auto_away" boolean DEFAULT false NOT NULL,
	"auto_away_reason" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mytrion_agent_presence" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"zoho_user_id" text NOT NULL,
	"instance_id" text NOT NULL,
	"socket_count" integer DEFAULT 0 NOT NULL,
	"connected_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"departments_snapshot" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mytrion_thread_attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"message_id" text,
	"file_asset_id" text NOT NULL,
	"storage" text DEFAULT 's3' NOT NULL,
	"name" text NOT NULL,
	"mime" text,
	"size_bytes" integer,
	"external_url" text,
	"is_internal" boolean DEFAULT false NOT NULL,
	"uploaded_by_zoho_user_id" text,
	"uploaded_by_carrier_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mytrion_thread_members" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"member_kind" text NOT NULL,
	"member_key" text NOT NULL,
	"member_name" text,
	"role" text DEFAULT 'participant' NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"notify" text DEFAULT 'all' NOT NULL,
	"added_by_zoho_user_id" text,
	"last_read_seq" integer DEFAULT 0 NOT NULL,
	"last_read_at" timestamp with time zone,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mytrion_thread_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"thread_kind" text NOT NULL,
	"seq" integer NOT NULL,
	"kind" text DEFAULT 'message' NOT NULL,
	"body" text NOT NULL,
	"body_format" text DEFAULT 'text' NOT NULL,
	"author_kind" text NOT NULL,
	"author_zoho_user_id" text,
	"author_carrier_id" text,
	"author_name" text,
	"is_internal" boolean DEFAULT false NOT NULL,
	"mentions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"system_event" text,
	"detail" jsonb,
	"edited_at" timestamp with time zone,
	"redacted_at" timestamp with time zone,
	"redacted_by_zoho_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mytrion_threads" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"kind" text NOT NULL,
	"visibility" text NOT NULL,
	"department" text,
	"subject" text DEFAULT '' NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"dm_key" text,
	"message_count" integer DEFAULT 0 NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_id" text,
	"last_message_seq" integer DEFAULT 0 NOT NULL,
	"last_message_preview" text,
	"last_message_author_zoho_user_id" text,
	"created_by_zoho_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mytrion_ticket_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"ticket_id" text NOT NULL,
	"thread_id" text,
	"event_type" text NOT NULL,
	"actor_zoho_user_id" text,
	"actor_name" text,
	"from_status" text,
	"to_status" text,
	"detail" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mytrion_ticket_types" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"kind" text DEFAULT 'ticket' NOT NULL,
	"target_department" text,
	"group" text,
	"default_priority" text,
	"sla_hours" integer,
	"default_assignee_zoho_user_id" text,
	"requestable" boolean DEFAULT false NOT NULL,
	"requires_carrier" boolean DEFAULT false NOT NULL,
	"requires_card" boolean DEFAULT false NOT NULL,
	"automation_key" text,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mytrion_tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"number" text NOT NULL,
	"kind" text NOT NULL,
	"ticket_type_id" text,
	"ticket_type_code" text,
	"ticket_type_label" text,
	"target_department" text,
	"source_department" text,
	"source_mytrion" text,
	"priority" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"substatus" text,
	"requester_kind" text NOT NULL,
	"requester_zoho_user_id" text,
	"requester_carrier_id" text,
	"requester_name" text NOT NULL,
	"assignee_zoho_user_id" text,
	"assignee_name" text,
	"assigned_at" timestamp with time zone,
	"assignment_reason" text,
	"carrier_id" text,
	"company_name" text,
	"application_id" text,
	"crm_deal_id" text,
	"card_number" text,
	"card_last4" text,
	"channel" text DEFAULT 'web' NOT NULL,
	"source" text DEFAULT 'worker' NOT NULL,
	"sla_hours" integer,
	"due_at" timestamp with time zone,
	"first_response_due_at" timestamp with time zone,
	"first_response_at" timestamp with time zone,
	"breached_at" timestamp with time zone,
	"escalation_id" text,
	"escalation_level" integer,
	"escalation_level_label" text,
	"resolved_at" timestamp with time zone,
	"resolved_by_zoho_user_id" text,
	"closed_at" timestamp with time zone,
	"reopened_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"close_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"idempotency_key" text,
	"created_by_zoho_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mytrion_department_agents" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"department" text NOT NULL,
	"zoho_user_id" text NOT NULL,
	"display_name" text,
	"role_title" text,
	"active" boolean DEFAULT true NOT NULL,
	"accepts_new" boolean DEFAULT true NOT NULL,
	"max_open" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"last_assigned_at" timestamp with time zone,
	"assigned_count" integer DEFAULT 0 NOT NULL,
	"added_by_zoho_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mytrion_department_config" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"department" text NOT NULL,
	"hr_department_id" text,
	"label" text,
	"ticket_assignment_strategy" text DEFAULT 'round_robin' NOT NULL,
	"require_online" boolean DEFAULT true NOT NULL,
	"default_assignee_zoho_user_id" text,
	"manager_zoho_user_id" text,
	"manager_name" text,
	"accepts_tickets" boolean DEFAULT true NOT NULL,
	"accepts_escalations" boolean DEFAULT true NOT NULL,
	"sla_hours_override" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mytrion_escalation_hops" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"escalation_id" text NOT NULL,
	"hop_index" integer NOT NULL,
	"level" integer NOT NULL,
	"level_label" text NOT NULL,
	"department" text,
	"assignee_zoho_user_id" text,
	"assignee_name" text,
	"routing_source" text NOT NULL,
	"skip_reason" text,
	"handoff_note" text,
	"decided_by_zoho_user_id" text,
	"decision" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"decision_comment" text,
	"sla_hours" integer,
	"due_at" timestamp with time zone,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mytrion_escalations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"ticket_id" text NOT NULL,
	"reason_type_id" text,
	"reason_code" text,
	"reason_label" text,
	"requester_zoho_user_id" text NOT NULL,
	"requester_name" text NOT NULL,
	"requester_department" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"current_level" integer DEFAULT 2 NOT NULL,
	"current_hop_index" integer DEFAULT 1 NOT NULL,
	"current_department" text,
	"current_assignee_zoho_user_id" text,
	"current_assignee_name" text,
	"hop_due_at" timestamp with time zone,
	"resolution_comment" text,
	"resolved_by_zoho_user_id" text,
	"resolved_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mytrion_comms_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"sla_hours_by_priority" jsonb DEFAULT '{"low":72,"medium":24,"high":4,"critical":4}'::jsonb NOT NULL,
	"first_response_hours_by_priority" jsonb DEFAULT '{"low":24,"medium":8,"high":2,"critical":1}'::jsonb NOT NULL,
	"dm_enabled" boolean DEFAULT false NOT NULL,
	"dm_admin_read_enabled" boolean DEFAULT false NOT NULL,
	"timezone" text DEFAULT 'Asia/Tashkent' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "carrier_users" ADD COLUMN "registration_id" text;--> statement-breakpoint
ALTER TABLE "carrier_users" ADD COLUMN "telegram_user_id" text;--> statement-breakpoint
ALTER TABLE "carrier_invitations" ADD COLUMN "auth_mode" text DEFAULT 'password' NOT NULL;--> statement-breakpoint
ALTER TABLE "registered_mini_app_companies" ADD COLUMN "auth_mode" text DEFAULT 'telegram' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_docs" ADD COLUMN "domain" text DEFAULT 'operations' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_docs" ADD COLUMN "language" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_docs" ADD COLUMN "authority_class" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_docs" ADD COLUMN "owner" text;--> statement-breakpoint
ALTER TABLE "knowledge_docs" ADD COLUMN "source_version" text DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_docs" ADD COLUMN "source_commit" text;--> statement-breakpoint
ALTER TABLE "knowledge_docs" ADD COLUMN "supersedes_doc_id" text;--> statement-breakpoint
ALTER TABLE "knowledge_docs" ADD COLUMN "verification_status" text DEFAULT 'unverified' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "retrieval_text" text NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "section_path" text;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "content_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "embedding_model" text DEFAULT 'text-embedding-3-small' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "embedding_dimensions" integer DEFAULT 1536 NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "source_version" text DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "content_tsv_simple" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', "knowledge_chunks"."retrieval_text")) STORED;--> statement-breakpoint
ALTER TABLE "automation_logs" ADD COLUMN "origin_source" text DEFAULT 'Mytrion Zoho' NOT NULL;--> statement-breakpoint
ALTER TABLE "file_assets" ADD COLUMN "storage_provider" text DEFAULT 's3' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_returns" ADD COLUMN "stripe_status" text;--> statement-breakpoint
ALTER TABLE "mytrion_task_types" ADD COLUMN "department" text;--> statement-breakpoint
ALTER TABLE "mytrion_task_types" ADD COLUMN "sort_order" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
CREATE INDEX "mini_app_password_resets_tenant_status_idx" ON "mini_app_password_resets" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "mini_app_password_resets_agent_idx" ON "mini_app_password_resets" USING btree ("tenant_id","agent_zoho_user_id","status");--> statement-breakpoint
CREATE INDEX "mini_app_password_resets_carrier_idx" ON "mini_app_password_resets" USING btree ("tenant_id","carrier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_delete_grants_user_source_uniq" ON "payment_delete_grants" USING btree ("zoho_user_id","source");--> statement-breakpoint
CREATE INDEX "payment_delete_grants_source_idx" ON "payment_delete_grants" USING btree ("source");--> statement-breakpoint
CREATE UNIQUE INDEX "mytrion_agent_availability_agent_uk" ON "mytrion_agent_availability" USING btree ("tenant_id","zoho_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mytrion_agent_presence_lease_uk" ON "mytrion_agent_presence" USING btree ("tenant_id","zoho_user_id","instance_id");--> statement-breakpoint
CREATE INDEX "mytrion_agent_presence_agent_idx" ON "mytrion_agent_presence" USING btree ("tenant_id","zoho_user_id");--> statement-breakpoint
CREATE INDEX "mytrion_agent_presence_stale_idx" ON "mytrion_agent_presence" USING btree ("tenant_id","last_seen_at");--> statement-breakpoint
CREATE INDEX "mytrion_thread_attachments_thread_idx" ON "mytrion_thread_attachments" USING btree ("tenant_id","thread_id","created_at");--> statement-breakpoint
CREATE INDEX "mytrion_thread_attachments_message_idx" ON "mytrion_thread_attachments" USING btree ("tenant_id","message_id");--> statement-breakpoint
CREATE INDEX "mytrion_thread_attachments_file_idx" ON "mytrion_thread_attachments" USING btree ("tenant_id","file_asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mytrion_thread_members_thread_member_uk" ON "mytrion_thread_members" USING btree ("tenant_id","thread_id","member_kind","member_key");--> statement-breakpoint
CREATE INDEX "mytrion_thread_members_inbox_idx" ON "mytrion_thread_members" USING btree ("tenant_id","member_kind","member_key","state","last_message_at");--> statement-breakpoint
CREATE INDEX "mytrion_thread_members_thread_idx" ON "mytrion_thread_members" USING btree ("tenant_id","thread_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "mytrion_thread_messages_thread_seq_uk" ON "mytrion_thread_messages" USING btree ("tenant_id","thread_id","seq");--> statement-breakpoint
CREATE INDEX "mytrion_thread_messages_thread_time_idx" ON "mytrion_thread_messages" USING btree ("tenant_id","thread_id","created_at");--> statement-breakpoint
CREATE INDEX "mytrion_thread_messages_tenant_author_idx" ON "mytrion_thread_messages" USING btree ("tenant_id","author_zoho_user_id","created_at");--> statement-breakpoint
CREATE INDEX "mytrion_threads_tenant_dept_recent_idx" ON "mytrion_threads" USING btree ("tenant_id","department","visibility","last_message_at");--> statement-breakpoint
CREATE INDEX "mytrion_threads_tenant_kind_recent_idx" ON "mytrion_threads" USING btree ("tenant_id","kind","last_message_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mytrion_threads_tenant_dm_uk" ON "mytrion_threads" USING btree ("tenant_id","dm_key");--> statement-breakpoint
CREATE INDEX "mytrion_ticket_events_ticket_time_idx" ON "mytrion_ticket_events" USING btree ("tenant_id","ticket_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mytrion_ticket_types_tenant_code_uk" ON "mytrion_ticket_types" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "mytrion_ticket_types_picker_idx" ON "mytrion_ticket_types" USING btree ("tenant_id","kind","active","sort_order");--> statement-breakpoint
CREATE INDEX "mytrion_ticket_types_dept_idx" ON "mytrion_ticket_types" USING btree ("tenant_id","target_department","active");--> statement-breakpoint
CREATE UNIQUE INDEX "mytrion_tickets_tenant_number_uk" ON "mytrion_tickets" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "mytrion_tickets_tenant_thread_uk" ON "mytrion_tickets" USING btree ("tenant_id","thread_id");--> statement-breakpoint
CREATE INDEX "mytrion_tickets_queue_idx" ON "mytrion_tickets" USING btree ("tenant_id","target_department","status","priority","created_at");--> statement-breakpoint
CREATE INDEX "mytrion_tickets_assignee_idx" ON "mytrion_tickets" USING btree ("tenant_id","assignee_zoho_user_id","status","due_at");--> statement-breakpoint
CREATE INDEX "mytrion_tickets_requester_idx" ON "mytrion_tickets" USING btree ("tenant_id","requester_zoho_user_id","status","created_at");--> statement-breakpoint
CREATE INDEX "mytrion_tickets_carrier_idx" ON "mytrion_tickets" USING btree ("tenant_id","carrier_id","created_at");--> statement-breakpoint
CREATE INDEX "mytrion_tickets_due_idx" ON "mytrion_tickets" USING btree ("tenant_id","status","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mytrion_tickets_idem_uk" ON "mytrion_tickets" USING btree ("tenant_id","source","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "mytrion_department_agents_dept_user_uk" ON "mytrion_department_agents" USING btree ("tenant_id","department","zoho_user_id");--> statement-breakpoint
CREATE INDEX "mytrion_department_agents_pool_idx" ON "mytrion_department_agents" USING btree ("tenant_id","department","active","accepts_new","last_assigned_at");--> statement-breakpoint
CREATE INDEX "mytrion_department_agents_agent_idx" ON "mytrion_department_agents" USING btree ("tenant_id","zoho_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mytrion_department_config_dept_uk" ON "mytrion_department_config" USING btree ("tenant_id","department");--> statement-breakpoint
CREATE UNIQUE INDEX "mytrion_department_config_hr_uk" ON "mytrion_department_config" USING btree ("tenant_id","hr_department_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mytrion_escalation_hops_hop_uk" ON "mytrion_escalation_hops" USING btree ("tenant_id","escalation_id","hop_index");--> statement-breakpoint
CREATE INDEX "mytrion_escalation_hops_chain_idx" ON "mytrion_escalation_hops" USING btree ("tenant_id","escalation_id","hop_index");--> statement-breakpoint
CREATE INDEX "mytrion_escalation_hops_dept_level_idx" ON "mytrion_escalation_hops" USING btree ("tenant_id","department","level","status");--> statement-breakpoint
CREATE UNIQUE INDEX "mytrion_escalations_ticket_uk" ON "mytrion_escalations" USING btree ("tenant_id","ticket_id");--> statement-breakpoint
CREATE INDEX "mytrion_escalations_inbox_idx" ON "mytrion_escalations" USING btree ("tenant_id","current_assignee_zoho_user_id","status","created_at");--> statement-breakpoint
CREATE INDEX "mytrion_escalations_requester_idx" ON "mytrion_escalations" USING btree ("tenant_id","requester_zoho_user_id","status","created_at");--> statement-breakpoint
CREATE INDEX "mytrion_escalations_dept_idx" ON "mytrion_escalations" USING btree ("tenant_id","current_department","status");--> statement-breakpoint
CREATE INDEX "mytrion_escalations_due_idx" ON "mytrion_escalations" USING btree ("tenant_id","status","hop_due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mytrion_comms_settings_tenant_uk" ON "mytrion_comms_settings" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "carrier_users_tenant_registration_idx" ON "carrier_users" USING btree ("tenant_id","registration_id");--> statement-breakpoint
CREATE UNIQUE INDEX "carrier_users_tenant_telegram_uk" ON "carrier_users" USING btree ("tenant_id","telegram_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_docs_tenant_audience_checksum_uidx" ON "knowledge_docs" USING btree ("tenant_id","audience","checksum") WHERE "knowledge_docs"."checksum" is not null;--> statement-breakpoint
CREATE INDEX "knowledge_docs_domain_idx" ON "knowledge_docs" USING btree ("tenant_id","audience","domain");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_chunks_doc_chunk_uidx" ON "knowledge_chunks" USING btree ("doc_id","chunk_index");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_tsv_simple_idx" ON "knowledge_chunks" USING gin ("content_tsv_simple");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_content_hash_idx" ON "knowledge_chunks" USING btree ("tenant_id","content_hash");--> statement-breakpoint
CREATE INDEX "audit_log_user_name_idx" ON "audit_log" USING btree ("tenant_id","user_name");--> statement-breakpoint
CREATE INDEX "audit_log_profile_idx" ON "audit_log" USING btree ("tenant_id","profile");--> statement-breakpoint
CREATE INDEX "audit_log_role_idx" ON "audit_log" USING btree ("tenant_id","role");--> statement-breakpoint
CREATE INDEX "audit_log_caller_role_idx" ON "audit_log" USING btree ("tenant_id","caller_role");--> statement-breakpoint
CREATE INDEX "audit_log_action_created_idx" ON "audit_log" USING btree ("tenant_id","action","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_resource_idx" ON "audit_log" USING btree ("tenant_id","resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "automation_logs_origin_idx" ON "automation_logs" USING btree ("tenant_id","origin_source");--> statement-breakpoint
CREATE INDEX "automation_logs_agent_idx" ON "automation_logs" USING btree ("tenant_id","agent_name");--> statement-breakpoint
CREATE INDEX "file_assets_tenant_provider_idx" ON "file_assets" USING btree ("tenant_id","storage_provider");--> statement-breakpoint
CREATE INDEX "mytrion_inbox_messages_tenant_owner_feed_idx" ON "mytrion_inbox_messages" USING btree ("tenant_id","owner_zoho_user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "mytrion_inbox_messages"."record_status" <> 'Trash';--> statement-breakpoint
CREATE INDEX "mytrion_inbox_messages_tenant_owner_unread_idx" ON "mytrion_inbox_messages" USING btree ("tenant_id","owner_zoho_user_id","created_at") WHERE "mytrion_inbox_messages"."read_at" IS NULL;--> statement-breakpoint
CREATE INDEX "mytrion_task_types_tenant_dept_idx" ON "mytrion_task_types" USING btree ("tenant_id","department","active");--> statement-breakpoint
CREATE UNIQUE INDEX "maintenance_cases_reference_number_uk" ON "maintenance_cases" USING btree ("reference_number") WHERE "maintenance_cases"."reference_number" IS NOT NULL;