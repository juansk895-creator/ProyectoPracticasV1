require('../src/config/env');
const pool = require('../src/config/db');
const { assertOAuthStorage } = require('../src/services/oauthStorage.service');
const { fetchProjectHierarchy } = require('../src/services/epicollect.service');
const { findConnectionWithTokenById } = require('../src/models/apiConnection.model');
const { migrateHierarchy } = require('../src/services/hierarchyStorage.service');

async function main() {
    await assertOAuthStorage(pool);
    const columns = await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema()
        AND table_name = 'entradas_staging' AND column_name = 'project_id'`);
    const fieldStorage = await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema()
        AND table_name = 'entradas_staging' AND column_name = 'field_values'`);
    const toIndex = fieldStorage.rowCount ? 0 : (await pool.query('SELECT count(*)::integer AS total FROM entradas_staging')).rows[0].total;
    const where = columns.rowCount ? 'WHERE project_id IS NULL OR entry_uuid IS NULL OR record_type IS NULL OR form_ref IS NULL' : '';
    const pending = await pool.query(`SELECT project_slug, count(*)::integer AS records FROM entradas_staging ${where} GROUP BY project_slug ORDER BY project_slug`);
    const projects = [];
    for (const row of pending.rows) {
        const connections = await pool.query(`SELECT id, base_url FROM api_connections
            WHERE project_slug = $1 AND is_active = true ORDER BY created_at`, [row.project_slug]);
        if (!connections.rows.length || new Set(connections.rows.map((item) => item.base_url)).size !== 1) {
            throw Object.assign(new Error('Cada proyecto con datos necesita una conexión activa a un único servidor.'), { code: 'STAGING_PROJECT_REQUIRED' });
        }
        const connection = await findConnectionWithTokenById(connections.rows[0].id);
        const graph = await fetchProjectHierarchy(connection);
        projects.push({ base_url: connection.base_url, graph });
    }
    console.log(JSON.stringify({ projects: pending.rows, records: pending.rows.reduce((sum, row) => sum + row.records, 0),
        streams: projects.reduce((sum, project) => sum + project.graph.streams.length, 0),
        stable_fields: { structure_required: !fieldStorage.rowCount, records_to_index: toIndex,
            initialize_stream_cursors: !fieldStorage.rowCount } }, null, 2));
    if (!process.argv.includes('--apply')) {
        console.log('Vista previa: no se modificó staging. Para aplicar: npm --prefix backend run staging:migrate -- --apply');
        return;
    }
    const client = await pool.connect();
    try {
        console.log(JSON.stringify(await migrateHierarchy(client, projects)));
        console.log('Migración de staging completada. Se conservaron los documentos y estados existentes.');
    } finally { client.release(); }
}

main().catch((error) => {
    const safe = new Set(['STAGING_PROJECT_REQUIRED', 'STAGING_ENTRY_INVALID', 'STAGING_SOURCE_CONFLICT',
        'STAGING_MIGRATION_REQUIRED', 'EPICOLLECT_SCHEMA_INVALID', 'OAUTH_MIGRATION_REQUIRED', 'CREDENTIAL_KEY_INVALID', 'CREDENTIAL_DECRYPT_FAILED']);
    console.error(safe.has(error.code) ? `${error.code}: ${error.message}`
        : 'No se completó la preparación de staging. Revisa la conexión y el acceso a las definiciones de los proyectos.');
    process.exitCode = 1;
}).finally(() => pool.end());
