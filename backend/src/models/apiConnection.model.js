//
const pool = require('../config/db');
const { randomUUID } = require('node:crypto');
const { encryptCredential, decryptCredential } = require('../services/credentialCrypto.service');
const { encryptOAuthCredentials } = require('../services/oauthCredentials.service');
const { validateUpdateConnection } = require('../validations/apiConnection.validator');

const publicConnectionFields = `
    id,
    name,
    provider,
    project_slug,
    form_ref,
    base_url,
    auth_type,
    (token_encrypted IS NOT NULL) AS has_auth_token,
    (oauth_credentials_encrypted IS NOT NULL) AS has_oauth_credentials,
    oauth_token_expires_at,
    oauth_retry_after,
    oauth_error_code,
    CASE WHEN auth_type <> 'oauth2' THEN NULL
        WHEN oauth_error_code IS NOT NULL THEN 'error'
        WHEN token_encrypted IS NULL THEN 'not_requested'
        WHEN oauth_token_expires_at <= now() THEN 'expired'
        WHEN oauth_token_refresh_at <= now() THEN 'renewal_due'
        ELSE 'valid' END AS oauth_status,
    is_active,
    last_test_at,
    last_test_status,
    last_error_message,
    last_sync_at,
    sync_filter_by,
    sync_cursor,
    sync_per_page,
    sync_max_pages,
    sync_delay_ms,
    sync_overlap_minutes,
    last_sync_status,
    last_sync_error_message,
    last_sync_summary,
    created_at,
    updated_at
`;

async function findAllConnections() {
    const result = await pool.query(`
        SELECT ${publicConnectionFields}
        FROM api_connections
        ORDER BY created_at DESC
    `);
    return result.rows;
}

async function findConnectionById(id) {
    const result = await pool.query(`
        SELECT ${publicConnectionFields}
        FROM api_connections
        WHERE id = $1
    `, [id],);
    return result.rows[0] || null;
}

async function createConnection(connectionData) {
    const {
        name,
        provider = 'epicollect5',
        project_slug,
        form_ref = null,
        base_url,
        auth_type = 'bearer',
        auth_token,
        is_active = true,
        sync_filter_by = 'uploaded_at',
        sync_per_page = 500,
        sync_max_pages = 5,
        sync_delay_ms = 500,
        sync_overlap_minutes = 5,
    } = connectionData;

    const id = randomUUID();
    const encrypted = ['bearer', 'custom'].includes(auth_type) ? encryptCredential(auth_token, id) : null;
    const oauthEncrypted = auth_type === 'oauth2' ? encryptOAuthCredentials({
        client_id: connectionData.oauth_client_id, client_secret: connectionData.oauth_client_secret,
    }, id) : null;

    const result = await pool.query(`
        INSERT INTO api_connections (
            id,
            name,
            provider,
            project_slug,
            form_ref,
            base_url,
            auth_type,
            token_encrypted,
            oauth_credentials_encrypted,
            is_active,
            sync_filter_by,
            sync_per_page,
            sync_max_pages,
            sync_delay_ms,
            sync_overlap_minutes
        )
        VALUES ($14, $1, $2, $3, $4, $5, $6, $7, $15, $8, $9, $10, $11, $12, $13)
        RETURNING ${publicConnectionFields}
    `,
    [
        name,
        provider,
        project_slug,
        form_ref,
        base_url,
        auth_type,
        encrypted,
        is_active,
        sync_filter_by,
        sync_per_page,
        sync_max_pages,
        sync_delay_ms,
        sync_overlap_minutes,
        id,
        oauthEncrypted,
    ],);
    return result.rows[0];
}

