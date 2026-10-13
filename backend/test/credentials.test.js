const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { encryptCredential, decryptCredential, getEncryptionKey } =
    require('../src/services/credentialCrypto.service');
const { filterConnection } = require('../src/utils/filter');
const { safeConnectionError, safeConnectionErrorCode } = require('../src/utils/connectionError');
const { validateCreateConnection, validateUpdateConnection } =
    require('../src/validations/apiConnection.validator');

const originalKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
beforeEach(() => { process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('hex'); });
after(() => {
    if (originalKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    else process.env.CREDENTIAL_ENCRYPTION_KEY = originalKey;
});

test('recupera exactamente la credencial y usa un cifrado distinto en cada escritura', () => {
    const id = randomUUID();
    const token = 'Bearer ejemplo-secreto-ñ-🔐';
    const a = encryptCredential(token, id);
    const b = encryptCredential(token, id);
    assert.notEqual(a, b);
    assert.equal(a.includes(token), false);
    assert.equal(decryptCredential(a, id), token);
    assert.equal(decryptCredential(b, id), token);
});

test('rechaza cambios en el cifrado y en su etiqueta de autenticación', () => {
    const id = randomUUID();
    const value = encryptCredential('secreto', id);
    for (const index of [1, 2, 3]) {
        const parts = value.split('.');
        const bytes = Buffer.from(parts[index], 'base64url');
        bytes[0] ^= 1;
        parts[index] = bytes.toString('base64url');
        assert.throws(() => decryptCredential(parts.join('.'), id), { code: 'CREDENTIAL_DECRYPT_FAILED' });
    }
});

test('rechaza el intercambio de credenciales entre conexiones y una clave diferente', () => {
    const id = randomUUID();
    const value = encryptCredential('secreto', id);
    assert.throws(() => decryptCredential(value, randomUUID()), { code: 'CREDENTIAL_DECRYPT_FAILED' });
    process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    assert.throws(() => decryptCredential(value, id), { code: 'CREDENTIAL_DECRYPT_FAILED' });
});

test('falla sin clave válida; nunca genera una clave sustitutiva', () => {
    for (const key of ['', 'abc', 'g'.repeat(64), 'a'.repeat(63), 'a'.repeat(65)]) {
        process.env.CREDENTIAL_ENCRYPTION_KEY = key;
        assert.throws(getEncryptionKey, { code: 'CREDENTIAL_KEY_INVALID' });
    }
    delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    assert.throws(getEncryptionKey, { code: 'CREDENTIAL_KEY_INVALID' });
});

test('rechaza formatos de cifrado y credenciales inválidos', () => {
    const id = randomUUID();
    for (const value of [null, '', 'texto-plano', 'v2.a.b.c', 'v1.a.b.c', 'v1..b.c']) {
        assert.throws(() => decryptCredential(value, id), { code: 'CREDENTIAL_DECRYPT_FAILED' });
    }
    for (const value of [null, '', ' ', {}, 'x'.repeat(16385)]) {
        assert.throws(() => encryptCredential(value, id), { code: 'INVALID_CREDENTIAL' });
    }
});

test('las respuestas públicas excluyen credenciales presentes y futuras', () => {
    const safe = filterConnection({ id: 'id', name: 'Prueba', auth_type: 'bearer',
        auth_token: 'no-publicar', token_encrypted: 'v1.cifrado', client_secret: 'no-publicar',
        access_token: 'no-publicar', credential_key: 'no-publicar', has_auth_token: true });
    assert.deepEqual(safe, { id: 'id', name: 'Prueba', auth_type: 'bearer', has_auth_token: true });
    assert.equal(filterConnection({ auth_type: 'none', auth_token: 'NO_AUTH_REQUIRED' }).has_auth_token, false);
    assert.equal(filterConnection({ auth_type: 'bearer', has_auth_token: true }).has_auth_token, true);
});

test('los errores desconocidos no revelan secretos, rutas ni códigos arbitrarios', () => {
    const error = Object.assign(new Error('token-secreto /ruta/privada'), { code: 'token-secreto' });
    assert.equal(safeConnectionError(error).includes('token-secreto'), false);
    assert.equal(safeConnectionError(error).includes('/ruta'), false);
    assert.equal(safeConnectionErrorCode(error, 'SAFE_ERROR'), 'SAFE_ERROR');
});

test('none usa null y editar sin token conserva la intención de no sustituirlo', () => {
    const input = { name: 'Pública', project_slug: 'ec5-api-test',
        base_url: 'https://five.epicollect.net/api', auth_type: 'none' };
    const created = validateCreateConnection(input);
    assert.equal(created.isValid, true);
    assert.equal(created.data.auth_token, null);
    const updated = validateUpdateConnection({ name: 'Editada' });
    assert.equal(updated.isValid, true);
    assert.equal(Object.hasOwn(updated.data, 'auth_token'), false);
    for (const token of [{ secret: 'value' }, 123, 'x'.repeat(16385)]) {
        assert.equal(validateCreateConnection({ ...input, auth_type: 'bearer', auth_token: token }).isValid, false);
    }
});
