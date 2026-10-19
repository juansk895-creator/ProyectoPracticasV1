-- Aplicado por oauth:migrate dentro de una transacción.
-- Los marcadores se escribían como ISO UTC, pero el tipo anterior descartaba
-- la zona. Es explícita para no depender de la zona del servidor o de Node.
DO $$
DECLARE
    sync_date RECORD;
BEGIN
    FOR sync_date IN
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND data_type = 'timestamp without time zone'
          AND ((table_name = 'api_connections' AND column_name = 'sync_cursor')
            OR (table_name = 'sync_logs' AND column_name IN ('filter_from', 'cursor_before', 'cursor_after')))
    LOOP
        EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN %I TYPE TIMESTAMPTZ USING %I AT TIME ZONE ''UTC''',
            current_schema(), sync_date.table_name, sync_date.column_name, sync_date.column_name);
    END LOOP;
END;
$$;

ALTER TABLE api_connections
ADD COLUMN IF NOT EXISTS oauth_credentials_encrypted TEXT,
ADD COLUMN IF NOT EXISTS oauth_token_expires_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS oauth_token_refresh_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS oauth_error_code VARCHAR(50),
ADD COLUMN IF NOT EXISTS oauth_retry_after TIMESTAMPTZ;
ALTER TABLE api_connections
DROP CONSTRAINT IF EXISTS api_connections_auth_type_check,
DROP CONSTRAINT IF EXISTS api_connections_credential_check,
DROP CONSTRAINT IF EXISTS api_connections_oauth_fields_check,
DROP CONSTRAINT IF EXISTS api_connections_oauth_cache_check;
ALTER TABLE api_connections
ADD CONSTRAINT api_connections_auth_type_check CHECK (auth_type IN ('none', 'bearer', 'custom', 'oauth2')),
ADD CONSTRAINT api_connections_credential_check CHECK (
            (auth_type = 'none' AND token_encrypted IS NULL) OR
            (auth_type IN ('bearer', 'custom') AND token_encrypted IS NOT NULL AND token_encrypted LIKE 'v1.%') OR
            (auth_type = 'oauth2' AND provider = 'epicollect5' AND oauth_credentials_encrypted IS NOT NULL
                AND oauth_credentials_encrypted LIKE 'v1.%')
        ),
ADD CONSTRAINT api_connections_oauth_fields_check CHECK (
        auth_type = 'oauth2' OR (oauth_credentials_encrypted IS NULL AND oauth_token_expires_at IS NULL
            AND oauth_token_refresh_at IS NULL AND oauth_error_code IS NULL AND oauth_retry_after IS NULL)
    ),
ADD CONSTRAINT api_connections_oauth_cache_check CHECK (
        auth_type <> 'oauth2' OR (
            (token_encrypted IS NULL AND oauth_token_expires_at IS NULL AND oauth_token_refresh_at IS NULL) OR
            (token_encrypted IS NOT NULL AND token_encrypted LIKE 'v1.%' AND oauth_token_expires_at IS NOT NULL
                AND oauth_token_refresh_at IS NOT NULL AND oauth_token_refresh_at < oauth_token_expires_at)
        )
    );
