const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { encryptCredential, decryptCredential } = require('../src/services/credentialCrypto.service');
const { encryptOAuthCredentials, decryptOAuthCredentials } = require('../src/services/oauthCredentials.service');
const { assertAllowedEpicollectBase, getAllowedApiBases } = require('../src/config/epicollect.config');
const { validateCreateConnection, validateUpdateConnection } = require('../src/validations/apiConnection.validator');
const { retryTimestamp } = require('../src/services/oauth.service');
const { filterConnection } = require('../src/utils/filter');
const env = { key: process.env.CREDENTIAL_ENCRYPTION_KEY, bases: process.env.EPICOLLECT_API_BASE_URLS };
const base = 'https://five.epicollect.net/api';
const pair = { client_id: 'cliente-prueba', client_secret: 'secreto-prueba' };
const input = { name: 'OAuth', project_slug: 'private-project', base_url: base, auth_type: 'oauth2',
    oauth_client_id: pair.client_id, oauth_client_secret: pair.client_secret };

beforeEach(() => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    delete process.env.EPICOLLECT_API_BASE_URLS;
});
after(async () => {
    for (const [key, value] of [['CREDENTIAL_ENCRYPTION_KEY', env.key], ['EPICOLLECT_API_BASE_URLS', env.bases]]) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await require('../src/config/db').end();
});

test('el cifrado separa tokens, pares OAuth y conexiones sin romper los tokens anteriores', () => {
    const id = randomUUID();
    const encrypted = encryptOAuthCredentials(pair, id);
    assert.deepEqual(decryptOAuthCredentials(encrypted, id), pair);
    assert.equal(encrypted.includes(pair.client_secret), false);
    assert.throws(() => decryptCredential(encrypted, id), { code: 'CREDENTIAL_DECRYPT_FAILED' });
    assert.throws(() => decryptOAuthCredentials(encrypted, randomUUID()), { code: 'CREDENTIAL_DECRYPT_FAILED' });
    const previous = encryptCredential('token-anterior', id);
    assert.equal(decryptCredential(previous, id), 'token-anterior');
    assert.throws(() => decryptOAuthCredentials(previous, id), { code: 'CREDENTIAL_DECRYPT_FAILED' });
});

test('la lista de servidores exige coincidencia exacta, HTTPS y configuración explícita', () => {
    assert.equal(assertAllowedEpicollectBase(base + '/'), base);
    for (const value of ['http://five.epicollect.net/api', base + '.evil', base + '/otro',
        'https://five.epicollect.net.evil/api', base + '?token=x', base + '#x',
        'https://user:secret@five.epicollect.net/api', base + '/%2f', 'https://10.0.0.5/api']) {
        assert.throws(() => assertAllowedEpicollectBase(value));
    }
    process.env.EPICOLLECT_API_BASE_URLS = `${base},https://10.0.0.5/api, https://encuestas.example.org/ec5/api/`;
    assert.equal(assertAllowedEpicollectBase('https://10.0.0.5/api'), 'https://10.0.0.5/api');
    assert.equal(assertAllowedEpicollectBase('https://encuestas.example.org/ec5/api'), 'https://encuestas.example.org/ec5/api');
    process.env.EPICOLLECT_API_BASE_URLS = '';
    assert.throws(getAllowedApiBases, { code: 'EPICOLLECT_CONFIG_INVALID' });
});

test('OAuth exige el par completo y rechaza el token manual, otros proveedores y valores excesivos', () => {
    assert.equal(validateCreateConnection(input).isValid, true);
    for (const changes of [{ oauth_client_id: undefined }, { oauth_client_secret: '' },
        { oauth_client_secret: 123 }, { oauth_client_secret: 'x'.repeat(8193) },
        { oauth_client_secret: '\u0001'.repeat(8192) }, { oauth_client_id: 'ñ'.repeat(129) },
        { auth_token: 'manual' }, { provider: 'custom' }, { auth_type: 'none' }]) {
        assert.equal(validateCreateConnection({ ...input, ...changes }).isValid, false);
    }
});

test('renombrar conserva credenciales; cambiar destino o modo exige credenciales correspondientes', () => {
    const current = { ...input, provider: 'epicollect5', has_oauth_credentials: true };
    assert.equal(validateUpdateConnection({ name: 'Nuevo nombre' }, current).isValid, true);
    assert.equal(validateUpdateConnection({ project_slug: 'otro' }, current).isValid, false);
    assert.equal(validateUpdateConnection({ project_slug: 'otro', oauth_client_id: pair.client_id,
        oauth_client_secret: pair.client_secret }, current).isValid, true);
    assert.equal(validateUpdateConnection({ oauth_client_secret: 'solo-secreto' }, current).isValid, false);
    assert.equal(validateUpdateConnection({ auth_type: 'bearer' }, current).isValid, false);
    assert.equal(validateUpdateConnection({ auth_type: 'bearer', auth_token: 'nuevo' }, current).isValid, true);
    assert.equal(validateUpdateConnection({ auth_type: 'none' }, current).isValid, true);
});

test('Retry-After acepta segundos y fechas; la espera por defecto es acotada', () => {
    const now = Date.UTC(2026, 0, 1);
    assert.equal(retryTimestamp('120', now).getTime(), now + 120000);
    assert.equal(retryTimestamp(new Date(now + 300000).toUTCString(), now).getTime(), now + 300000);
    assert.equal(retryTimestamp('0', now).getTime(), now + 1000);
    assert.equal(retryTimestamp('invalid', now).getTime(), now + 60000);
    assert.equal(retryTimestamp('9'.repeat(400), now).getTime(), now + 60000);
});

test('la API pública sólo expone indicadores y fechas de OAuth', () => {
    const result = filterConnection({ id: 'x', auth_type: 'oauth2', has_oauth_credentials: true,
        has_auth_token: false, oauth_status: 'not_requested', oauth_token_expires_at: null,
        oauth_client_id: pair.client_id, oauth_client_secret: pair.client_secret,
        oauth_credentials_encrypted: 'v1.secreto', access_token: 'token-secreto' });
    assert.equal(result.oauth_status, 'not_requested');
    assert.equal(result.has_oauth_credentials, true);
    for (const forbidden of ['oauth_client_id', 'oauth_client_secret', 'oauth_credentials_encrypted', 'access_token']) {
        assert.equal(Object.hasOwn(result, forbidden), false);
    }
});
