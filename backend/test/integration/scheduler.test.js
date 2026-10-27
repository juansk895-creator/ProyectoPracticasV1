const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { Client, Pool } = require('pg');
const { migrateOAuth } = require('../../src/services/oauthStorage.service');
const { migrateHierarchy } = require('../../src/services/hierarchyStorage.service');
const { assertSchedulerStorage, migrateScheduler } = require('../../src/services/schedulerStorage.service');

test('programación, exclusión de corridas y recuperación con múltiples sesiones PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
    const admin = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await admin.connect();
    const schema = `scheduler_test_${randomBytes(8).toString('hex')}`;
    await admin.query(`CREATE SCHEMA ${schema}`);
    const database = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema},public` });
    const pool = require('../../src/config/db');
    const originalQuery = pool.query;
    const originalConnect = pool.connect;
    pool.query = database.query.bind(database);
    pool.connect = database.connect.bind(database);
    const runner = require('../../src/services/syncRunner.service');
    const { createScheduler } = require('../../src/services/syncScheduler.service');
    const model = require('../../src/models/apiConnection.model');
    const gate = require('../../src/services/requestGate.service');
    const initialInterval = process.env.SYNC_REQUEST_INTERVAL_MS;
    process.env.SYNC_REQUEST_INTERVAL_MS = '0';
    const originalFetch = global.fetch;
    const definition = require('../fixtures/public_project_schema.json');
    let responseStatus = 200;
    let failures = new Set();
    let calls = [];
    let block = null;
    let server;
    global.fetch = async (url, options) => {
        if (!String(url).startsWith('https://')) return originalFetch(url, options);
        calls.push(String(url));
        if (block) await block(options);
        const parsed = new URL(url);
        const slug = parsed.pathname.split('/').at(-1);
        const status = failures.has(slug) ? 500 : responseStatus;
        if (status !== 200) return Response.json({ error: 'SECRET_REMOTE_BODY' }, { status, headers: { 'Retry-After': '600' } });
        if (parsed.pathname.includes('/export/project/')) {
            const body = structuredClone(definition); body.data.project.slug = slug;
            return Response.json(body);
        }
        return Response.json({ meta: { last_page: 1 }, data: { entries: parsed.searchParams.has('branch_ref') ? [] : [
            { ec5_uuid: '00000000-0000-4000-8000-000000000001', uploaded_at: '2026-10-01T12:00:00Z', '1_Name': 'Prueba' },
        ] } });
    };
    t.after(async () => {
        runner.cancelAll();
        global.fetch = originalFetch;
        if (server) await new Promise((resolve) => server.close(resolve));
        pool.query = originalQuery; pool.connect = originalConnect;
        await pool.end(); await database.end();
        await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
        if (initialInterval === undefined) delete process.env.SYNC_REQUEST_INTERVAL_MS;
        else process.env.SYNC_REQUEST_INTERVAL_MS = initialInterval;
    });
    const setup = await database.connect();
    try {
        for (const file of ['api_conection.sql', 'entradas_staging.sql', 'sync_controls.sql', 'sync_logs.sql']) {
            await setup.query(await readFile(path.resolve(__dirname, '../../../database/migrations', file), 'utf8'));
        }
        await migrateOAuth(setup); await migrateHierarchy(setup);
        // Reproducir la estructura publicada antes de esta etapa.
        await setup.query(`ALTER TABLE api_connections DROP COLUMN sync_schedule_enabled,
            DROP COLUMN sync_interval_minutes, DROP COLUMN sync_next_run_at;
            ALTER TABLE sync_logs DROP COLUMN trigger_source;
            ALTER TABLE sync_logs ALTER COLUMN finished_at SET NOT NULL;
            ALTER TABLE sync_logs DROP CONSTRAINT sync_logs_status_check;
            ALTER TABLE sync_logs ADD CONSTRAINT sync_logs_status_check CHECK (status IN ('success','failed','partial'));`);
        await t.test('la preparación es explícita, conserva el histórico y no activa conexiones existentes', async () => {
            await assert.rejects(assertSchedulerStorage(setup), { code: 'SYNC_SCHEDULER_MIGRATION_REQUIRED' });
            const id = randomUUID(); const logId = randomUUID();
            await setup.query(`INSERT INTO api_connections (id,name,project_slug,base_url,auth_type)
                VALUES ($1,'Anterior','anterior','https://five.epicollect.net/api','none')`, [id]);
            await setup.query(`INSERT INTO sync_logs (id,api_connection_id,project_slug,status,started_at,finished_at)
                VALUES ($1,$2,'anterior','success',now(),now())`, [logId,id]);
            await migrateScheduler(setup);
            await setup.query("UPDATE api_connections SET sync_next_run_at = '2027-01-01T00:00:00Z' WHERE id=$1", [id]);
            await migrateScheduler(setup);
            const row = (await setup.query('SELECT * FROM api_connections WHERE id=$1', [id])).rows[0];
            assert.equal(row.sync_schedule_enabled, false); assert.equal(row.sync_interval_minutes, 60);
            assert.equal(row.sync_next_run_at.toISOString(), '2027-01-01T00:00:00.000Z');
            assert.equal((await setup.query('SELECT trigger_source FROM sync_logs WHERE id=$1', [logId])).rows[0].trigger_source, 'manual');
        });
    } finally { setup.release(); }
    const app = require('../../src/app');
    server = await new Promise((resolve) => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    const local = `http://127.0.0.1:${server.address().port}/api`;
    async function request(method, route, body) {
        const response = await originalFetch(local + route, { method,
            headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
        return { status: response.status, body: await response.json() };
    }
    async function connection(extra = {}) {
        return model.createConnection({ name: 'Programada', project_slug: `scheduled-${randomBytes(5).toString('hex')}`,
            base_url: 'https://five.epicollect.net/api', auth_type: 'none', sync_delay_ms: 0, sync_max_pages: 10,
            sync_schedule_enabled: true, sync_interval_minutes: 5, ...extra });
    }
    async function due(id) {
        await database.query('UPDATE api_connections SET sync_schedule_enabled=false, sync_next_run_at=NULL');
        await database.query("UPDATE api_connections SET sync_schedule_enabled=true,sync_next_run_at=now()-interval '1 minute' WHERE id=$1", [id]);
        calls = [];
    }
    const config = { enabled: true, pollMs: 1000, requestIntervalMs: 0 };

    await t.test('la API valida y conserva el intervalo, y desactivarlo no borra el avance incremental', async () => {
        const created = await request('POST', '/connections', { name: 'Desde API', project_slug: 'api-schedule',
            base_url: 'https://five.epicollect.net/api', auth_type: 'none', sync_schedule_enabled: true, sync_interval_minutes: 10 });
        assert.equal(created.status, 201);
        const current = created.body.data;
        assert.equal(current.sync_schedule_enabled, true);
        assert.ok(new Date(current.sync_next_run_at).getTime() > Date.now() + 590000);
        await database.query("UPDATE api_connections SET sync_cursor='2026-01-01T00:00:00Z' WHERE id=$1", [current.id]);
        assert.equal((await request('PUT', `/connections/${current.id}`, { sync_interval_minutes: 4 })).status, 400);
        const disabled = await request('PUT', `/connections/${current.id}`, { sync_schedule_enabled: false });
        assert.equal(disabled.status, 200); assert.equal(disabled.body.data.sync_next_run_at, null);
        assert.ok(disabled.body.data.sync_cursor.startsWith('2026-01-01'));
    });
    await t.test('el interruptor global y las conexiones inactivas impiden las corridas automáticas', async () => {
        const row = await connection(); await due(row.id);
        await createScheduler({ config: { ...config, enabled: false } }).tick();
        assert.equal(calls.length, 0);
        await database.query('UPDATE api_connections SET is_active=false WHERE id=$1', [row.id]);
        await createScheduler({ config }).tick(); assert.equal(calls.length, 0);
    });
    await t.test('ejecuta una sola vez, registra el origen y persiste la próxima fecha ante un reinicio', async () => {
        const row = await connection(); await due(row.id);
        const first = createScheduler({ config });
        await Promise.all([first.tick(), first.tick(), createScheduler({ config }).tick()]);
        const recorded = (await database.query('SELECT * FROM sync_logs WHERE api_connection_id=$1', [row.id])).rows;
        assert.equal(recorded.length, 1); assert.equal(recorded[0].status, 'success'); assert.equal(recorded[0].trigger_source, 'scheduled');
        const next = (await database.query('SELECT sync_next_run_at FROM api_connections WHERE id=$1', [row.id])).rows[0].sync_next_run_at;
        assert.ok(next.getTime() > Date.now() + 299000);
        calls = []; await createScheduler({ config }).tick(); assert.equal(calls.length, 0);
    });
    await t.test('una corrida manual visible en curso bloquea otras manuales y programadas', async () => {
        const row = await connection(); await due(row.id);
        let entered; let release;
        const reached = new Promise((resolve) => { entered = resolve; });
        const waiting = new Promise((resolve) => { release = resolve; });
        block = async () => { entered(); await waiting; };
        const first = request('PATCH', `/connections/${row.id}/sync`);
        try {
            await reached;
            assert.equal((await request('GET','/dashboard')).body.data.sync.running, 1);
            assert.equal((await request('PATCH', `/connections/${row.id}/sync`)).status, 409);
            await createScheduler({ config }).tick();
            assert.equal(calls.length, 1);
        } finally { block = null; release(); }
        assert.equal((await first).status, 200);
        assert.equal((await database.query('SELECT count(*)::int AS total FROM sync_logs WHERE api_connection_id=$1', [row.id])).rows[0].total, 1);
    });
    await t.test('un bloqueo en otra sesión impide la ejecución y protege el registro activo de la recuperación', async () => {
        const row = await connection(); await due(row.id);
        const holder = await database.connect();
        const key = `sedecollect:sync:${row.id}`;
        await holder.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [key]);
        const log = (await database.query(`INSERT INTO sync_logs (api_connection_id,project_slug,status,started_at)
            VALUES ($1,$2,'running',now()) RETURNING id`, [row.id,row.project_slug])).rows[0];
        try {
            await assert.rejects(runner.runConnection(row.id), { code: 'SYNC_ALREADY_RUNNING' });
            await runner.recoverInterruptedRuns();
            assert.equal((await database.query('SELECT status FROM sync_logs WHERE id=$1', [log.id])).rows[0].status, 'running');
        } finally { await holder.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [key]); holder.release(); }
        await runner.recoverInterruptedRuns();
        const recovered = (await database.query('SELECT * FROM sync_logs WHERE id=$1', [log.id])).rows[0];
        assert.equal(recovered.status, 'failed'); assert.equal(recovered.summary.error_code, 'SYNC_INTERRUPTED');
        assert.equal((await model.findConnectionById(row.id)).sync_cursor, null);
        assert.equal((await model.findConnectionById(row.id)).last_sync_status, 'failed');
    });
    await t.test('un fallo de una conexión no impide procesar la siguiente ni expone la respuesta externa', async () => {
        const bad = await connection(); const good = await connection(); await due(bad.id);
        await database.query("UPDATE api_connections SET sync_schedule_enabled=true,sync_next_run_at=now() WHERE id=$1", [good.id]);
        failures.add(bad.project_slug);
        try { await createScheduler({ config }).tick(); } finally { failures.clear(); }
        const states = (await database.query('SELECT status,summary FROM sync_logs WHERE api_connection_id=ANY($1::uuid[])', [[bad.id,good.id]])).rows;
        assert.deepEqual(states.map((row) => row.status).sort(), ['failed','success']);
        assert.ok(!JSON.stringify(states).includes('SECRET_REMOTE_BODY'));
    });
    await t.test('respeta Retry-After, comparte la pausa entre conexiones y conserva el cursor ante un 429', async () => {
        const row = await connection(); await due(row.id);
        process.env.SYNC_REQUEST_INTERVAL_MS = '1'; responseStatus = 429;
        try {
            await assert.rejects(runner.runConnection(row.id, { trigger: 'scheduled' }), { code: 'EPICOLLECT_HTTP_ERROR' });
            const saved = await model.findConnectionById(row.id);
            assert.equal(saved.sync_cursor, null);
            assert.ok(new Date(saved.sync_next_run_at).getTime() > Date.now() + 590000);
            const gateRow = (await database.query('SELECT blocked_until FROM source_request_gates')).rows[0];
            assert.ok(gateRow.blocked_until.getTime() > Date.now() + 590000);
        } finally {
            process.env.SYNC_REQUEST_INTERVAL_MS = '0'; responseStatus = 200;
            await database.query('DELETE FROM source_request_gates');
        }
    });
    await t.test('las solicitudes al mismo servidor se espacian aun al proceder de conexiones distintas', async () => {
        process.env.SYNC_REQUEST_INTERVAL_MS = '40';
        try {
            const before = Date.now();
            await Promise.all([gate.waitForRequest('https://five.epicollect.net/api/export/project/a'),
                gate.waitForRequest('https://five.epicollect.net/api/export/entries/b')]);
            assert.ok(Date.now() - before >= 30);
        } finally { process.env.SYNC_REQUEST_INTERVAL_MS = '0'; }
    });
    await t.test('apagar una conexión cancela su corrida local y conserva los marcadores', async () => {
        const row = await connection(); await due(row.id);
        let entered;
        const reached = new Promise((resolve) => { entered = resolve; });
        block = (options) => new Promise((resolve, reject) => {
            entered(); options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
        });
        const pending = request('PATCH', `/connections/${row.id}/sync`);
        try {
            await reached;
            assert.equal((await request('PATCH', `/connections/${row.id}/deactivate`)).status, 200);
            assert.equal((await pending).status, 502);
            const saved = await model.findConnectionById(row.id);
            assert.equal(saved.sync_cursor, null);
            assert.equal((await database.query('SELECT status FROM sync_logs WHERE api_connection_id=$1', [row.id])).rows[0].status, 'failed');
        } finally { block = null; }
    });
    await t.test('la detención controlada registra interrupción y permite continuar en una corrida posterior', async () => {
        const row = await connection(); await due(row.id);
        let entered;
        const reached = new Promise((resolve) => { entered = resolve; });
        block = (options) => new Promise((resolve, reject) => {
            entered(); options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
        });
        const running = runner.runConnection(row.id);
        try { await reached; runner.cancelAll(); await assert.rejects(running, { code: 'SYNC_INTERRUPTED' }); }
        finally { block = null; }
        const result = await runner.runConnection(row.id);
        assert.equal(result.log.status, 'success');
        const recorded = (await database.query('SELECT status FROM sync_logs WHERE api_connection_id=$1', [row.id])).rows;
        assert.deepEqual(recorded.map((row) => row.status).sort(), ['failed','success']);
    });
    await t.test('una espera OAuth vigente evita reintentos programados prematuros', async () => {
        const row = await connection({ auth_type: 'oauth2', oauth_client_id: 'demo', oauth_client_secret: 'secret-for-test' });
        await due(row.id);
        await database.query("UPDATE api_connections SET oauth_retry_after=now()+interval '1 hour',oauth_error_code='OAUTH_RATE_LIMITED' WHERE id=$1", [row.id]);
        await createScheduler({ config }).tick(); assert.equal(calls.length, 0);
    });
});
