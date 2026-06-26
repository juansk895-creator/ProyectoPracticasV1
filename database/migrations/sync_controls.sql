--
--

ALTER TABLE entradas_staging
ADD COLUMN IF NOT EXISTS uploaded_at_epicollect TIMESTAMP WITHOUT TIME ZONE;

ALTER TABLE api_connections
ADD COLUMN IF NOT EXISTS sync_filter_by VARCHAR(30) NOT NULL DEFAULT 'uploaded_at',
ADD COLUMN IF NOT EXISTS sync_cursor TIMESTAMP WITHOUT TIME ZONE,
ADD COLUMN IF NOT EXISTS sync_per_page INTEGER NOT NULL DEFAULT 500,
ADD COLUMN IF NOT EXISTS sync_max_pages INTEGER NOT NULL DEFAULT 5,
ADD COLUMN IF NOT EXISTS sync_delay_ms INTEGER NOT NULL DEFAULT 500,
ADD COLUMN IF NOT EXISTS sync_overlap_minutes INTEGER NOT NULL DEFAULT 5,
ADD COLUMN IF NOT EXISTS last_sync_status VARCHAR(30) NOT NULL DEFAULT 'never',
ADD COLUMN IF NOT EXISTS last_sync_error_message TEXT,
ADD COLUMN IF NOT EXISTS last_sync_summary JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'api_connections_sync_filter_by_check'
    ) THEN
        ALTER TABLE api_connections
        ADD CONSTRAINT api_connections_sync_filter_by_check
        CHECK (sync_filter_by IN ('created_at', 'uploaded_at'));
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'api_connections_sync_per_page_check'
    ) THEN
        ALTER TABLE api_connections
        ADD CONSTRAINT api_connections_sync_per_page_check
        CHECK (sync_per_page BETWEEN 1 AND 1000);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'api_connections_sync_max_pages_check'
    ) THEN
        ALTER TABLE api_connections
        ADD CONSTRAINT api_connections_sync_max_pages_check
        CHECK (sync_max_pages BETWEEN 1 AND 100);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'api_connections_sync_delay_ms_check'
    ) THEN
        ALTER TABLE api_connections
        ADD CONSTRAINT api_connections_sync_delay_ms_check
        CHECK (sync_delay_ms BETWEEN 0 AND 60000);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'api_connections_sync_overlap_minutes_check'
    ) THEN
        ALTER TABLE api_connections
        ADD CONSTRAINT api_connections_sync_overlap_minutes_check
        CHECK (sync_overlap_minutes BETWEEN 0 AND 1440);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'api_connections_last_sync_status_check'
    ) THEN
        ALTER TABLE api_connections
        ADD CONSTRAINT api_connections_last_sync_status_check
        CHECK (last_sync_status IN ('never', 'success', 'failed', 'partial'));
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_entradas_staging_uploaded_at_epicollect
    ON entradas_staging (uploaded_at_epicollect);

CREATE INDEX IF NOT EXISTS idx_api_connections_sync_cursor
    ON api_connections (sync_cursor);


