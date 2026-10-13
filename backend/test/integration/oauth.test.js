const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { Client } = require('pg');
const { assertOAuthStorage, migrateOAuth } = require('../../src/services/oauthStorage.service');
const { encryptCredential, decryptCredential } = require('../../src/services/credentialCrypto.service');
const { decryptOAuthCredentials } = require('../../src/services/oauthCredentials.service');

test('OAuth, migración y consultas con PostgreSQL y servidor Epicollect simulado', {
    skip: !process.env.TEST_DATABASE_URL,
}, async (t) => {
    const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await client.connect();
    const schema = `oauth_test_${randomBytes(8).toString('hex')}`;
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}, public`);
    const previousKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
    const previousBases = process.env.EPICOLLECT_API_BASE_URLS;
    process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    process.env.EPICOLLECT_API_BASE_URLS = 'https://five.epicollect.net/api,https://encuestas.example.org/api';
    const pool = require('../../src/config/db');
    const originalQuery = pool.query;
    const originalConnect = pool.connect;
    pool.query = client.query.bind(client);
    pool.connect = async () => ({ query: client.query.bind(client), release() {} });
    const model = require('../../src/models/apiConnection.model');
    const oauth = require('../../src/services/oauth.service');
    const epicollect = require('../../src/services/epicollect.service');
    const realFetch = global.fetch;
    const originalConsoleError = console.error;
    const logged = [];
    console.error = (...args) => logged.push(args);
    let server;
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
        for (const [name, value] of [['CREDENTIAL_ENCRYPTION_KEY', previousKey], ['EPICOLLECT_API_BASE_URLS', previousBases]]) {
            if (value === undefined) delete process.env[name]; else process.env[name] = value;
        }
    });
    const migrationDir = path.resolve(__dirname, '../../../database/migrations');
    await client.query(await readFile(path.resolve(__dirname, '../fixtures/api_connections_pre_oauth.sql'), 'utf8'));
    for (const file of ['entradas_staging.sql', 'sync_controls.sql', 'sync_logs.sql']) {
        await client.query(await readFile(path.join(migrationDir, file), 'utf8'));
    }
    const staticId = randomUUID();
    const oldCipher = encryptCredential('token-anterior', staticId);
    await client.query(`INSERT INTO api_connections (id, name, project_slug, base_url, auth_type, token_encrypted)
        VALUES ($1, 'Anterior', 'anterior', 'https://five.epicollect.net/api', 'bearer', $2)`, [staticId, oldCipher]);

    await t.test('requiere migración; la actualización es repetible y conserva exactamente el cifrado anterior', async () => {
        await assert.rejects(assertOAuthStorage(client), { code: 'OAUTH_MIGRATION_REQUIRED' });
        await migrateOAuth(client);
        await migrateOAuth(client);
        await assertOAuthStorage(client);
        const row = (await client.query('SELECT * FROM api_connections WHERE id = $1', [staticId])).rows[0];
        assert.equal(row.token_encrypted, oldCipher);
        assert.equal(row.oauth_credentials_encrypted, null);
        assert.equal((await model.findConnectionWithTokenById(staticId)).auth_token, 'token-anterior');
    });

    const clientId = 'client-id-oculto';
    const secret = 'client-secret-oculto';
    const entryId = randomUUID();
    let posts = 0;
    let gets = 0;
    let tokenReply = null;
    let getReply = null;
    const sent = [];
    function json(body, status = 200, headers = {}) {
        return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
    }
    const entries = [{ ec5_uuid: entryId, uploaded_at: '2026-10-01T10:00:00Z', created_at: '2026-10-01T10:00:00Z', answer: 'Prueba OAuth' }];
    const defaultEntries = () => json({ meta: { last_page: 1, total: 1 }, data: { entries } });
    global.fetch = async (url, options) => {
        if (!String(url).startsWith('https://')) return realFetch(url, options);
        assert.equal(options.redirect, 'error');
        if (String(url).endsWith('/oauth/token')) {
            posts += 1;
            assert.equal(options.method, 'POST');
            assert.equal(options.headers['Content-Type'], 'application/vnd.api+json');
            const body = JSON.parse(options.body);
            assert.equal(body.grant_type, 'client_credentials');
            assert.equal(body.client_id, clientId);
            assert.equal(body.client_secret, secret);
            return tokenReply ? tokenReply(url, options) : json({ token_type: 'Bearer', expires_in: 7200, access_token: `access-secreto-${posts}` });
        }
        gets += 1;
        sent.push({ url: String(url), authorization: options.headers.Authorization });
        assert.match(options.headers.Authorization, /^Bearer access-secreto-/);
        return getReply ? getReply(url, options) : defaultEntries();
    };
    const app = require('../../src/app');
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const local = `http://127.0.0.1:${server.address().port}/api`;
    async function request(method, route, body) {
        const response = await realFetch(local + route, { method, headers: { 'Content-Type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        const data = await response.json();
        const serialized = JSON.stringify(data);
        for (const forbidden of [clientId, secret, 'access-secreto-', 'oauth_credentials_encrypted', '"auth_token":', '"token_encrypted"']) {
            assert.equal(serialized.includes(forbidden), false, `Respuesta expone ${forbidden}`);
        }
        return { status: response.status, data };
    }
    async function create(base_url = 'https://five.epicollect.net/api') {
        tokenReply = null;
        getReply = null;
        const result = await request('POST', '/connections', { name: 'OAuth de prueba', provider: 'epicollect5',
            project_slug: `oauth-${randomBytes(4).toString('hex')}`, base_url, auth_type: 'oauth2',
            oauth_client_id: clientId, oauth_client_secret: secret });
        assert.equal(result.status, 201);
        return result.data.data;
    }
    async function row(connection) {
        return (await client.query('SELECT * FROM api_connections WHERE id = $1', [connection.id])).rows[0];
    }
    async function expire(connection) {
        await client.query(`UPDATE api_connections SET oauth_token_expires_at = now() - interval '1 minute',
            oauth_token_refresh_at = now() - interval '2 minutes' WHERE id = $1`, [connection.id]);
    }

    await t.test('crear, probar y sincronizar usa credenciales cifradas y reutiliza el token entre operaciones', async () => {
        const connection = await create();
        assert.equal(connection.has_oauth_credentials, true);
        assert.equal(connection.has_auth_token, false);
        assert.equal(connection.oauth_status, 'not_requested');
        assert.deepEqual(decryptOAuthCredentials((await row(connection)).oauth_credentials_encrypted, connection.id),
            { client_id: clientId, client_secret: secret });
        const before = posts;
        assert.equal((await request('PATCH', `/connections/${connection.id}/test`)).status, 200);
        assert.equal((await request('PATCH', `/connections/${connection.id}/sync`)).status, 200);
        assert.equal(posts, before + 1);
        const stored = await row(connection);
        assert.equal(decryptCredential(stored.token_encrypted, connection.id), `access-secreto-${posts}`);
        assert.ok(new Date(stored.oauth_token_refresh_at) < new Date(stored.oauth_token_expires_at));
        assert.equal(JSON.stringify(stored).includes(secret), false);
        assert.equal(JSON.stringify(stored).includes(clientId), false);
        const saved = await client.query('SELECT ec5_uuid FROM entradas_staging WHERE project_slug = $1', [connection.project_slug]);
        assert.deepEqual(saved.rows.map((x) => x.ec5_uuid), [entryId]);
        assert.equal((await request('GET', '/connections')).status, 200);
        assert.equal((await request('GET', `/connections/${connection.id}`)).data.data.oauth_status, 'valid');
        delete require.cache[require.resolve('../../src/services/oauth.service')];
        const reloaded = require('../../src/services/oauth.service');
        assert.equal(await reloaded.getAccessToken(connection), `access-secreto-${posts}`);
        assert.equal(posts, before + 1, 'la caché persiste al recargar el servicio');
    });

    await t.test('editar el nombre conserva credenciales y caché; reemplazar credenciales invalida el token', async () => {
        const connection = await create();
        await oauth.getAccessToken(connection);
        const before = await row(connection);
        assert.equal((await request('PUT', `/connections/${connection.id}`, { name: 'Renombrada' })).status, 200);
        assert.equal((await row(connection)).token_encrypted, before.token_encrypted);
        assert.equal((await row(connection)).oauth_credentials_encrypted, before.oauth_credentials_encrypted);
        assert.equal((await request('PUT', `/connections/${connection.id}`, { project_slug: 'otro' })).status, 400);
        assert.equal((await request('PUT', `/connections/${connection.id}`, { oauth_client_id: clientId })).status, 400);
        assert.equal((await request('PUT', `/connections/${connection.id}`, {
            oauth_client_id: clientId, oauth_client_secret: secret })).status, 200);
        assert.equal((await row(connection)).token_encrypted, null);
        assert.notEqual((await row(connection)).oauth_credentials_encrypted, before.oauth_credentials_encrypted);
        assert.equal((await request('PUT', `/connections/${connection.id}`, { auth_type: 'bearer' })).status, 400);
        assert.equal((await request('PUT', `/connections/${connection.id}`, { auth_type: 'none' })).status, 200);
        const cleared = await row(connection);
        for (const field of ['token_encrypted', 'oauth_credentials_encrypted', 'oauth_token_expires_at', 'oauth_token_refresh_at', 'oauth_error_code', 'oauth_retry_after']) {
            assert.equal(cleared[field], null);
        }
        assert.equal((await request('PUT', `/connections/${connection.id}`, { auth_type: 'oauth2' })).status, 400);
        assert.equal((await request('PUT', `/connections/${connection.id}`, { auth_type: 'bearer', auth_token: 'estatico' })).status, 200);
    });

    await t.test('renueva antes del vencimiento y al caducar; solicitudes simultáneas comparten una obtención', async () => {
        const connection = await create();
        const before = posts;
        const values = await Promise.all(Array.from({ length: 8 }, () => oauth.getAccessToken(connection)));
        assert.equal(new Set(values).size, 1);
        assert.equal(posts, before + 1);
        await client.query(`UPDATE api_connections SET oauth_token_expires_at = now() + interval '30 seconds',
            oauth_token_refresh_at = now() - interval '1 second' WHERE id = $1`, [connection.id]);
        await oauth.getAccessToken(connection);
        assert.equal(posts, before + 2);
        await expire(connection);
        await oauth.getAccessToken(connection);
        assert.equal(posts, before + 3);
    });

    await t.test('un 401 renueva una sola vez y repite la misma página; un 403 no solicita otro token', async () => {
        const connection = await create();
        await oauth.getAccessToken(connection);
        let failOnce = true;
        getReply = () => { if (failOnce) { failOnce = false; return json({ error: secret }, 401); } return defaultEntries(); };
        const before = posts;
        const getBefore = gets;
        await epicollect.testEpicollectConnection(connection);
        assert.equal(posts, before + 1);
        assert.equal(gets, getBefore + 2);
        assert.equal(sent.at(-1).url, sent.at(-2).url);
        getReply = () => json({ error: secret }, 403);
        await assert.rejects(epicollect.testEpicollectConnection(connection), { code: 'EPICOLLECT_HTTP_ERROR', statusCode: 403 });
        assert.equal(posts, before + 1);
    });

    await t.test('dos 401 detienen el reintento y evitan un bucle de emisión de tokens', async () => {
        const connection = await create();
        await oauth.getAccessToken(connection);
        getReply = () => json({ error: `${clientId} ${secret} access-secreto-` }, 401);
        const before = posts;
        const getBefore = gets;
        const response = await request('PATCH', `/connections/${connection.id}/test`);
        assert.equal(response.status, 502);
        assert.equal(response.data.code, 'EPICOLLECT_HTTP_ERROR');
        assert.equal(posts, before + 1);
        assert.equal(gets, getBefore + 2);
        assert.equal((await row(connection)).oauth_error_code, 'OAUTH_TOKEN_REJECTED');
        assert.equal((await request('PATCH', `/connections/${connection.id}/test`)).data.code, 'OAUTH_RETRY_LATER');
        assert.equal(posts, before + 1);
        assert.equal(gets, getBefore + 2);
    });

    await t.test('429 conserva Retry-After y bloquea nuevas solicitudes hasta que termina la espera', async () => {
        const connection = await create();
        tokenReply = () => json({ error: secret }, 429, { 'Retry-After': '120' });
        const now = Date.now();
        const before = posts;
        const result = await request('PATCH', `/connections/${connection.id}/test`);
        assert.equal(result.status, 502);
        assert.equal(result.data.code, 'OAUTH_RATE_LIMITED');
        const stored = await row(connection);
        assert.ok(new Date(stored.oauth_retry_after).getTime() >= now + 119000);
        await assert.rejects(oauth.getAccessToken(connection), { code: 'OAUTH_RETRY_LATER' });
        assert.equal(posts, before + 1);
        await client.query("UPDATE api_connections SET oauth_retry_after = now() - interval '1 second' WHERE id = $1", [connection.id]);
        tokenReply = null;
        await oauth.getAccessToken(connection);
        assert.equal(posts, before + 2);
        assert.equal((await row(connection)).oauth_error_code, null);
        assert.equal((await row(connection)).oauth_retry_after, null);
    });

    await t.test('credenciales rechazadas producen un error seguro; corregirlas permite volver a probar', async () => {
        const connection = await create();
        tokenReply = () => json({ error: `${clientId} ${secret}` }, 400);
        assert.equal((await request('PATCH', `/connections/${connection.id}/test`)).data.code, 'OAUTH_CREDENTIALS_REJECTED');
        assert.equal((await row(connection)).token_encrypted, null);
        assert.equal((await request('PUT', `/connections/${connection.id}`, { oauth_client_id: clientId, oauth_client_secret: secret })).status, 200);
        tokenReply = null;
        assert.equal((await request('PATCH', `/connections/${connection.id}/test`)).status, 200);
    });

    await t.test('respuestas OAuth incompletas, excesivas o fallos de red nunca guardan un token', async () => {
        const good = { token_type: 'Bearer', expires_in: 7200, access_token: 'access-secreto-ejemplo' };
        for (const invalid of [null, {}, { ...good, expires_in: 0 }, { ...good, expires_in: '1x' },
            { ...good, access_token: 'invalido\r\n' }, { ...good, token_type: 'Basic' },
            { ...good, access_token: 'x'.repeat(16385) }]) {
            const connection = await create();
            tokenReply = () => json(invalid);
            await assert.rejects(oauth.getAccessToken(connection), { code: 'OAUTH_RESPONSE_INVALID' });
            assert.equal((await row(connection)).token_encrypted, null);
        }
        for (const reply of [() => new Response('sin JSON'), () => new Response('x'.repeat(65537))]) {
            const connection = await create();
            tokenReply = reply;
            await assert.rejects(oauth.getAccessToken(connection), { code: 'OAUTH_RESPONSE_INVALID' });
        }
        const connection = await create();
        tokenReply = () => { throw new Error(secret); };
        assert.equal((await request('PATCH', `/connections/${connection.id}/test`)).data.code, 'OAUTH_UNAVAILABLE');
        const status = await client.query('SELECT last_error_message, oauth_error_code FROM api_connections WHERE id = $1', [connection.id]);
        assert.equal(JSON.stringify([status.rows, logged]).includes(secret), false);
    });

    await t.test('el timeout de OAuth cancela la petición y deja una espera recuperable', async () => {
        const connection = await create();
        tokenReply = (_url, options) => new Promise((resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
        });
        const originalSetTimeout = global.setTimeout;
        global.setTimeout = (fn, milliseconds, ...args) => originalSetTimeout(fn, milliseconds === 15000 ? 10 : milliseconds, ...args);
        try {
            await assert.rejects(oauth.getAccessToken(connection), { code: 'OAUTH_TIMEOUT' });
            assert.equal((await row(connection)).oauth_error_code, 'OAUTH_TIMEOUT');
        } finally { global.setTimeout = originalSetTimeout; }
    });

    await t.test('una instancia autorizada usa su propia URL; cambios o desactivación impiden usar un contexto obsoleto', async () => {
        const connection = await create('https://encuestas.example.org/api');
        let requestedUrl;
        tokenReply = (url) => { requestedUrl = url; return json({ token_type: 'bearer', expires_in: '7200', access_token: 'access-secreto-propio' }); };
        await epicollect.testEpicollectConnection(connection);
        assert.equal(requestedUrl, 'https://encuestas.example.org/api/oauth/token');
        assert.ok(sent.at(-1).url.startsWith('https://encuestas.example.org/api/export/entries/'));
        await model.setConnectionActiveStatus(connection.id, false);
        await assert.rejects(oauth.getAccessToken(connection), { code: 'CONNECTION_CHANGED' });
        await model.setConnectionActiveStatus(connection.id, true);
        await model.updateConnection(connection.id, { project_slug: 'otro-proyecto', oauth_client_id: clientId, oauth_client_secret: secret });
        await assert.rejects(oauth.getAccessToken(connection), { code: 'CONNECTION_CHANGED' });
        process.env.EPICOLLECT_API_BASE_URLS = 'https://five.epicollect.net/api';
        try {
            await assert.rejects(epicollect.testEpicollectConnection(connection), { code: 'EPICOLLECT_BASE_DENIED' });
        } finally { process.env.EPICOLLECT_API_BASE_URLS += ',https://encuestas.example.org/api'; }
    });

    await t.test('una renovación entre páginas conserva la secuencia y los registros descargados', async () => {
        const connection = await create();
        const before = posts;
        const ids = [randomUUID(), randomUUID()];
        const pages = [];
        getReply = async (url) => {
            const page = Number(new URL(url).searchParams.get('page'));
            pages.push(page);
            if (page === 1) await expire(connection);
            return json({ meta: { last_page: 2, total: 2 }, data: { entries: [{ ec5_uuid: ids[page - 1] }] } });
        };
        const result = await epicollect.fetchAllEpicollectEntries(connection, { delayMs: 0, perPage: 1, maxPages: 5 });
        assert.equal(posts, before + 2);
        assert.deepEqual(pages, [1, 2]);
        assert.deepEqual(result.entries.map((entry) => entry.ec5_uuid), ids);
        assert.equal(result.stoppedByMaxPages, false);
        getReply = () => json({ meta: { last_page: 0, total: 0 }, data: { entries: [] } });
        assert.equal((await epicollect.fetchAllEpicollectEntries(connection, { delayMs: 0 })).totalEntriesFetched, 0);
    });

    await t.test('un par OAuth alterado bloquea el arranque y no inicia una solicitud saliente', async () => {
        const connection = await create();
        await client.query("UPDATE api_connections SET oauth_credentials_encrypted = 'v1.invalid.invalid.invalid' WHERE id = $1", [connection.id]);
        const before = posts;
        await assert.rejects(assertOAuthStorage(client), { code: 'CREDENTIAL_DECRYPT_FAILED' });
        assert.equal((await request('PATCH', `/connections/${connection.id}/test`)).data.code, 'CREDENTIAL_DECRYPT_FAILED');
        assert.equal(posts, before);
    });
});
