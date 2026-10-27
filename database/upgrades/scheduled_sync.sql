ALTER TABLE api_connections
    ADD COLUMN IF NOT EXISTS sync_schedule_enabled BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS sync_interval_minutes INTEGER NOT NULL DEFAULT 60,
    ADD COLUMN IF NOT EXISTS sync_next_run_at TIMESTAMPTZ;
ALTER TABLE api_connections DROP CONSTRAINT IF EXISTS api_connections_sync_interval_check;
ALTER TABLE api_connections ADD CONSTRAINT api_connections_sync_interval_check
    CHECK (sync_interval_minutes BETWEEN 5 AND 10080);
CREATE INDEX IF NOT EXISTS idx_connections_sync_due ON api_connections (sync_next_run_at, id)
    WHERE is_active AND sync_schedule_enabled;

ALTER TABLE sync_logs
    ADD COLUMN IF NOT EXISTS trigger_source VARCHAR(10) NOT NULL DEFAULT 'manual',
    ALTER COLUMN finished_at DROP NOT NULL;
ALTER TABLE sync_logs DROP CONSTRAINT IF EXISTS sync_logs_status_check;
ALTER TABLE sync_logs ADD CONSTRAINT sync_logs_status_check
    CHECK (status IN ('running', 'success', 'failed', 'partial'));
ALTER TABLE sync_logs DROP CONSTRAINT IF EXISTS sync_logs_trigger_check;
ALTER TABLE sync_logs ADD CONSTRAINT sync_logs_trigger_check CHECK (trigger_source IN ('manual', 'scheduled'));
CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_logs_one_running ON sync_logs (api_connection_id) WHERE status = 'running';

CREATE TABLE IF NOT EXISTS source_request_gates (
    origin TEXT PRIMARY KEY,
    next_request_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    blocked_until TIMESTAMPTZ NOT NULL DEFAULT now()
);
