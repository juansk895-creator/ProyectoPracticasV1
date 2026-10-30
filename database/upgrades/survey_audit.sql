CREATE TABLE IF NOT EXISTS staging_entry_audit (
    project_id uuid NOT NULL,
    form_ref text NOT NULL,
    entry_uuid uuid NOT NULL,
    surveyor_id text CHECK (surveyor_id ~ '^[0-9]{1,20}$'),
    source_uploaded_at timestamptz NOT NULL,
    checked_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, form_ref, entry_uuid),
    FOREIGN KEY (project_id, form_ref, entry_uuid)
        REFERENCES entradas_staging(project_id, form_ref, entry_uuid) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS staging_surveyors (
    project_id uuid NOT NULL REFERENCES staging_projects(id) ON DELETE CASCADE,
    surveyor_id text NOT NULL CHECK (surveyor_id ~ '^[0-9]{1,20}$'),
    display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 200),
    source_reference text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, surveyor_id)
);
CREATE INDEX IF NOT EXISTS idx_staging_audit_surveyor ON staging_entry_audit(project_id, surveyor_id);
CREATE INDEX IF NOT EXISTS idx_staging_audit_dates ON entradas_staging(project_id, created_at_epicollect, form_ref);
CREATE OR REPLACE VIEW staging_audit_records AS
SELECT s.*,
    CASE WHEN a.source_uploaded_at = s.uploaded_at_epicollect THEN a.surveyor_id END AS surveyor_id,
    CASE WHEN a.source_uploaded_at = s.uploaded_at_epicollect THEN u.display_name END AS surveyor_name,
    a.checked_at AS audit_checked_at,
    CASE WHEN a.entry_uuid IS NULL THEN 'pending'
         WHEN a.source_uploaded_at IS DISTINCT FROM s.uploaded_at_epicollect THEN 'stale'
         WHEN a.surveyor_id IS NULL THEN 'anonymous' ELSE 'identified' END AS audit_status
FROM entradas_staging s
LEFT JOIN staging_entry_audit a USING(project_id, form_ref, entry_uuid)
LEFT JOIN staging_surveyors u ON u.project_id = a.project_id AND u.surveyor_id = a.surveyor_id;
