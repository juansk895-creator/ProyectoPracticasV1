const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { readFile, writeFile, mkdtemp, rm } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Client, Pool } = require('pg');
const { migrateOAuth } = require('../../src/services/oauthStorage.service');
const { migrateHierarchy } = require('../../src/services/hierarchyStorage.service');
const { migrateAudit } = require('../../src/services/auditStorage.service');
const { parseProjectHierarchy } = require('../../src/services/projectHierarchy.service');
const { replaceSurveyors } = require('../../src/services/surveyorDirectory.service');
const { parseAuditQuery } = require('../../src/services/auditQuery.service');

test('auditoría: procedencia, versiones, filtros y escritura atómica con PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
    const admin = new Client({ connectionString: process.env.TEST_DATABASE_URL }); await admin.connect();
    const schema = `audit_test_${randomBytes(8).toString('hex')}`;
    await admin.query(`CREATE SCHEMA ${schema}`);
    const database = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema},public` });
    const pool = require('../../src/config/db');
    const original = { query: pool.query, connect: pool.connect, fetch: global.fetch };
    pool.query = database.query.bind(database); pool.connect = database.connect.bind(database);
    const vars = ['AUDIT_SOURCES_FILE','EPICOLLECT_API_BASE_URLS','SYNC_REQUEST_INTERVAL_MS','AUDIT_TEST_TOKEN','CREDENTIAL_ENCRYPTION_KEY','NODE_ENV'];
    const saved = vars.map((k) => process.env[k]);
    const temp = await mkdtemp(path.join(os.tmpdir(), 'survey-audit-'));
    let server;
    t.after(async () => {
        global.fetch = original.fetch; pool.query = original.query; pool.connect = original.connect;
        if (server) await new Promise((resolve) => server.close(resolve));
        await database.end(); await pool.end();
        await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
        await rm(temp, { recursive: true, force: true });
        vars.forEach((k,i) => { if (saved[i] === undefined) delete process.env[k]; else process.env[k] = saved[i]; });
    });
    process.env.AUDIT_SOURCES_FILE = path.join(temp, 'sources.json');
    process.env.EPICOLLECT_API_BASE_URLS = 'https://five.epicollect.net/api,https://institution.example.org/api';
    process.env.SYNC_REQUEST_INTERVAL_MS = '0';
    process.env.AUDIT_TEST_TOKEN = 'TEST_AUDIT_SECRET';
    process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    process.env.NODE_ENV = 'test';
    const sources = [{ base_url: 'https://five.epicollect.net/api', project_slug: 'audit-demo', token_env: 'AUDIT_TEST_TOKEN' }];
    const saveSources = () => writeFile(process.env.AUDIT_SOURCES_FILE, JSON.stringify(sources)); await saveSources();
    const setup = await database.connect();
    try {
        for (const file of ['api_conection.sql','entradas_staging.sql','sync_controls.sql','sync_logs.sql']) {
            await setup.query(await readFile(path.resolve(__dirname, '../../../database/migrations', file), 'utf8'));
        }
        await migrateOAuth(setup); await migrateHierarchy(setup); await migrateAudit(setup);
    } finally { setup.release(); }
    const connections = require('../../src/models/apiConnection.model');
    const staging = require('../../src/models/stagingEntry.model');
    const audit = require('../../src/models/audit.model');
    const connection = await connections.createConnection({ name: 'Auditoría ficticia', project_slug: 'audit-demo',
        base_url: 'https://five.epicollect.net/api', auth_type: 'none', sync_delay_ms: 0, sync_per_page: 1, sync_max_pages: 10 });
    const other = await connections.createConnection({ name: 'Otro servidor', project_slug: 'audit-demo',
        base_url: 'https://institution.example.org/api', auth_type: 'none', sync_delay_ms: 0 });
    const definition = { data: { project: { slug: 'audit-demo', forms: [
        { ref: 'main', inputs: [{ ref: 'answer', type: 'text', question: 'Respuesta' }, { ref: 'visits', type: 'branch', branch: [] }] },
        { ref: 'child', inputs: [] },
    ] } } };
    const graph = parseProjectHierarchy(definition, 'audit-demo');
    const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const uploaded = '2026-10-27T08:00:00.000Z';
    const payloads = {
        main: [{ ec5_uuid: ids[0], created_at: '2026-10-26T23:59:59.999Z', uploaded_at: uploaded, answer: 'Uno', created_by: 'NO_ES_IDENTIDAD' },
            { ec5_uuid: ids[1], created_at: '2026-10-27T00:00:00Z', uploaded_at: uploaded, answer: 'Dos' }],
        visits: [{ ec5_branch_uuid: ids[2], ec5_branch_owner_uuid: ids[0], created_at: '2026-10-27T23:59:59.999Z', uploaded_at: uploaded }],
        child: [{ ec5_uuid: ids[3], ec5_parent_uuid: ids[0], created_at: '2026-10-28T00:00:00Z', uploaded_at: uploaded }],
    };
    const downloads = () => graph.streams.map((stream) => ({ stream, entries: payloads[stream.form_ref], previousCursor: null, nextCursor: null }));
    await staging.persistHierarchy(connection, graph, downloads());
    await staging.persistHierarchy(other, graph, downloads());
    const projectId = (await database.query('SELECT id FROM staging_projects WHERE base_url = $1', [connection.base_url])).rows[0].id;
    const raw = {};
    graph.streams.forEach((stream) => {
        raw[stream.form_ref] = payloads[stream.form_ref].map((entry, i) => ({
            type: stream.record_type === 'branch' ? 'branch_entry' : 'entry', id: entry.ec5_uuid || entry.ec5_branch_uuid,
            attributes: { form: { ref: stream.native_form_ref } },
            relationships: { user: { data: { id: stream.form_ref === 'child' ? null : stream.form_ref === 'visits' ? 42 : i ? 7 : 42 } },
                branch: { data: { owner_input_ref: stream.branch_ref } } },
            [stream.record_type === 'branch' ? 'branch_entry' : 'entry']: { entry_uuid: entry.ec5_uuid || entry.ec5_branch_uuid, uploaded_at: entry.uploaded_at },
        }));
    });
    const calls = []; let mode = null; let block;
    global.fetch = async (url, options) => {
        if (!String(url).startsWith('https://')) return original.fetch(url, options);
        const parsed = new URL(url); calls.push({ url: parsed, headers: options.headers });
        assert.equal(parsed.pathname, '/api/entries/audit-demo');
        assert.equal(options.headers.Authorization, 'Bearer TEST_AUDIT_SECRET'); assert.equal(options.redirect, 'error');
        assert.equal(parsed.searchParams.has('parent_uuid'), false); assert.equal(parsed.searchParams.has('filter_from'), false);
        const form = parsed.searchParams.get('branch_ref') || parsed.searchParams.get('form_ref');
        const page = Number(parsed.searchParams.get('page')); const perPage = Number(parsed.searchParams.get('per_page'));
        if (block) await block();
        if (mode === 'http' && form === 'child') return Response.json({ secret: process.env.AUDIT_TEST_TOKEN }, { status: 403 });
        if (mode === '429') return Response.json({ secret: process.env.AUDIT_TEST_TOKEN }, { status: 429, headers: { 'Retry-After': '30' } });
        const entries = structuredClone(raw[form]);
        if (mode === 'invalid' && form === 'child') delete entries[0].relationships.user;
        if (mode === 'duplicate' && form === 'main') entries.push(entries[0]);
        return Response.json({ meta: { last_page: mode === 'limit' ? 20 : Math.ceil(entries.length / perPage) },
            data: { entries: entries.slice((page - 1) * perPage, page * perPage) } });
    };
    const get = (q = {}) => audit.findAudit(connection, parseAuditQuery(q));
    await t.test('los datos previos quedan pendientes, sin tomar created_by como identidad', async () => {
        const before = await get(); assert.equal(before.summary.total, 4); assert.equal(before.summary.pending, 4);
        assert.equal(before.summary.surveyors, 0); assert.ok(before.rows.every((r) => r.surveyor_id === null));
    });
    await t.test('migración repetible y consulta paginada por formulario y rama, sin una petición por registro', async () => {
        const setup = await database.connect(); try { await migrateAudit(setup); } finally { setup.release(); }
        assert.deepEqual(await audit.refreshAudit(connection), { received: 4, matched: 4, unmatched: 0 });
        assert.equal(calls.length, 4); const result = await get();
        assert.equal(result.summary.identified, 3); assert.equal(result.summary.anonymous, 1); assert.equal(result.summary.surveyors, 2);
        assert.equal(result.surveyors.find((s) => s.surveyor_id === '42').branch_records, 1);
        const separate = await audit.findAudit(other, parseAuditQuery({})); assert.equal(separate.summary.pending, 4);
        assert.ok(result.columns.some((c) => c.input_ref === 'answer'));
    });
    await t.test('idempotencia de la identidad y conservación del documento, estados y cursores', async () => {
        const before = (await database.query('SELECT * FROM entradas_staging ORDER BY project_id,form_ref,entry_uuid')).rows;
        await database.query("UPDATE entradas_staging SET validation_status = 'approved' WHERE project_id = $1 AND entry_uuid = $2", [projectId, ids[0]]);
        await audit.refreshAudit(connection);
        assert.equal((await database.query('SELECT count(*)::integer AS n FROM staging_entry_audit')).rows[0].n, 4);
        const after = (await database.query('SELECT * FROM entradas_staging ORDER BY project_id,form_ref,entry_uuid')).rows;
        assert.deepEqual(after.map((r) => ({ ...r, validation_status: null })), before.map((r) => ({ ...r, validation_status: null })));
        assert.equal((await get({ validation_status: 'approved' })).summary.total, 1);
        assert.equal((await get({ surveyor_id: '42', validation_status: 'approved' })).summary.total, 1);
    });
    await t.test('fechas inclusivas UTC, paginación estable, anónimos y filtros combinados', async () => {
        const filtered = await get({ surveyor_id: '42', date_from: '2026-10-27', date_to: '2026-10-27' });
        assert.equal(filtered.summary.total, 1); assert.equal(filtered.rows[0].entry_uuid, ids[2]);
        assert.equal((await get({ date_from: '2026-10-27', date_to: '2026-10-27' })).summary.total, 2);
        assert.equal((await get({ date_field: 'uploaded_at_epicollect', date_from: '2026-10-27', date_to: '2026-10-27' })).summary.total, 4);
        const first = await get({ page_size: '2' }); const second = await get({ page_size: '2', page: '2' });
        assert.equal(new Set([...first.rows, ...second.rows].map((r) => r.row_key)).size, 4);
        assert.equal((await get({ audit_status: 'anonymous' })).summary.total, 1);
        assert.equal((await audit.findAudit({ ...connection, form_ref: 'visits' }, parseAuditQuery({}))).summary.total, 1);
        assert.equal((await get({ surveyor_id: '999' })).summary.total, 0);
    });
    await t.test('directorio local autorizado, transaccional y aislado por procedencia', async () => {
        const client = await database.connect();
        try {
            await replaceSurveyors(client, connection, { source: 'Directorio ficticio de QA', surveyors: [{ surveyor_id: 42, display_name: 'Encuestadora de prueba' }] });
            const result = await get({ surveyor_id: '42' }); assert.equal(result.rows[0].surveyor_name, 'Encuestadora de prueba');
            await assert.rejects(replaceSurveyors(client, connection, { source: 'QA', surveyors: [{ surveyor_id: 42, display_name: 'A' }, { surveyor_id: '042', display_name: 'B' }] }), { code: 'AUDIT_DIRECTORY_INVALID' });
            assert.equal((await get({ surveyor_id: '42' })).rows[0].surveyor_name, 'Encuestadora de prueba');
            assert.ok((await audit.findAudit(other, parseAuditQuery({}))).rows.every((r) => !r.surveyor_name));
        } finally { client.release(); }
    });
    await t.test('una edición posterior invalida la identidad; una nueva consulta sólo vincula la versión coincidente', async () => {
        await database.query("UPDATE entradas_staging SET uploaded_at_epicollect = uploaded_at_epicollect + interval '1 second' WHERE project_id=$1 AND entry_uuid=$2", [projectId, ids[0]]);
        const result = await get({ audit_status: 'stale' }); assert.equal(result.summary.total, 1); assert.equal(result.rows[0].surveyor_id, null); assert.equal(result.rows[0].surveyor_name, null);
        const refreshed = await audit.refreshAudit(connection); assert.equal(refreshed.unmatched, 1);
        assert.equal((await get({ audit_status: 'pending' })).summary.total, 1);
        raw.main[0].entry.uploaded_at = '2026-10-27T08:00:01.000Z';
        await audit.refreshAudit(connection); assert.equal((await get({ audit_status: 'identified' })).summary.total, 3);
    });
    for (const [failure,code] of [['http','EPICOLLECT_HTTP_ERROR'],['invalid','AUDIT_RESPONSE_INVALID'],['duplicate','AUDIT_RESPONSE_INVALID'],['limit','AUDIT_PAGE_LIMIT'],['429','EPICOLLECT_HTTP_ERROR']]) {
        await t.test(`un fallo ${failure} conserva toda la auditoría anterior`, async () => {
            const before = (await database.query('SELECT * FROM staging_entry_audit ORDER BY project_id,form_ref,entry_uuid')).rows;
            mode = failure; await assert.rejects(audit.refreshAudit(connection), { code }); mode = null;
            assert.deepEqual((await database.query('SELECT * FROM staging_entry_audit ORDER BY project_id,form_ref,entry_uuid')).rows, before);
        });
    }
    await t.test('concurrencia entre procesos: sólo una actualización por proyecto', async () => {
        let release; let ready;
        const arrived = new Promise((r) => { ready = r; }); const hold = new Promise((r) => { release = r; });
        block = async () => { ready(); await hold; };
        const running = audit.refreshAudit(connection); await arrived;
        try { await assert.rejects(audit.refreshAudit(connection), { code: 'AUDIT_ALREADY_RUNNING' }); }
        finally { block = null; release(); await running; }
    });
    await t.test('una conexión cambiada durante la consulta revierte la escritura', async () => {
        const before = (await database.query('SELECT * FROM staging_entry_audit ORDER BY project_id,form_ref,entry_uuid')).rows;
        block = async () => { block = null; await database.query('UPDATE api_connections SET is_active=false WHERE id=$1', [connection.id]); };
        await assert.rejects(audit.refreshAudit(connection), { code: 'CONNECTION_CHANGED' });
        assert.deepEqual((await database.query('SELECT * FROM staging_entry_audit ORDER BY project_id,form_ref,entry_uuid')).rows, before);
        await database.query('UPDATE api_connections SET is_active=true WHERE id=$1', [connection.id]);
    });
    await t.test('HTTP: parámetros inválidos, fallos seguros y ausencia de secretos en respuestas', async () => {
        server = require('../../src/app').listen(process.env.AUDIT_PREVIEW === '1' ? 3015 : 0, '127.0.0.1');
        await new Promise((resolve) => server.once('listening', resolve));
        const base = `http://127.0.0.1:${server.address().port}/api/audit/connections`;
        const response = await original.fetch(`${base}/${connection.id}?surveyor_id=42`); assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        const body = await response.text(); assert.equal(body.includes('TEST_AUDIT_SECRET'), false); assert.equal(body.includes('token_env'), false);
        assert.equal((await original.fetch(`${base}/${connection.id}?surveyor_id=1&surveyor_id=2`)).status, 400);
        mode = 'http'; const failure = await original.fetch(`${base}/${connection.id}/refresh`, { method: 'POST' }); mode = null;
        assert.equal(failure.status, 502); assert.equal((await failure.text()).includes('TEST_AUDIT_SECRET'), false);
        assert.equal((await original.fetch(`${base}/${randomUUID()}`)).status, 404);
        assert.equal((await original.fetch(`${base}/not-a-uuid`)).status, 400);
    });
    await t.test('el acceso de exportación no se usa como credencial de identidad, y una configuración ambigua se rechaza', async () => {
        const count = calls.length;
        await assert.rejects(audit.refreshAudit(other), { code: 'AUDIT_SOURCE_UNAVAILABLE' }); assert.equal(calls.length, count);
        sources.push({ ...sources[0] }); await saveSources();
        await assert.rejects(audit.refreshAudit(connection), { code: 'AUDIT_CONFIG_INVALID' }); assert.equal(calls.length, count);
        sources.pop(); await saveSources();
    });
    if (process.env.AUDIT_PREVIEW === '1') {
        // Vista manual opcional sobre el mismo conjunto ficticio; nunca usa el esquema de trabajo.
        console.log('AUDIT_PREVIEW_API=http://127.0.0.1:3015/api');
        await new Promise((resolve) => {
            require('../../src/app').post('/__audit-preview-stop', (req, res) => { res.json({ stopped: true }); resolve(); });
        });
    }
});
