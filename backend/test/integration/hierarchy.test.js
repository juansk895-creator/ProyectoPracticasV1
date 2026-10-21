const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { Client } = require('pg');
const { migrateOAuth } = require('../../src/services/oauthStorage.service');
const { migrateHierarchy, assertHierarchyStorage } = require('../../src/services/hierarchyStorage.service');
const { parseProjectHierarchy } = require('../../src/services/projectHierarchy.service');

test('modelo jerárquico, migración y sincronización de proyectos completos', { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
    const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await client.connect();
    const schema = `hierarchy_test_${randomBytes(8).toString('hex')}`;
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}, public`);
    const oldKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
    const oldBases = process.env.EPICOLLECT_API_BASE_URLS;
    process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    process.env.EPICOLLECT_API_BASE_URLS = 'https://five.epicollect.net/api,https://encuestas.example.org/api';
    const pool = require('../../src/config/db');
    const originalQuery = pool.query;
    const originalConnect = pool.connect;
    let queryQueue = Promise.resolve();
    pool.query = (...args) => {
        const query = queryQueue.then(() => client.query(...args));
        queryQueue = query.catch(() => {});
        return query;
    };
    pool.connect = async () => ({ query: client.query.bind(client), release() {} });
    const realFetch = global.fetch;
    let server;
    t.after(async () => {
        global.fetch = realFetch;
        if (server) await new Promise((resolve) => server.close(resolve));
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
    await client.query(await readFile(path.resolve(__dirname, '../fixtures/api_connections_pre_oauth.sql'), 'utf8'));
    for (const file of ['entradas_staging.sql', 'sync_controls.sql', 'sync_logs.sql']) {
        await client.query(await readFile(path.join(migrationDir, file), 'utf8'));
    }
    await migrateOAuth(client);
    const base = 'https://five.epicollect.net/api';
    function definition(slug) {
        return { data: { project: { slug, forms: [
            { ref: 'household', inputs: [{ ref: 'visits', type: 'branch' }] },
            { ref: 'members', inputs: [] },
        ] } } };
    }
    const legacyId = randomUUID();
    const legacyPayload = { ec5_uuid: legacyId, created_at: '2026-10-01T10:00:00Z', answer: 'Dato existente' };
    await client.query(`INSERT INTO entradas_staging (ec5_uuid, project_slug, payload, sync_status, validation_status)
        VALUES ($1, 'legacy', $2::jsonb, 'reviewed', 'approved')`, [legacyId, JSON.stringify(legacyPayload)]);
    const legacyBefore = (await client.query('SELECT * FROM entradas_staging WHERE ec5_uuid = $1', [legacyId])).rows[0];

    await t.test('la falta de definición revierte también los cambios de esquema', async () => {
        await assert.rejects(assertHierarchyStorage(client), { code: 'STAGING_MIGRATION_REQUIRED' });
        await assert.rejects(migrateHierarchy(client), { code: 'STAGING_PROJECT_REQUIRED' });
        const columns = await client.query(`SELECT column_name FROM information_schema.columns
            WHERE table_schema = $1 AND table_name = 'entradas_staging' AND column_name = 'project_id'`, [schema]);
        assert.equal(columns.rowCount, 0);
        assert.deepEqual((await client.query('SELECT * FROM entradas_staging WHERE ec5_uuid = $1', [legacyId])).rows[0], legacyBefore);
    });

    await t.test('migra el formulario por defecto conservando documento, estados y fechas de control; repetir es seguro', async () => {
        const projects = [{ base_url: base, graph: parseProjectHierarchy(definition('legacy'), 'legacy') }];
        const result = await migrateHierarchy(client, projects);
        assert.equal(result.migrated, 1);
        await migrateHierarchy(client, projects);
        await assertHierarchyStorage(client);
        const row = (await client.query('SELECT * FROM entradas_staging WHERE entry_uuid = $1', [legacyId])).rows[0];
        assert.equal(row.form_ref, 'household');
        assert.equal(row.record_type, 'form');
        assert.deepEqual(row.payload, legacyBefore.payload);
        for (const field of ['sync_status', 'validation_status', 'received_at', 'updated_at']) assert.deepEqual(row[field], legacyBefore[field]);
        assert.equal(row.created_at_epicollect.toISOString(), legacyPayload.created_at.replace('Z', '.000Z'));
    });

    const model = require('../../src/models/apiConnection.model');
    const staging = require('../../src/models/stagingEntry.model');
    const rootId = randomUUID();
    const childId = randomUUID();
    const branchIds = [randomUUID(), randomUUID()];
    let data = {};
    let failStream = null;
    let beforeResponse = null;
    const calls = [];
    function resetData() {
        data = {
            household: [{ ec5_uuid: rootId, uploaded_at: '2026-10-01T10:00:00Z', answer: 'Casa' }],
            members: [{ ec5_uuid: childId, ec5_parent_uuid: rootId, uploaded_at: '2026-09-01T05:00:00Z', answer: 'Persona' }],
            visits: branchIds.map((id, index) => ({ ec5_branch_uuid: id, ec5_branch_owner_uuid: rootId,
                uploaded_at: `2026-10-01T11:0${index}:00Z`, answer: `Visita ${index}` })),
        };
        failStream = null;
        beforeResponse = null;
        calls.length = 0;
    }
    resetData();
    global.fetch = async (url, options) => {
        if (!String(url).startsWith('https://')) return realFetch(url, options);
        const parsed = new URL(url);
        assert.equal(options.redirect, 'error');
        const slug = parsed.pathname.split('/').at(-1);
        if (parsed.pathname.includes('/export/project/')) return Response.json(definition(slug));
        const stream = parsed.searchParams.get('branch_ref') || parsed.searchParams.get('form_ref');
        assert.ok(stream in data);
        assert.equal(parsed.searchParams.has('parent_uuid'), false);
        assert.equal(parsed.searchParams.has('branch_owner_uuid'), false);
        assert.equal(parsed.searchParams.get('sort_order'), 'ASC');
        calls.push(parsed);
        if (beforeResponse) await beforeResponse(stream);
        if (failStream === stream) return Response.json({ error: 'Fallo remoto' }, { status: 503 });
        const from = parsed.searchParams.get('filter_from');
        const filtered = data[stream].filter((entry) => !from || new Date(entry.uploaded_at) >= new Date(from));
        const perPage = Number(parsed.searchParams.get('per_page'));
        const page = Number(parsed.searchParams.get('page'));
        return Response.json({ meta: { last_page: Math.max(1, Math.ceil(filtered.length / perPage)), total: filtered.length },
            data: { entries: filtered.slice((page - 1) * perPage, page * perPage) } });
    };
    const app = require('../../src/app');
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const local = `http://127.0.0.1:${server.address().port}/api`;
    async function request(method, route, body) {
        const response = await realFetch(local + route, { method, headers: { 'Content-Type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        return { status: response.status, data: await response.json() };
    }
    async function create(changes = {}) {
        const response = await request('POST', '/connections', { name: 'Jerarquía', project_slug: `hierarchy-${randomBytes(4).toString('hex')}`,
            base_url: base, auth_type: 'none', sync_per_page: 1, sync_max_pages: 10, sync_delay_ms: 0, ...changes });
        assert.equal(response.status, 201);
        return response.data.data;
    }
    async function snapshot(connection) {
        return {
            entries: (await client.query('SELECT * FROM entradas_staging WHERE project_slug = $1 ORDER BY form_ref, entry_uuid', [connection.project_slug])).rows,
            cursors: (await client.query('SELECT * FROM connection_streams WHERE connection_id = $1 ORDER BY form_ref', [connection.id])).rows,
        };
    }
    async function sync(connection) { return request('PATCH', `/connections/${connection.id}/sync`); }

    await t.test('sincroniza formulario, hijo y ramas paginadas por lotes; la API muestra sus vínculos', async () => {
        resetData();
        const connection = await create();
        const result = await sync(connection);
        assert.equal(result.status, 200, JSON.stringify(result.data));
        assert.equal(result.data.data.sync.database.processed, 4);
        assert.equal(result.data.data.sync.database.pendingParents, 0);
        assert.equal(calls.filter((url) => url.searchParams.get('branch_ref') === 'visits').length, 2);
        const rows = (await request('GET', `/staging/entries?project_slug=${connection.project_slug}`)).data.data.rows;
        assert.equal(rows.length, 4);
        assert.equal(rows.filter((row) => row.record_type === 'branch').length, 2);
        assert.equal(rows.every((row) => row.parent_found), true);
        assert.equal(new Set(rows.map((row) => row.row_key)).size, 4);
        assert.equal(rows.find((row) => row.record_type === 'child').parent_uuid, rootId);
    });

    await t.test('cada formulario y rama conserva su propio cursor; repetir no duplica registros', async () => {
        resetData();
        const connection = await create();
        assert.equal((await sync(connection)).status, 200);
        calls.length = 0;
        assert.equal((await sync(connection)).status, 200);
        const from = new Map(calls.map((url) => [url.searchParams.get('branch_ref') || url.searchParams.get('form_ref'), url.searchParams.get('filter_from')]));
        assert.equal(from.get('household'), '2026-10-01T09:55:00.000Z');
        assert.equal(from.get('members'), '2026-09-01T04:55:00.000Z');
        assert.equal(from.get('visits'), '2026-10-01T10:56:00.000Z');
        assert.equal((await snapshot(connection)).entries.length, 4);
    });

    await t.test('el mismo UUID en proyectos, formularios y servidores distintos no sobrescribe otro registro', async () => {
        resetData();
        data.members[0].ec5_uuid = rootId;
        const first = await create();
        const second = await create();
        const otherServer = await create({ project_slug: first.project_slug, base_url: 'https://encuestas.example.org/api' });
        for (const connection of [first, second, otherServer]) assert.equal((await sync(connection)).status, 200);
        const ids = (await client.query('SELECT project_id, form_ref FROM entradas_staging WHERE entry_uuid = $1', [rootId])).rows;
        assert.equal(ids.filter((row) => ['household', 'members'].includes(row.form_ref)).length >= 6, true);
        assert.equal(new Set(ids.map((row) => row.project_id)).size >= 3, true);
        const listed = await staging.findStagingEntries({ projectSlug: first.project_slug });
        assert.equal(listed.total, 8);
        assert.equal(new Set(listed.rows.map((row) => row.row_key)).size, 8);
        const scoped = await request('GET', `/staging/entries?project_slug=${first.project_slug}&source_base_url=${encodeURIComponent(base)}`);
        assert.equal(scoped.status, 200);
        assert.equal(scoped.data.data.pagination.total, 4);
        assert.equal(scoped.data.data.rows.every((row) => row.source_base_url === base), true);
    });

    await t.test('un fallo remoto en una rama revierte el lote completo y no adelanta cursores', async () => {
        resetData();
        const connection = await create();
        assert.equal((await sync(connection)).status, 200);
        const before = await snapshot(connection);
        data.household[0] = { ...data.household[0], uploaded_at: '2026-10-02T10:00:00Z', answer: 'Cambio pendiente' };
        failStream = 'visits';
        assert.equal((await sync(connection)).status, 502);
        assert.deepEqual(await snapshot(connection), before);
    });

    await t.test('identificadores inválidos y errores de base de datos no guardan medio lote', async () => {
        for (const invalid of [{ ec5_branch_uuid: 'invalido' }, { created_by: 'x'.repeat(151) }]) {
            resetData();
            const connection = await create();
            assert.equal((await sync(connection)).status, 200);
            const before = await snapshot(connection);
            data.household[0] = { ...data.household[0], uploaded_at: '2026-10-02T10:00:00Z', answer: 'No debe guardarse' };
            Object.assign(data.visits[0], invalid);
            assert.equal((await sync(connection)).status, 502);
            assert.deepEqual(await snapshot(connection), before);
        }
    });

    await t.test('el límite de páginas se informa y no declara completada una descarga incompleta', async () => {
        resetData();
        const connection = await create({ sync_max_pages: 1 });
        const result = await sync(connection);
        assert.equal(result.status, 502);
        assert.equal(result.data.code, 'SYNC_PAGE_LIMIT');
        assert.deepEqual(await snapshot(connection), { entries: [], cursors: [] });
        await model.updateConnection(connection.id, { sync_max_pages: 10 });
        assert.equal((await sync(connection)).status, 200);
    });

    await t.test('un padre ausente se señala y se resuelve al descargarlo posteriormente', async () => {
        resetData();
        const missing = randomUUID();
        data.visits[0].ec5_branch_owner_uuid = missing;
        const connection = await create();
        const partial = await sync(connection);
        assert.equal(partial.status, 200);
        assert.equal(partial.data.data.connection.last_sync_status, 'partial');
        assert.equal(partial.data.data.sync.database.pendingParents, 1);
        const rows = await staging.findStagingEntries({ projectSlug: connection.project_slug });
        assert.equal(rows.rows.find((row) => row.entry_uuid === branchIds[0]).parent_found, false);
        data.household.push({ ec5_uuid: missing, uploaded_at: '2026-10-01T10:00:00Z' });
        const complete = await sync(connection);
        assert.equal(complete.status, 200);
        assert.equal(complete.data.data.sync.database.pendingParents, 0);
    });

    await t.test('editar la fuente durante la descarga impide guardar resultados bajo una configuración obsoleta', async () => {
        resetData();
        const connection = await create();
        const before = await snapshot(connection);
        beforeResponse = async () => {
            beforeResponse = null;
            await model.updateConnection(connection.id, { form_ref: 'members' });
        };
        const result = await sync(connection);
        assert.equal(result.status, 502);
        assert.equal(result.data.code, 'CONNECTION_CHANGED');
        assert.deepEqual(await snapshot(connection), before);
        const updated = await model.findConnectionById(connection.id);
        assert.equal(updated.last_sync_status, 'never');
        assert.equal(updated.sync_cursor, null);
    });

    await t.test('se puede seleccionar una rama y filtrar sus registros sin perder la procedencia', async () => {
        resetData();
        const connection = await create({ form_ref: 'visits' });
        const result = await sync(connection);
        assert.equal(result.status, 200);
        assert.equal(result.data.data.sync.database.processed, 2);
        assert.equal(calls.every((url) => url.searchParams.get('branch_ref') === 'visits'), true);
        const rows = await staging.findStagingEntries({ projectSlug: connection.project_slug, formRef: 'visits',
            filters: [{ field: 'record_type', operator: 'eq', value: 'branch' }] });
        assert.equal(rows.total, 2);
        assert.equal(rows.rows.every((row) => row.source_base_url === base), true);
    });

    await t.test('el comando de migración solo muestra el plan hasta recibir --apply', async () => {
        const fresh = `${schema}_cli`;
        await client.query(`CREATE SCHEMA ${fresh}`);
        try {
            await client.query(`SET search_path TO ${fresh}, public`);
            for (const file of ['api_conection.sql', 'entradas_staging.sql', 'sync_controls.sql', 'sync_logs.sql']) {
                await client.query(await readFile(path.join(migrationDir, file), 'utf8'));
            }
            await migrateOAuth(client);
            const db = new URL(process.env.TEST_DATABASE_URL);
            const env = { ...process.env, DB_HOST: db.hostname, DB_PORT: db.port || '5432',
                DB_NAME: decodeURIComponent(db.pathname.slice(1)), DB_USER: decodeURIComponent(db.username),
                DB_PASSWORD: decodeURIComponent(db.password), PGOPTIONS: `-c search_path=${fresh},public` };
            const execute = promisify(execFile);
            const preview = await execute(process.execPath, ['scripts/migrateStaging.js'], {
                cwd: path.resolve(__dirname, '../..'), env,
            });
            assert.match(preview.stdout, /Vista previa/);
            await assert.rejects(assertHierarchyStorage(client), { code: 'STAGING_MIGRATION_REQUIRED' });
            assert.equal((await client.query(`SELECT 1 FROM information_schema.tables
                WHERE table_schema = $1 AND table_name = 'staging_projects'`, [fresh])).rowCount, 0);
            const applied = await execute(process.execPath, ['scripts/migrateStaging.js', '--apply'], {
                cwd: path.resolve(__dirname, '../..'), env,
            });
            assert.match(applied.stdout, /Migración de staging completada/);
            await assertHierarchyStorage(client);
        } finally {
            await client.query(`SET search_path TO ${schema}, public`);
            await client.query(`DROP SCHEMA ${fresh} CASCADE`);
        }
    });
});