async function updateConnection(id, connectionData) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout = '20s'");
        const found = await client.query(`SELECT *, (oauth_credentials_encrypted IS NOT NULL) AS has_oauth_credentials
            FROM api_connections WHERE id = $1 FOR UPDATE`, [id]);
        const current = found.rows[0];
        if (!current) { await client.query('COMMIT'); return null; }
        const validation = validateUpdateConnection(connectionData, current);
        if (!validation.isValid) throw Object.assign(new Error('Configuración no válida.'), {
            code: 'INVALID_CONNECTION_PAYLOAD', errors: validation.errors,
        });
        const data = validation.data;
        const type = data.auth_type ?? current.auth_type;
        const changedContext = ['provider', 'base_url', 'project_slug'].some(
            (field) => data[field] !== undefined && data[field] !== current[field]);
        const changedSyncSource = changedContext || ['form_ref', 'sync_filter_by'].some(
            (field) => data[field] !== undefined && data[field] !== current[field]);
        const changedAuth = type !== current.auth_type || changedContext || data.oauth_client_id !== undefined;
        let token = current.token_encrypted;
        let credentials = current.oauth_credentials_encrypted;
        if (type === 'none') { token = null; credentials = null; }
        else if (type === 'oauth2') {
            if (data.oauth_client_id !== undefined) credentials = encryptOAuthCredentials({
                client_id: data.oauth_client_id, client_secret: data.oauth_client_secret,
            }, id);
            if (changedAuth) token = null;
        } else {
            credentials = null;
            if (data.auth_token !== undefined) token = encryptCredential(data.auth_token, id);
        }
        const keepCache = type === 'oauth2' && !changedAuth;
        if (changedSyncSource) await client.query('DELETE FROM connection_streams WHERE connection_id = $1', [id]);
        const result = await client.query(`UPDATE api_connections SET
            name = $2, provider = $3, project_slug = $4, form_ref = $5, base_url = $6,
            auth_type = $7, token_encrypted = $8, oauth_credentials_encrypted = $9,
            oauth_token_expires_at = $10, oauth_token_refresh_at = $11,
            oauth_error_code = $12, oauth_retry_after = $13,
            is_active = $14, sync_filter_by = $15, sync_per_page = $16,
            sync_max_pages = $17, sync_delay_ms = $18, sync_overlap_minutes = $19,
            sync_cursor = CASE WHEN $20 THEN NULL ELSE sync_cursor END,
            last_sync_at = CASE WHEN $20 THEN NULL ELSE last_sync_at END,
            last_sync_status = CASE WHEN $20 THEN 'never' ELSE last_sync_status END,
            last_sync_error_message = CASE WHEN $20 THEN NULL ELSE last_sync_error_message END,
            last_sync_summary = CASE WHEN $20 THEN '{}'::jsonb ELSE last_sync_summary END
            WHERE id = $1 RETURNING ${publicConnectionFields}`, [
            id, data.name ?? current.name, data.provider ?? current.provider,
            data.project_slug ?? current.project_slug,
            data.form_ref === undefined ? current.form_ref : data.form_ref,
            data.base_url ?? current.base_url, type, token, credentials,
            keepCache ? current.oauth_token_expires_at : null,
            keepCache ? current.oauth_token_refresh_at : null,
            keepCache ? current.oauth_error_code : null, keepCache ? current.oauth_retry_after : null,
            data.is_active ?? current.is_active, data.sync_filter_by ?? current.sync_filter_by,
            data.sync_per_page ?? current.sync_per_page, data.sync_max_pages ?? current.sync_max_pages,
            data.sync_delay_ms ?? current.sync_delay_ms, data.sync_overlap_minutes ?? current.sync_overlap_minutes,
            changedSyncSource,
        ]);
        await client.query('COMMIT');
        return result.rows[0];
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally { client.release(); }
}

async function setConnectionActiveStatus(id, isActive) {
    const result = await pool.query(`
        UPDATE api_connections
        SET is_active = $2
        WHERE id = $1
        RETURNING ${publicConnectionFields}
    `,
        [id, isActive],
    );
    return result.rows[0] || null;
}

async function findConnectionWithTokenById(id) {
    const result = await pool.query(`
        SELECT ${publicConnectionFields}, token_encrypted
        FROM api_connections WHERE id = $1
    `, [id]);
    const row = result.rows[0];
    if (!row) return null;
    const { token_encrypted, ...connection } = row;
    // Disponible sólo para la llamada saliente; no se serializa por accidente.
    Object.defineProperty(connection, 'auth_token', {
        value: ['bearer', 'custom'].includes(row.auth_type) ? decryptCredential(token_encrypted, row.id) : null,
        enumerable: false,
    });
    return connection;
}

async function updateConnectionTestStatus(id, testStatus, errorMessage = null) {
    const result = await pool.query(`
        UPDATE api_connections
        SET
            last_test_at = now(),
            last_test_status = $2,
            last_error_message = $3
        WHERE id = $1
        RETURNING ${publicConnectionFields}
        `,
        [id, testStatus, errorMessage],
    );

    return result.rows[0] || null;
}

async function updateConnectionSyncState(id, syncState, expectedConnection = null) {

    const {
        status,
        cursor = null,
        errorMessage = null,
        summary = {},
    } = syncState;


    const result = await pool.query(`
        UPDATE api_connections
        SET
            last_sync_at = now(),
            last_sync_status = $2,
            sync_cursor = COALESCE($3, sync_cursor),
            last_sync_error_message = $4,
            last_sync_summary = $5::jsonb
        WHERE id = $1
          AND ($6::boolean = false OR (is_active = true AND provider = $7 AND base_url = $8
            AND project_slug = $9 AND form_ref IS NOT DISTINCT FROM $10
            AND sync_filter_by = $11 AND auth_type = $12))
        RETURNING ${publicConnectionFields}    
    `, [
            id,
            status,
            cursor,
            errorMessage,
            JSON.stringify(summary),
            Boolean(expectedConnection), expectedConnection?.provider, expectedConnection?.base_url,
            expectedConnection?.project_slug, expectedConnection?.form_ref,
            expectedConnection?.sync_filter_by, expectedConnection?.auth_type,
        ],
    );

    return result.rows[0] || null;
}

module.exports = {
    findAllConnections,
    findConnectionById,
    findConnectionWithTokenById,
    createConnection,
    updateConnection,
    setConnectionActiveStatus,
    updateConnectionTestStatus,
    updateConnectionSyncState,
};

