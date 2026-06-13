CREATE TABLE IF NOT EXISTS entradas_staging (
    ec5_uuid UUID PRIMARY KEY,

    project_slug VARCHAR(150) NOT NULL,
    form_ref VARCHAR(150),

    created_by VARCHAR(150),
    created_at_epicollect TIMESTAMP NULL,
    updated_at_epicollect TIMESTAMP NULL,

    payload JSONB NOT NULL,

    sync_status VARCHAR(30) NOT NULL DEFAULT 'pending',
    validation_status VARCHAR(30) NOT NULL DEFAULT 'unvalidated',

    received_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()

);

CREATE INDEX IF NOT EXISTS idx_staging_entries_project_slug
ON staging_entries (project_slug);

CREATE INDEX IF NOT EXISTS idx_staging_entries_created_by
ON staging_entries (created_by);

CREATE INDEX IF NOT EXISTS idx_staging_entries_sync_status
ON staging_entries (sync_status);

CREATE INDEX IF NOT EXISTS idx_staging_entries_validation_status
ON staging_entries (validation_status);

CREATE INDEX IF NOT EXISTS idx_staging_entries_payload_gin
ON staging_entries USING GIN (payload);


