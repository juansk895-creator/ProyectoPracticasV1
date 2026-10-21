// Prueba explícita: consulta una vez la definición, el formulario y la rama públicos.
// No se incluye en test:integration para evitar consumir la cuota externa en cada ejecución.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { Client } = require('pg');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

test('proyecto público real: formulario y ramas vinculadas en un esquema temporal', async (t) => {
    if (!process.env.TEST_DATABASE_URL) throw new Error('Configura TEST_DATABASE_URL para un PostgreSQL de pruebas.');
    const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await client.connect();
    const schema = `hierarchy_live_${randomBytes(8).toString('hex')}`;
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}, public`);
    const oldKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
    const oldBases = process.env.EPICOLLECT_API_BASE_URLS;
    process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    process.env.EPICOLLECT_API_BASE_URLS = 'https://five.epicollect.net/api';
    const pool = require('../../src/config/db');
    const originalQuery = pool.query;
    const originalConnect = pool.connect;
    let queue = Promise.resolve();
    pool.query = (...args) => {
        const query = queue.then(() => client.query(...args));
        queue = query.catch(() => {});
        return query;
    };
    pool.connect = async () => ({ query: client.query.bind(client), release() {} });
    t.after(async () => {
        pool.query = originalQuery;
        pool.connect = originalConnect;
        await pool.end();
        await client.query('SET search_path TO public');
        await client.query(`DROP SCHEMA ${schema} CASCADE`);
        await client.end();
        for (const [name, value] of [['CREDENTIAL_ENCRYPTION_KEY', oldKey], ['EPICOLLECT_API_BASE_URLS', oldBases]]) {
            if (value === undefined) delete process.env[name]; else process.env[name] = value;
        }
    });
    const migrationDir = path.resolve(__dirname, '../../../database/migrations');
    for (const file of ['api_conection.sql', 'entradas_staging.sql', 'sync_controls.sql', 'sync_logs.sql']) {
        await client.query(await readFile(path.join(migrationDir, file), 'utf8'));
    }
    await require('../../src/services/oauthStorage.service').migrateOAuth(client);
    await require('../../src/services/hierarchyStorage.service').migrateHierarchy(client);
    const connection = await require('../../src/models/apiConnection.model').createConnection({ name: 'Jerarquía pública real',
        project_slug: 'ec5-api-test', base_url: 'https://five.epicollect.net/api', auth_type: 'none',
        sync_per_page: 500, sync_max_pages: 5, sync_delay_ms: 1500, sync_overlap_minutes: 5 });
    const result = await require('../../src/services/sync.service').syncConnectionToStaging(connection);
    const listed = await require('../../src/models/stagingEntry.model').findStagingEntries({
        projectSlug: connection.project_slug, sourceBaseUrl: connection.base_url });
    assert.equal(result.database.pendingParents, 0);
    assert.equal(result.database.processed, listed.total);
    assert.ok(listed.rows.some((row) => row.record_type === 'form'));
    assert.ok(listed.rows.some((row) => row.record_type === 'branch'));
    assert.ok(listed.rows.every((row) => row.parent_found));
    for (const stream of result.fetch.streams) {
        const page = result.fetch.pages.find((item) => item.form_ref === stream.form_ref);
        assert.equal(listed.rows.filter((row) => row.form_ref === stream.form_ref).length, Number(page.meta.total));
    }
    console.log(JSON.stringify({ total: listed.total,
        forms: listed.rows.filter((row) => row.record_type === 'form').length,
        branches: listed.rows.filter((row) => row.record_type === 'branch').length,
        pendingParents: result.database.pendingParents, streams: result.fetch.streams.length }, null, 2));
});
