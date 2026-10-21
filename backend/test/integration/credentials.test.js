const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { Client } = require('pg');
const { migrateCredentials, assertCredentialStorage } = require('../../src/services/credentialStorage.service');
const { migrateOAuth } = require('../../src/services/oauthStorage.service');
const { migrateHierarchy } = require('../../src/services/hierarchyStorage.service');

test('migración y API de conexiones con PostgreSQL', {
    skip: !process.env.TEST_DATABASE_URL,
}, async (t) => {
    const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await client.connect();
    // Aislamiento: las pruebas nunca escriben en las tablas del esquema public.
    const schema = `credentials_test_${randomBytes(8).toString('hex')}`;
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}, public`);
    const previousKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
    process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    const pool = require('../../src/config/db');
    const originalQuery = pool.query;
    const originalConnect = pool.connect;
    pool.query = client.query.bind(client);
    pool.connect = async () => ({ query: client.query.bind(client), release() {} });
    const model = require('../../src/models/apiConnection.model');
    const cryptoService = require('../../src/services/credentialCrypto.service');
    let server;
    const realFetch = global.fetch;
    let externalStatus = 200;
    let expectedToken = 'token-de-prueba-1';
    const entryId = randomUUID();
    let outgoingCalls = 0;
    const callsLogged = [];
    const originalConsoleError = console.error;
    console.error = (...args) => callsLogged.push(args);
    t.after(async () => {
        console.error = originalConsoleError;
        global.fetch = realFetch;
        if (server) await new Promise((resolve) => server.close(resolve));
        pool.query = originalQuery;
        pool.connect = originalConnect;
        await pool.end();
        await client.query('SET search_path TO public');
        await client.query(`DROP SCHEMA ${schema} CASCADE`);
        await client.end();
        if (previousKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
        else process.env.CREDENTIAL_ENCRYPTION_KEY = previousKey;
    });
    const migrationDir = path.resolve(__dirname, '../../../database/migrations');
    const sql = await readFile(path.resolve(__dirname, '../fixtures/api_connections_pre_oauth.sql'), 'utf8');
    // Reconstruir el esquema anterior para probar la migración desde una BD existente.
    const legacy = sql.replace('token_encrypted TEXT,', 'auth_token TEXT NOT NULL,')
        .replace(/    CONSTRAINT api_connections_credential_check[\s\S]*?    CONSTRAINT api_connections_last_test_status_check/,
            '    CONSTRAINT api_connections_last_test_status_check');
    await client.query(legacy);
    await client.query(await readFile(path.join(migrationDir, 'entradas_staging.sql'), 'utf8'));
    await client.query(await readFile(path.join(migrationDir, 'sync_controls.sql'), 'utf8'));
    await client.query(await readFile(path.join(migrationDir, 'sync_logs.sql'), 'utf8'));
    const publicId = randomUUID();
    const privateId = randomUUID();
    await client.query(`INSERT INTO api_connections
        (id, name, project_slug, base_url, auth_type, auth_token)
        VALUES ($1, 'Pública', 'public-test', 'https://five.epicollect.net/api', 'none', 'NO_AUTH_REQUIRED'),
               ($2, 'Privada', 'private-test', 'https://five.epicollect.net/api', 'bearer', $3)`,
    [publicId, privateId, expectedToken]);

    await t.test('el arranque detecta el esquema anterior', async () => {
        await assert.rejects(assertCredentialStorage(client), { code: 'CREDENTIAL_MIGRATION_REQUIRED' });
    });
    await t.test('un token inválido revierte toda la migración, incluido el cambio de esquema', async () => {
        await client.query("UPDATE api_connections SET auth_token = '' WHERE id = $1", [privateId]);
        await assert.rejects(migrateCredentials(client), { code: 'INVALID_CREDENTIAL' });
        const columns = await client.query(`SELECT column_name FROM information_schema.columns
            WHERE table_schema = $1 AND table_name = 'api_connections'`, [schema]);
        assert.equal(columns.rows.some((x) => x.column_name === 'auth_token'), true);
        assert.equal(columns.rows.some((x) => x.column_name === 'token_encrypted'), false);
        await client.query('UPDATE api_connections SET auth_token = $2 WHERE id = $1', [privateId, expectedToken]);
    });
    await t.test('migra tokens y conexiones públicas sin perder registros ni conservar la columna plana', async () => {
        assert.deepEqual(await migrateCredentials(client), { migrated: true, encrypted: 1, withoutAuth: 1 });
        const { rows } = await client.query('SELECT id, auth_type, token_encrypted FROM api_connections ORDER BY name');
        assert.equal(rows.length, 2);
        assert.equal(rows.find((x) => x.id === publicId).token_encrypted, null);
        assert.equal(cryptoService.decryptCredential(rows.find((x) => x.id === privateId).token_encrypted, privateId), expectedToken);
        const removed = await client.query(`SELECT 1 FROM information_schema.columns
            WHERE table_schema = $1 AND table_name = 'api_connections' AND column_name = 'auth_token'`, [schema]);
        assert.equal(removed.rows.length, 0);
        await assertCredentialStorage(client);
        assert.equal((await migrateCredentials(client)).migrated, false);
    });
    await t.test('una clave equivocada bloquea el uso del almacén y no recifra los datos', async () => {
        const key = process.env.CREDENTIAL_ENCRYPTION_KEY;
        const before = await client.query('SELECT token_encrypted FROM api_connections WHERE id = $1', [privateId]);
        process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('hex');
        await assert.rejects(assertCredentialStorage(client), { code: 'CREDENTIAL_DECRYPT_FAILED' });
        await assert.rejects(migrateCredentials(client), { code: 'CREDENTIAL_DECRYPT_FAILED' });
        process.env.CREDENTIAL_ENCRYPTION_KEY = key;
        const after = await client.query('SELECT token_encrypted FROM api_connections WHERE id = $1', [privateId]);
        assert.deepEqual(before.rows, after.rows);
    });

    await migrateOAuth(client);
    await migrateHierarchy(client);

    global.fetch = async (url, options) => {
        if (!String(url).startsWith('https://five.epicollect.net/api/')) return realFetch(url, options);
        if (String(url).includes('/export/project/')) return Response.json({ data: { project: {
            slug: String(url).split('/').at(-1), forms: [{ ref: 'test-form', inputs: [] }],
        } } });
        outgoingCalls += 1;
        assert.equal(options.headers.Authorization, `Bearer ${expectedToken}`);
        return new Response(JSON.stringify(externalStatus === 200
            ? { meta: { total: 1, last_page: 1 }, data: { entries: [{
                ec5_uuid: entryId, created_at: '2026-09-01T10:00:00.000Z',
                uploaded_at: '2026-09-01T10:00:00.000Z', answer: 'dato de control',
            }] } }
            : { error: expectedToken }), { status: externalStatus, headers: { 'Content-Type': 'application/json' } });
    };
    const app = require('../../src/app');
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}/api`;
    async function request(method, route, body) {
        const response = await realFetch(base + route, { method, headers: { 'Content-Type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        const data = await response.json();
        const serialized = JSON.stringify(data);
        assert.equal(serialized.includes('token-de-prueba'), false);
        assert.equal(serialized.includes('"token_encrypted"'), false);
        assert.equal(serialized.includes('"auth_token":'), false);
        return { status: response.status, data };
    }
    await t.test('listar, leer y renombrar conserva el token y publica sólo su indicador', async () => {
        const before = await client.query('SELECT token_encrypted FROM api_connections WHERE id = $1', [privateId]);
        assert.equal((await request('GET', '/connections')).status, 200);
        assert.equal((await request('GET', `/connections/${privateId}`)).data.data.has_auth_token, true);
        const updated = await request('PUT', `/connections/${privateId}`, { name: 'Renombrada' });
        assert.equal(updated.status, 200);
        assert.equal(updated.data.data.has_auth_token, true);
        assert.deepEqual(before.rows, (await client.query('SELECT token_encrypted FROM api_connections WHERE id = $1', [privateId])).rows);
        const internal = await model.findConnectionWithTokenById(privateId);
        assert.equal(internal.auth_token, expectedToken);
        assert.equal(JSON.stringify(internal).includes(expectedToken), false);
    });
    await t.test('probar y sincronizar descifra sólo para la solicitud y conserva historial', async () => {
        assert.equal((await request('PATCH', `/connections/${privateId}/test`)).status, 200);
        assert.equal((await request('PATCH', `/connections/${privateId}/sync`)).status, 200);
        assert.equal(outgoingCalls, 2);
        const staging = await client.query('SELECT ec5_uuid FROM entradas_staging WHERE project_slug = $1', ['private-test']);
        assert.deepEqual(staging.rows.map((row) => row.ec5_uuid), [entryId]);
        const logs = await client.query('SELECT status FROM sync_logs WHERE api_connection_id = $1', [privateId]);
        assert.equal(logs.rows[0].status, 'success');
    });
    await t.test('un error remoto que repite el token no llega a respuestas, logs ni mensajes guardados', async () => {
        externalStatus = 401;
        assert.equal((await request('PATCH', `/connections/${privateId}/test`)).status, 502);
        assert.equal((await request('PATCH', `/connections/${privateId}/sync`)).status, 502);
        const messages = await client.query(`SELECT last_error_message, last_sync_error_message, last_sync_summary
            FROM api_connections WHERE id = $1`, [privateId]);
        const logs = await client.query('SELECT error_message, summary FROM sync_logs WHERE api_connection_id = $1', [privateId]);
        assert.equal(JSON.stringify([messages.rows, logs.rows, callsLogged]).includes(expectedToken), false);
        externalStatus = 200;
    });
    await t.test('reemplaza el token, lo elimina al pasar a none y exige uno nuevo al volver a bearer', async () => {
        expectedToken = 'token-de-prueba-2';
        assert.equal((await request('PUT', `/connections/${privateId}`, { auth_token: expectedToken })).status, 200);
        assert.equal((await request('PATCH', `/connections/${privateId}/test`)).status, 200);
        const cleared = await request('PUT', `/connections/${privateId}`, { auth_type: 'none' });
        assert.equal(cleared.data.data.has_auth_token, false);
        assert.equal((await client.query('SELECT token_encrypted FROM api_connections WHERE id = $1', [privateId])).rows[0].token_encrypted, null);
        assert.equal((await request('PUT', `/connections/${privateId}`, { auth_type: 'bearer' })).status, 400);
        assert.equal((await request('PUT', `/connections/${privateId}`, { auth_type: 'bearer', auth_token: expectedToken })).status, 200);
    });
    await t.test('crear conexiones nuevas guarda cifrado o NULL según el tipo de autenticación', async () => {
        const payload = { name: 'Nueva', project_slug: 'created-test', base_url: 'https://five.epicollect.net/api', auth_type: 'bearer', auth_token: expectedToken };
        const result = await request('POST', '/connections', payload);
        assert.equal(result.status, 201);
        const row = (await client.query('SELECT token_encrypted FROM api_connections WHERE id = $1', [result.data.data.id])).rows[0];
        assert.equal(cryptoService.decryptCredential(row.token_encrypted, result.data.data.id), expectedToken);
        const publicResult = await request('POST', '/connections', { ...payload, project_slug: 'another-public', auth_type: 'none', auth_token: undefined });
        assert.equal(publicResult.status, 201);
        assert.equal(publicResult.data.data.has_auth_token, false);
    });
    await t.test('una falla al guardar el resultado no devuelve trazas ni el error interno', async () => {
        const original = model.updateConnectionTestStatus;
        model.updateConnectionTestStatus = async () => { throw new Error('token-de-prueba /ruta/privada'); };
        try {
            const result = await request('PATCH', `/connections/${privateId}/test`);
            assert.equal(result.status, 500);
            assert.equal(result.data.code, 'INTERNAL_ERROR');
            assert.equal(JSON.stringify(result.data).includes('/ruta'), false);
        } finally {
            model.updateConnectionTestStatus = original;
        }
    });
    await t.test('una instalación nueva admite conexiones públicas y cifradas sin migración de datos', async () => {
        const freshSchema = `${schema}_fresh`;
        await client.query(`CREATE SCHEMA ${freshSchema}`);
        try {
            await client.query(`SET search_path TO ${freshSchema}, public`);
            for (const file of ['api_conection.sql', 'entradas_staging.sql', 'indices_staging.sql', 'sync_controls.sql', 'sync_logs.sql']) {
                await client.query(await readFile(path.join(migrationDir, file), 'utf8'));
            }
            await assertCredentialStorage(client);
            const created = await model.createConnection({ name: 'Inicial', project_slug: 'fresh',
                base_url: 'https://five.epicollect.net/api', auth_type: 'bearer', auth_token: expectedToken });
            assert.equal(created.has_auth_token, true);
            assert.equal((await model.findConnectionWithTokenById(created.id)).auth_token, expectedToken);
            assert.equal((await migrateCredentials(client)).migrated, false);
        } finally {
            await client.query(`SET search_path TO ${schema}, public`);
            await client.query(`DROP SCHEMA ${freshSchema} CASCADE`);
        }
    });
    await t.test('un cifrado alterado impide la solicitud saliente sin revelar su contenido', async () => {
        await client.query("UPDATE api_connections SET token_encrypted = 'v1.invalid.invalid.invalid' WHERE id = $1", [privateId]);
        const before = outgoingCalls;
        const result = await request('PATCH', `/connections/${privateId}/test`);
        assert.equal(result.status, 502);
        assert.equal(result.data.code, 'CREDENTIAL_DECRYPT_FAILED');
        assert.equal(outgoingCalls, before);
    });
});
