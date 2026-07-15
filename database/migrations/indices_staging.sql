--

CREATE INDEX IF NOT EXISTS idx_entradas_staging_project_form_received
ON entradas_staging (
    project_slug,
    form_ref,
    received_at DESC,
    ec5_uuid
);

