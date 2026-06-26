-- Almacenamiento de metadatos de conexiones a API's externas

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS api_connections (

    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    name VARCHAR(150) NOT NULL,
    provider VARCHAR(50) NOT NULL DEFAULT 'epicollect5',

    project_slug VARCHAR(150) NOT NULL,
    form_ref VARCHAR(150),

    base_url TEXT NOT NULL,

    auth_type VARCHAR(50) NOT NULL DEFAULT 'bearer',
    auth_token TEXT NOT NULL,

    is_active BOOLEAN NOT NULL DEFAULT true,

    last_test_at TIMESTAMP WITHOUT TIME ZONE,
    last_test_status VARCHAR(30) NOT NULL DEFAULT 'untested',
    last_error_message TEXT,

    last_sync_at TIMESTAMP WITHOUT TIME ZONE,

    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),

    CONSTRAINT api_connections_provider_check
        CHECK (provider IN ('epicollect5', 'custom')),

    CONSTRAINT api_connections_auth_type_check
        CHECK (auth_type IN ('bearer', 'custom', 'none')),

    CONSTRAINT api_connections_last_test_status_check
        CHECK (last_test_status IN ('untested', 'success', 'failed')),

    CONSTRAINT api_connections_unique_project_form
        UNIQUE (provider, project_slug, form_ref)
);

CREATE INDEX IF NOT EXISTS idx_api_connections_project_slug
    ON api_connections (project_slug);

CREATE INDEX IF NOT EXISTS idx_api_connections_is_active
    ON api_connections (is_active);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'trg_api_connections_updated_at'
    ) THEN
        CREATE TRIGGER trg_api_connections_updated_at
        BEFORE UPDATE ON api_connections
        FOR EACH ROW
        EXECUTE FUNCTION set_updated_at();
    END IF;
END;
$$;






