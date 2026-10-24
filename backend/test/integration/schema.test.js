const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { Client } = require('pg');
const { migrateOAuth } = require('../../src/services/oauthStorage.service');
const { migrateHierarchy, assertHierarchyStorage, saveProjectHierarchy } = require('../../src/services/hierarchyStorage.service');
const { parseProjectHierarchy } = require('../../src/services/projectHierarchy.service');
const publicDefinition = require('../fixtures/public_project_schema.json');

test('esquema declarado, histórico y consultas con PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
    const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await client.connect();
    const schema = `declared_test_${randomBytes(8).toString('hex')}`;
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}, public`);
    const priorEnv = { CREDENTIAL_ENCRYPTION_KEY: process.env.CREDENTIAL_ENCRYPTION_KEY,
        EPICOLLECT_API_BASE_URLS: process.env.EPICOLLECT_API_BASE_URLS };
    process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    process.env.EPICOLLECT_API_BASE_URLS = 'https://five.epicollect.net/api,https://encuestas.example.org/api';
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
        for (const [key, value] of Object.entries(priorEnv)) {
            if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
    });
    const migrationDir = path.resolve(__dirname, '../../../database/migrations');
    for (const file of ['api_conection.sql', 'entradas_staging.sql', 'sync_controls.sql', 'sync_logs.sql']) {
        await client.query(await readFile(path.join(migrationDir, file), 'utf8'));
    }
    await migrateOAuth(client);
    await migrateHierarchy(client);
    const definition = structuredClone(publicDefinition);
    definition.data.project.slug = `schema-${randomBytes(4).toString('hex')}`;
    const form = definition.data.project.forms[0];
    const nameRef = form.inputs[0].ref;
    const ageRef = form.inputs[1].ref;
    const sexRef = form.inputs[3].ref;
    const base = 'https://five.epicollect.net/api';
    const model = require('../../src/models/apiConnection.model');
    const staging = require('../../src/models/stagingEntry.model');
    const connection = await model.createConnection({ name: 'Esquema', project_slug: definition.data.project.slug,
        base_url: base, auth_type: 'none', sync_per_page: 500, sync_max_pages: 10, sync_delay_ms: 0 });
    const projectId = await saveProjectHierarchy(client, base, parseProjectHierarchy(definition, connection.project_slug));
    const firstId = randomUUID();
    const legacyPayload = { ec5_uuid: firstId, name: 'Ana', sex: 'M', uploaded_at: '2026-10-01T10:00:00Z' };
    await client.query(`INSERT INTO entradas_staging (project_id, project_slug, form_ref, entry_uuid, ec5_uuid,
        record_type, payload, sync_status, validation_status) VALUES ($1,$2,$3,$4,$4,'form',$5::jsonb,'reviewed','approved')`,
    [projectId, connection.project_slug, form.ref, firstId, JSON.stringify(legacyPayload)]);
    await client.query(`INSERT INTO connection_streams (connection_id, project_id, form_ref, sync_cursor)
        VALUES ($1,$2,$3,'2026-10-01T10:00:00Z')`, [connection.id, projectId, form.ref]);
    const before = (await client.query('SELECT * FROM entradas_staging WHERE project_id = $1', [projectId])).rows[0];
    await client.query('ALTER TABLE entradas_staging DROP COLUMN field_values');
    await t.test('actualiza el modelo anterior usando su mapeo guardado y conserva documentos, estados y fechas', async () => {
        await assert.rejects(assertHierarchyStorage(client), { code: 'STAGING_MIGRATION_REQUIRED' });
        await migrateHierarchy(client);
        const saved = (await client.query('SELECT * FROM entradas_staging WHERE project_id = $1', [projectId])).rows[0];
        assert.equal(saved.field_values[nameRef], 'Ana');
        assert.equal(saved.field_values[sexRef], form.inputs[3].possible_answers[0].answer_ref);
        for (const field of ['payload', 'sync_status', 'validation_status', 'received_at', 'updated_at']) assert.deepEqual(saved[field], before[field]);
        assert.equal((await client.query('SELECT sync_cursor FROM connection_streams WHERE connection_id = $1', [connection.id])).rows[0].sync_cursor, null);
        await client.query("UPDATE connection_streams SET sync_cursor = '2026-10-01T10:00:00Z'");
        await migrateHierarchy(client);
        assert.notEqual((await client.query('SELECT sync_cursor FROM connection_streams WHERE connection_id = $1', [connection.id])).rows[0].sync_cursor, null);
        await client.query('UPDATE connection_streams SET sync_cursor = NULL');
    });

    let entries = [{ ec5_uuid: firstId, '1_Name': 'Ana', '2_Age': '2', '4_Sex': 'Male', uploaded_at: '2026-10-01T10:00:00Z' },
        { ec5_uuid: randomUUID(), '1_Name': 'Bruno', '2_Age': '10', '4_Sex': 'Female', uploaded_at: '2026-10-01T10:01:00Z' }];
    const calls = [];
    global.fetch = async (url, options) => {
        if (!String(url).startsWith('https://')) return realFetch(url, options);
        const parsed = new URL(url);
        if (parsed.pathname.includes('/export/project/')) return Response.json(definition);
        calls.push(parsed);
        assert.equal(parsed.searchParams.get('map_index'), '0');
        const from = parsed.searchParams.get('filter_from');
        const selected = parsed.searchParams.has('branch_ref') ? []
            : entries.filter((entry) => !from || new Date(entry.uploaded_at) >= new Date(from));
        return Response.json({ meta: { last_page: 1, total: selected.length }, data: { entries: selected } });
    };
    const app = require('../../src/app');
    server = await new Promise((resolve) => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    const local = `http://127.0.0.1:${server.address().port}/api`;
    async function request(method, route) {
        const response = await realFetch(local + route, { method });
        return { status: response.status, data: await response.json() };
    }
    const sync = () => request('PATCH', `/connections/${connection.id}/sync`);
    const list = (extra = {}) => request('GET', '/staging/entries?' + new URLSearchParams({
        project_slug: connection.project_slug, source_base_url: base, ...extra }));
    let columns;
    await t.test('descarga EC5_AUTO, muestra preguntas declaradas y expone tipos, etiquetas y ocultación', async () => {
        assert.equal((await sync()).status, 200);
        const result = await list();
        assert.equal(result.status, 200);
        assert.equal(result.data.data.schema.source, 'project_definition');
        columns = result.data.data.columns;
        assert.equal(columns.filter((column) => column.source === 'field_values').length, 7);
        assert.equal(columns.find((column) => column.input_ref === ageRef).hidden, true);
        assert.equal(columns.find((column) => column.input_ref === ageRef).type, 'number');
        assert.equal(result.data.data.rows.find((row) => row.entry_uuid === firstId).field_values[ageRef], 2);
        assert.equal(calls.length, 2);
    });
    await t.test('ordena valores numéricos y filtra opciones mediante su referencia', async () => {
        const age = columns.find((column) => column.input_ref === ageRef);
        const sex = columns.find((column) => column.input_ref === sexRef);
        const sorted = await list({ sort_by: age.key, sort_order: 'asc' });
        assert.equal(sorted.status, 200, JSON.stringify(sorted.data));
        assert.deepEqual(sorted.data.data.rows.map((row) => row.field_values[ageRef]), [2, 10]);
        const filtered = await list({ filters: JSON.stringify([{ field: sex.key, operator: 'eq', value: sex.options[0].value }]) });
        assert.equal(filtered.status, 200);
        assert.equal(filtered.data.data.pagination.total, 1);
        assert.equal(filtered.data.data.rows[0].entry_uuid, firstId);
    });
    await t.test('un cambio de nombre no duplica columnas ni pierde respuestas históricas fuera del intervalo incremental', async () => {
        const nameKey = columns.find((column) => column.input_ref === nameRef).key;
        form.inputs[0].question = 'Nombre completo';
        definition.meta.project_mapping[0].forms[form.ref][nameRef].map_to = 'renamed_name';
        form.inputs.push({ ref: 'new_question', type: 'text', question: 'Pregunta sin respuestas', possible_answers: [] });
        definition.meta.project_mapping[0].forms[form.ref].new_question = { map_to: 'new_question' };
        await client.query("UPDATE connection_streams SET sync_cursor = '2026-10-03T10:00:00Z' WHERE connection_id = $1", [connection.id]);
        const result = await sync();
        assert.equal(result.status, 200);
        assert.equal(result.data.data.sync.database.processed, 0);
        const listed = await list();
        const same = listed.data.data.columns.filter((column) => column.input_ref === nameRef);
        assert.equal(same.length, 1);
        assert.equal(same[0].key, nameKey);
        assert.match(same[0].label, /Nombre completo/);
        assert.equal(listed.data.data.rows.find((row) => row.entry_uuid === firstId).field_values[nameRef], 'Ana');
        assert.ok(listed.data.data.columns.some((column) => column.input_ref === 'new_question'));
        entries = [...entries, { ec5_uuid: randomUUID(), renamed_name: 'Carla', '2_Age': '30', '4_Sex': 'Female', uploaded_at: '2026-10-04T10:00:00Z' }];
        assert.equal((await sync()).status, 200);
        const after = await list({ filters: JSON.stringify([{ field: nameKey, operator: 'eq', value: 'Carla' }]) });
        assert.equal(after.data.data.pagination.total, 1);
        assert.equal(after.data.data.rows[0].field_values[nameRef], 'Carla');
    });
    await t.test('nuevas opciones y etiquetas aparecen tras sincronizar sin modificar el código', async () => {
        form.inputs[3].possible_answers[0].answer = 'Etiqueta actualizada';
        form.inputs[3].possible_answers.push({ answer_ref: 'new_option', answer: 'Nueva opción' });
        definition.meta.project_mapping[0].forms[form.ref][sexRef].possible_answers.new_option = { map_to: 'Nueva opción' };
        assert.equal((await sync()).status, 200);
        const listed = await list();
        const sex = listed.data.data.columns.find((column) => column.input_ref === sexRef);
        assert.equal(sex.options[0].label, 'Etiqueta actualizada');
        assert.ok(sex.options.some((option) => option.value === 'new_option'));
    });
    await t.test('rechaza preguntas de otro proyecto y no interpola referencias en las consultas SQL', async () => {
        const key = columns.find((column) => column.input_ref === nameRef).key;
        const invalid = key.replace(projectId, randomUUID());
        assert.equal((await list({ sort_by: invalid })).status, 400);
        assert.equal((await list({ filters: JSON.stringify([{ field: key + "';DROP TABLE entradas_staging;--", operator: 'eq', value: 'Ana' }]) })).status, 400);
        assert.equal((await client.query('SELECT count(*)::integer AS total FROM entradas_staging')).rows[0].total, 3);
    });
    await t.test('una definición inválida conserva filas y marcadores', async () => {
        const beforeRows = (await client.query('SELECT * FROM entradas_staging ORDER BY entry_uuid')).rows;
        const beforeCursors = (await client.query('SELECT * FROM connection_streams ORDER BY form_ref')).rows;
        form.inputs.push(structuredClone(form.inputs[0]));
        assert.equal((await sync()).status, 502);
        assert.deepEqual((await client.query('SELECT * FROM entradas_staging ORDER BY entry_uuid')).rows, beforeRows);
        assert.deepEqual((await client.query('SELECT * FROM connection_streams ORDER BY form_ref')).rows, beforeCursors);
        form.inputs.pop();
    });
    await t.test('la API devuelve columnas aun cuando un filtro no encuentra registros', async () => {
        const key = columns.find((column) => column.input_ref === nameRef).key;
        const result = await list({ filters: JSON.stringify([{ field: key, operator: 'eq', value: 'No existe' }]) });
        assert.equal(result.status, 200);
        assert.equal(result.data.data.rows.length, 0);
        assert.ok(result.data.data.columns.some((column) => column.input_ref === 'new_question'));
    });
    await t.test('la selección múltiple usa coincidencia exacta de opción al filtrar', async () => {
        form.inputs.push({ ref: 'tags', type: 'checkbox', question: 'Etiquetas', possible_answers: [
            { answer_ref: 'a', answer: 'Primera' }, { answer_ref: 'aa', answer: 'Segunda' }] });
        definition.meta.project_mapping[0].forms[form.ref].tags = { map_to: 'tags', possible_answers: {
            a: { map_to: 'Primera' }, aa: { map_to: 'Segunda' },
        } };
        entries = [{ ...entries[0], renamed_name: 'Ana', tags: ['Segunda'], uploaded_at: '2026-10-05T10:00:00Z' }];
        assert.equal((await sync()).status, 200);
        const all = await list();
        const tags = all.data.data.columns.find((column) => column.input_ref === 'tags');
        const exact = await list({ filters: JSON.stringify([{ field: tags.key, operator: 'eq', value: 'a' }]) });
        assert.equal(exact.status, 200, JSON.stringify(exact.data));
        assert.equal(exact.data.data.rows.length, 0);
        const chosen = await list({ filters: JSON.stringify([{ field: tags.key, operator: 'eq', value: 'aa' }]) });
        assert.equal(chosen.data.data.rows.length, 1);
    });
});
