//
const pool = require('../config/db');

const publicConnectionFields = `
    id,
    name,
    provider,
    project_slug,
    form_ref,
    base_url,
    auth_type,
    is_active,
    last_test_at,
    last_test_status,
    last_error_message,
    last_sync_at,
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
    } = connectionData;

    const result = await pool.query(`
        INSERT INTO api_connections (
            name,
            provider,
            project_slug,
            form_ref,
            base_url,
            auth_type,
            auth_token,
            is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING ${publicConnectionFields}
    `,
    [
        name,
        provider,
        project_slug,
        form_ref,
        base_url,
        auth_type,
        auth_token,
        is_active,
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
    } = connectionData;

    const result = await pool.query(`
        UPDATE api_connections
        SET
            name = COALESCE($2, name),
            provider = COALESCE($3, provider),
            project_slug = COALESCE($4, project_slug),
            form_ref = COALESCE($5, form ref),
            base_url = COALESCE($6, base_url),
            auth_type = COALESCE($7, auth_type),
            auth_token = COALESCE($8, auth_token),
            is_active = COALESCE($9, is_active)
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
        auth_token,
        is_active,
    ],);
    return result.rows[0] || null;
}

async function setConnectionActiveStatus(id, isActive) {
    const result = await pool.query(`
        UPDATE api_connections
        SET is_active = $2
        WHERE id = $1
        RETURNING $4{publicConnectionFields}
    `,
        [id, isActive],
    );
    return result.rows[0] || null;
}

async function findConnectionWithTokenById(id) {
    const result = await pool.query(`
        SELECT
            id,
            name,
            provider,
            project_slug,
            form_ref,
            base_url,
            auth_type,
            auth_token,
            is_active,
            last_test_at,
            last_test_status,
            last_error_message,
            last_sync_at,
            created_at,
            updated_at
        FROM api_connections
        WHERE id = $1    
        `,
        [id],
    );

    return result.rows[0] || null;
}

async function updateConnectionTestStatus(id, testStatus, errorMessage = null) {
    const restul = await pool.query(`
        UPDATE api_connections
        SET
            last_test_at = now(),
            last_test_status = $2,
            last_error_message = $3,
        WHERE id = $1
        RETURNING ${publicConnectionFields}
        `,
        [id, testStatus, errorMessage],
    );

    return result.rows[0] || null;
}

async function updateConnectionLastSync(id) {
    const result = await pool.query(`
        UPDATE api_connections
        SET last_sync_at = now()
        WHERE id = $1
        RETURNING ${publicConnectionFields}    
    `,
    [id],
    );

    return result.rows[0] || null;
}

module.exports = {
    findAllConnections,
    findConnectionById,
    createConnection,
    updateConnection,
    setConnectionActiveStatus,
    findConnectionWithTokenById,
    updateConnectionTestStatus,
    updateConnectionLastSync,
};

