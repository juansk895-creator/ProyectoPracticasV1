const path = require('node:path');
const { readFile } = require('node:fs/promises');
const { assertCredentialStorage } = require('./credentialStorage.service');
const { credentialError } = require('./credentialCrypto.service');

async function assertOAuthStorage(client) {
    const { rows } = await client.query(`SELECT table_name, column_name, data_type FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND ((table_name = 'api_connections'
            AND column_name IN ('oauth_credentials_encrypted', 'oauth_token_expires_at',
                'oauth_token_refresh_at', 'oauth_error_code', 'oauth_retry_after', 'sync_cursor'))
            OR (table_name = 'sync_logs' AND column_name IN ('filter_from', 'cursor_before', 'cursor_after')))`);
    const syncDates = rows.filter((row) => row.column_name === 'sync_cursor' || row.table_name === 'sync_logs');
    if (rows.length !== 9 || syncDates.some((row) => row.data_type !== 'timestamp with time zone')) {
        throw credentialError('OAUTH_MIGRATION_REQUIRED',
            'Ejecuta npm --prefix backend run oauth:migrate antes de iniciar el servidor.');
    }
    await assertCredentialStorage(client);
}

async function migrateOAuth(client) {
    await client.query('BEGIN');
    try {
        await client.query('LOCK TABLE api_connections IN ACCESS EXCLUSIVE MODE');
        await assertCredentialStorage(client);
        const sql = await readFile(path.resolve(__dirname, '../../../database/upgrades/oauth_connections.sql'), 'utf8');
        await client.query(sql);
        await assertOAuthStorage(client);
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
}

module.exports = { assertOAuthStorage, migrateOAuth };
