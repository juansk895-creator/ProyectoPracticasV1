CREATE TABLE IF NOT EXISTS staging_projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_slug VARCHAR(150) NOT NULL,
    base_url TEXT NOT NULL,
    definition JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (base_url, project_slug)
);
CREATE TABLE IF NOT EXISTS staging_streams (
    project_id UUID NOT NULL REFERENCES staging_projects(id),
    form_ref VARCHAR(150) NOT NULL,
    native_form_ref VARCHAR(150) NOT NULL,
    record_type VARCHAR(10) NOT NULL CHECK (record_type IN ('form', 'child', 'branch')),
    parent_form_ref VARCHAR(150),
    branch_ref VARCHAR(150),
    PRIMARY KEY (project_id, form_ref),
    FOREIGN KEY (project_id, parent_form_ref) REFERENCES staging_streams(project_id, form_ref)
        DEFERRABLE INITIALLY DEFERRED,
    CHECK ((record_type = 'form' AND parent_form_ref IS NULL AND branch_ref IS NULL)
        OR (record_type = 'child' AND parent_form_ref IS NOT NULL AND branch_ref IS NULL)
        OR (record_type = 'branch' AND parent_form_ref IS NOT NULL AND branch_ref = form_ref))
);
CREATE TABLE IF NOT EXISTS connection_streams (
    connection_id UUID NOT NULL REFERENCES api_connections(id) ON DELETE CASCADE,
    project_id UUID NOT NULL,
    form_ref VARCHAR(150) NOT NULL,
    sync_cursor TIMESTAMPTZ,
    PRIMARY KEY (connection_id, form_ref),
    FOREIGN KEY (project_id, form_ref) REFERENCES staging_streams(project_id, form_ref)
);
ALTER TABLE entradas_staging
    ADD COLUMN IF NOT EXISTS project_id UUID,
    ADD COLUMN IF NOT EXISTS entry_uuid UUID,
    ADD COLUMN IF NOT EXISTS record_type VARCHAR(10),
    ADD COLUMN IF NOT EXISTS parent_form_ref VARCHAR(150),
    ADD COLUMN IF NOT EXISTS parent_uuid UUID,
    ADD COLUMN IF NOT EXISTS branch_ref VARCHAR(150);
