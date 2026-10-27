const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { Client } = require('pg');
const { migrateOAuth } = require('../../src/services/oauthStorage.service');
const { migrateHierarchy } = require('../../src/services/hierarchyStorage.service');

test('cuadro de mando con PostgreSQL y HTTP reales', { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
    const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await client.connect();
    const schema = `dashboard_test_${randomBytes(8).toString('hex')}`;
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}, public`);
    const pool = require('../../src/config/db');
    const originalQuery = pool.query;
    const originalConnect = pool.connect;
    pool.connect = async () => ({ query: client.query.bind(client), release() {} });
    let queue = Promise.resolve();
    pool.query = (...args) => {
        const query = queue.then(() => client.query(...args));
        queue = query.catch(() => {});
        return query;
    };
    let server;
    t.after(async () => {
        if (server) await new Promise((resolve) => server.close(resolve));
        pool.query = originalQuery;
        pool.connect = originalConnect;
        await pool.end();
        await client.query('SET search_path TO public');
        await client.query(`DROP SCHEMA ${schema} CASCADE`);
        await client.end();
    });
    for (const file of ['api_conection.sql', 'entradas_staging.sql', 'sync_controls.sql', 'sync_logs.sql']) {
        await client.query(await readFile(path.resolve(__dirname, '../../../database/migrations', file), 'utf8'));
    }
    await migrateOAuth(client);
    await migrateHierarchy(client);
    const app = require('../../src/app');
    server = await new Promise((resolve) => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    const local = `http://127.0.0.1:${server.address().port}/api`;
    async function request(route = '/dashboard') {
        const response = await fetch(local + route);
        return { status: response.status, body: await response.json(), headers: response.headers };
    }
    await t.test('sin datos devuelve ceros, días vacíos y consolidación sin valor inventado', async () => {
        const { status, body, headers } = await request();
        assert.equal(status, 200);
        assert.equal(headers.get('cache-control'), 'no-store');
        assert.equal(body.data.staging.total, 0);
        assert.equal(body.data.sync.runs, 0);
        assert.equal(body.data.sync.recordsPerSecond, null);
        assert.equal(body.data.consolidated, null);
        assert.equal(body.data.daily.length, 7);
        assert.ok(body.data.daily.every((row) => row.runs === 0));
        assert.deepEqual(body.data.recent, []);
    });
    await t.test('rechaza períodos ajenos, repetidos o con inyección antes de consultar datos', async () => {
        for (const query of ['days=0', 'days=365', 'days=7.0', 'days=7&days=30', 'days[x]=7', 'days=7%3BDROP%20TABLE%20sync_logs']) {
            assert.equal((await request(`/dashboard?${query}`)).status, 400, query);
        }
        for (const days of [7, 30, 90]) assert.equal((await request(`/dashboard?days=${days}`)).body.data.daily.length, days);
    });

    const connection = randomUUID();
    const inactive = randomUUID();
    const secret = 'NEVER_EXPOSE_THIS_TOKEN_OR_RAW_ERROR';
    const { encryptCredential } = require('../../src/services/credentialCrypto.service');
    await client.query(`INSERT INTO api_connections (id,name,project_slug,base_url,auth_type,token_encrypted,is_active)
        VALUES ($1,'Primera conexión','shared','https://five.epicollect.net/api','bearer',$3,true),
               ($2,'Segunda conexión','shared','https://encuestas.example.org/api','none',NULL,false)`,
    [connection, inactive, encryptCredential(secret, connection)]);
    const project = randomUUID();
    const otherProject = randomUUID();
    for (const [id, base] of [[project, 'https://five.epicollect.net/api'], [otherProject, 'https://encuestas.example.org/api']]) {
        await client.query(`INSERT INTO staging_projects (id,project_slug,base_url,definition) VALUES ($1,'shared',$2,'{}')`, [id, base]);
        await client.query(`INSERT INTO staging_streams (project_id,form_ref,native_form_ref,record_type,parent_form_ref,branch_ref)
            VALUES ($1,'root','root','form',NULL,NULL), ($1,'child','child','child','root',NULL),
                ($1,'branch','root','branch','root','branch')`, [id]);
    }
    const root = randomUUID();
    const foreignParent = randomUUID();
    async function entry(projectId, ref, type, uuid, parent, validation) {
        await client.query(`INSERT INTO entradas_staging (project_id,project_slug,form_ref,entry_uuid,ec5_uuid,
            record_type,parent_form_ref,parent_uuid,branch_ref,payload,validation_status)
            VALUES ($1,'shared',$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [projectId, ref, uuid, type === 'branch' ? null : uuid, type, parent ? 'root' : null,
            parent, type === 'branch' ? ref : null, JSON.stringify({ secret }), validation]);
    }
    await entry(project, 'root', 'form', root, null, 'unvalidated');
    await entry(project, 'child', 'child', randomUUID(), root, 'validated');
    await entry(project, 'branch', 'branch', randomUUID(), foreignParent, 'unvalidated');
    await entry(otherProject, 'root', 'form', root, null, 'rejected');
    await entry(otherProject, 'root', 'form', foreignParent, null, 'unvalidated');

    async function log(status, daysAgo, processed, duration, summary = {}) {
        return (await client.query(`INSERT INTO sync_logs (api_connection_id,project_slug,status,mode,
            started_at,finished_at,processed_count,total_entries_fetched,skipped_count,duration_ms,
            error_message,summary,cursor_before,cursor_after)
            VALUES ($1,'shared',$2,'incremental',CURRENT_DATE - ($3::integer * interval '1 day') + interval '1 hour',
                CURRENT_DATE - ($3::integer * interval '1 day') + interval '1 hour', $4,$4,0,$5,$6,$7,
                '2026-01-01T00:00:00Z','2026-01-02T00:00:00Z') RETURNING id`,
        [connection, status, daysAgo, processed, duration, secret, JSON.stringify(summary)])).rows[0].id;
    }
    await log('success', 0, 5, 1000);
    await log('success', 1, 5, 2000);
    const failed = await log('failed', 2, 0, 1000, { error: secret, error_code: 'EPICOLLECT_HTTP_ERROR', http_status: 429 });
    await log('partial', 6, 2, 0);
    await log('success', 7, 100, 1000);
    await log('failed', 31, 0, 1000);

    await t.test('cuenta registros únicos, tipos y padres sin confundir servidores con el mismo proyecto', async () => {
        const { data } = (await request()).body;
        assert.deepEqual(data.connections, { total: 2, active: 1 });
        assert.deepEqual(data.staging, { total: 5, unvalidated: 3, forms: 3, children: 1, branches: 1, pendingParents: 1 });
        assert.equal(data.validation.reduce((sum, row) => sum + row.total, 0), 5);
    });
    await t.test('agrega todo el período y diferencia reprocesamientos de filas almacenadas', async () => {
        const { data } = (await request()).body;
        assert.deepEqual(data.sync, { runs: 4, successful: 2, failed: 1, partial: 1, running: 0,
            fetched: 12, processed: 12, skipped: 0, durationMs: 4000, recordsPerSecond: 3 });
        assert.equal(data.daily.reduce((sum, row) => sum + row.runs, 0), 4);
        assert.equal(data.daily.reduce((sum, row) => sum + row.processed, 0), 12);
        assert.equal((await request('/dashboard?days=30')).body.data.sync.runs, 5);
        assert.equal((await request('/dashboard?days=90')).body.data.sync.runs, 6);
    });
    await t.test('expone errores estructurados seguros y conserva los marcadores del historial', async () => {
        const { body } = await request();
        assert.ok(!JSON.stringify(body).includes(secret));
        const run = body.data.recent.find((row) => row.id === failed);
        assert.equal(run.error_code, 'EPICOLLECT_HTTP_ERROR');
        assert.equal(run.error_message, 'Epicollect respondió con HTTP 429.');
        assert.ok(run.cursor_before.startsWith('2026-01-01'));
        assert.ok(run.cursor_after.startsWith('2026-01-02'));
        assert.equal(Object.hasOwn(run, 'summary'), false);
    });
    await t.test('códigos desconocidos o errores históricos no filtran mensajes arbitrarios', async () => {
        await client.query('UPDATE sync_logs SET summary = $1 WHERE id = $2', [JSON.stringify({ error_code: secret }), failed]);
        const { body } = await request();
        assert.ok(!JSON.stringify(body).includes(secret));
        assert.equal(body.data.recent.find((row) => row.id === failed).error_code, 'SYNC_FAILED');
    });
    await t.test('limita las últimas corridas sin limitar los totales y actualiza tras nuevas operaciones', async () => {
        for (let i = 0; i < 24; i++) await log('success', 0, 1, 0);
        const { data } = (await request()).body;
        assert.equal(data.recent.length, 20);
        assert.equal(data.sync.runs, 28);
        assert.equal(data.sync.processed, 36);
        assert.equal(data.staging.total, 5);
        assert.equal(data.daily.reduce((sum, row) => sum + row.runs, 0), 28);
    });
    await t.test('una sincronización fallida registra el código seguro que consulta el cuadro de mando', async () => {
        const epicollect = require('../../src/services/epicollect.service');
        const originalFetch = epicollect.fetchProjectHierarchy;
        await client.query('UPDATE api_connections SET is_active = true WHERE id = $1', [inactive]);
        epicollect.fetchProjectHierarchy = async () => {
            throw Object.assign(new Error(secret), { code: 'EPICOLLECT_HTTP_ERROR', statusCode: 403 });
        };
        try {
            const response = await fetch(`${local}/connections/${inactive}/sync`, { method: 'PATCH' });
            assert.equal(response.status, 502);
            const logged = (await client.query('SELECT summary FROM sync_logs WHERE api_connection_id = $1', [inactive])).rows[0];
            assert.equal(logged.summary.error_code, 'EPICOLLECT_HTTP_ERROR');
            assert.equal(logged.summary.http_status, 403);
            const run = (await request()).body.data.recent.find((row) => row.api_connection_id === inactive);
            assert.equal(run.error_message, 'Epicollect respondió con HTTP 403.');
            assert.ok(!JSON.stringify(run).includes(secret));
        } finally { epicollect.fetchProjectHierarchy = originalFetch; }
    });
    await t.test('un fallo de consulta devuelve un error seguro y la aplicación sigue disponible', async () => {
        await client.query('ALTER TABLE sync_logs RENAME TO unavailable_logs');
        // Impedir que PostgreSQL resuelva una tabla homónima del esquema public
        // cuando la base también contiene otros datos de demostración.
        await client.query(`SET search_path TO ${schema}`);
        try {
            const { status, body } = await request();
            assert.equal(status, 500);
            assert.equal(body.code, 'INTERNAL_ERROR');
            assert.ok(!JSON.stringify(body).includes('unavailable_logs'));
            assert.ok(!JSON.stringify(body).includes('stack'));
        } finally {
            await client.query('ALTER TABLE unavailable_logs RENAME TO sync_logs');
            await client.query(`SET search_path TO ${schema}, public`);
        }
        assert.equal((await request()).status, 200);
    });
});
