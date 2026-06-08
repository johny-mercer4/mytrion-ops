ALTER TABLE "knowledge_docs" ADD COLUMN "department_access" text;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "department_access" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_docs_dept_idx" ON "knowledge_docs" USING btree ("tenant_id","department_access");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_chunks_dept_idx" ON "knowledge_chunks" USING btree ("tenant_id","department_access");