//
const pool = require('../config/db');
const { randomUUID } = require('node:crypto');
const { encryptCredential, decryptCredential } = require('../services/credentialCrypto.service');

const publicConnectionFields = `
    id,
    name,
    provider,
    project_slug,
    form_ref,
    base_url,
    auth_type,
    (token_encrypted IS NOT NULL) AS has_auth_token,
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
    const encrypted = auth_type === 'none' ? null : encryptCredential(auth_token, id);

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
            is_active,
            sync_filter_by,
            sync_per_page,
            sync_max_pages,
            sync_delay_ms,
            sync_overlap_minutes
        )
        VALUES ($14, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
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
    ],);
    return result.rows[0];
}

async function updateConnection(id, connectionData) {
    const {
        name,
        provider,
        project_slug,
        form_ref,
        base_url,
        auth_type,
        auth_token,
        is_active,
        sync_filter_by,
        sync_per_page,
        sync_max_pages,
        sync_delay_ms,
        sync_overlap_minutes,
    } = connectionData;

    const encrypted = auth_type !== 'none' && auth_token !== undefined
        ? encryptCredential(auth_token, id) : null;

    const result = await pool.query(`
        UPDATE api_connections
        SET
            name = COALESCE($2, name),
            provider = COALESCE($3, provider),
            project_slug = COALESCE($4, project_slug),
            form_ref = COALESCE($5, form_ref),
            base_url = COALESCE($6, base_url),
            auth_type = COALESCE($7, auth_type),
            token_encrypted = CASE
                WHEN COALESCE($7, auth_type) = 'none' THEN NULL
                WHEN $8::text IS NOT NULL THEN $8
                ELSE token_encrypted
            END,
            is_active = COALESCE($9, is_active),
            sync_filter_by = COALESCE($10, sync_filter_by),
            sync_per_page = COALESCE($11, sync_per_page),
            sync_max_pages = COALESCE($12, sync_max_pages),
            sync_delay_ms = COALESCE($13, sync_delay_ms),
            sync_overlap_minutes = COALESCE($14, sync_overlap_minutes)
        WHERE id = $1
        RETURNING ${publicConnectionFields}
    `,
    [
        id,
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
    ],);
    return result.rows[0] || null;
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
        value: row.auth_type === 'none' ? null : decryptCredential(token_encrypted, row.id),
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

async function updateConnectionSyncState(id, syncState) {

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
        RETURNING ${publicConnectionFields}    
    `, [
            id,
            status,
            cursor,
            errorMessage,
            JSON.stringify(summary),
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

