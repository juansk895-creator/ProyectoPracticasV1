--

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS sync_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    api_connection_id UUID NOT NULL
        REFERENCES api_connections(id)
        ON DELETE CASCADE,
    
    project_slug VARCHAR(150) NOT NULL,
    form_ref VARCHAR(150),

    status VARCHAR(30) NOT NULL,
    mode VARCHAR(30),

    started_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    finished_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    duration_ms INTEGER NOT NULL DEFAULT 0,

    filter_by VARCHAR(30),
    filter_from TIMESTAMP WITHOUT TIME ZONE,

    cursor_before TIMESTAMP WITHOUT TIME ZONE,
    cursor_after TIMESTAMP WITHOUT TIME ZONE,

    total_entries_fetched INTEGER NOT NULL DEFAULT 0,
    processed_count INTEGER NOT NULL DEFAULT 0,
    skipped_count INTEGER NOT NULL DEFAULT 0,

    stopped_by_max_pages BOOLEAN NOT NULL DEFAULT false,

    error_message TEXT,
    summary JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),

    CONSTRAINT sync_logs_status_check CHECK (status IN ('success', 'failed', 'partial')),

    CONSTRAINT sync_logs_mode_check CHECK (mode IS NULL OR mode IN ('initial', 'incremental'))
);

CREATE INDEX IF NOT EXISTS idx_sync_logs_api_connection_id ON sync_logs (api_connection_id);

CREATE INDEX IF NOT EXISTS idx_sync_logs_project_slug ON sync_logs (project_slug);

CREATE INDEX IF NOT EXISTS idx_sync_logs_status ON sync_logs (status);

CREATE INDEX IF NOT EXISTS idx_sync_logs_started_at ON sync_logs (started_at DESC);
