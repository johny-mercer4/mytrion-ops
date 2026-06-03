-- Enable the pgvector extension. Run once per database before the first migration.
-- Render: run as a one-shot from the dashboard or psql. Local: mounted as a
-- docker-entrypoint init script in docker-compose.yml.
CREATE EXTENSION IF NOT EXISTS vector;
