const pool = require('../config/db');
const { createHash } = require('node:crypto');
const { assertAllowedEpicollectBase } = require('../config/epicollect.config');
const { encryptCredential, decryptCredential, credentialError } = require('./credentialCrypto.service');
const { decryptOAuthCredentials } = require('./oauthCredentials.service');

const inFlight = new Map();
const TIMEOUT_MS = 15000;
const FAILURE_DELAY_MS = 60000;

function oauthError(code, statusCode, retryAt) {
    return Object.assign(credentialError(code, 'No fue posible completar la autenticación OAuth.'),
        { statusCode, retryAt });
}

function retryTimestamp(header, now = Date.now()) {
    if (typeof header !== 'string') return new Date(now + FAILURE_DELAY_MS);
    const value = /^\d+$/.test(header) ? now + Number(header) * 1000 : Date.parse(header);
    return new Date(Number.isFinite(value) && value < 8.64e15
        ? Math.max(now + 1000, value) : now + FAILURE_DELAY_MS);
}

async function limitedJson(response) {
    const reader = response.body?.getReader();
    if (!reader) throw oauthError('OAUTH_RESPONSE_INVALID');
    const chunks = [];
    let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > 65536) {
                await reader.cancel();
                throw oauthError('OAUTH_RESPONSE_INVALID');
            }
            chunks.push(Buffer.from(value));
        }
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } finally {
        reader.releaseLock();
    }
}

async function requestToken(connection) {
    const base = assertAllowedEpicollectBase(connection.base_url);
    const pair = decryptOAuthCredentials(connection.oauth_credentials_encrypted, connection.id);
    const started = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const response = await fetch(`${base}/oauth/token`, {
            method: 'POST', redirect: 'error', signal: controller.signal,
            headers: { Accept: 'application/json', 'Content-Type': 'application/vnd.api+json' },
            body: JSON.stringify({ grant_type: 'client_credentials', ...pair }),
        });
        if (!response.ok) {
            await response.body?.cancel();
            if (response.status === 429) {
                throw oauthError('OAUTH_RATE_LIMITED', 429, retryTimestamp(response.headers.get('retry-after')));
            }
            throw oauthError([400, 401, 403].includes(response.status)
                ? 'OAUTH_CREDENTIALS_REJECTED' : 'OAUTH_UNAVAILABLE', response.status);
        }
        let body;
        try { body = await limitedJson(response); }
        catch (error) {
            if (controller.signal.aborted) throw oauthError('OAUTH_TIMEOUT');
            throw oauthError('OAUTH_RESPONSE_INVALID');
        }
        const ttl = typeof body?.expires_in === 'string' && /^\d+$/.test(body.expires_in)
            ? Number(body.expires_in) : body?.expires_in;
        if (typeof body?.access_token !== 'string' || !/^[A-Za-z0-9._~+\/-]+=*$/.test(body.access_token) ||
            Buffer.byteLength(body.access_token) > 16384 ||
            typeof body.token_type !== 'string' || body.token_type.toLowerCase() !== 'bearer' ||
            !Number.isSafeInteger(ttl) || ttl <= 0 || ttl > 2147483647) {
            throw oauthError('OAUTH_RESPONSE_INVALID');
        }
        const expiresAt = new Date(started + ttl * 1000);
        if (expiresAt.getTime() <= Date.now()) throw oauthError('OAUTH_RESPONSE_INVALID');
        return { token: body.access_token, expiresAt,
            refreshAt: new Date(expiresAt.getTime() - Math.min(60000, ttl * 100)) };
    } catch (error) {
        if (controller.signal.aborted) throw oauthError('OAUTH_TIMEOUT');
        if (error.code?.startsWith('OAUTH_')) throw error;
        throw oauthError('OAUTH_UNAVAILABLE');
    } finally {
        clearTimeout(timeout);
    }
}

function checkContext(row, expected) {
    if (!row || !row.is_active || row.auth_type !== 'oauth2' || row.provider !== 'epicollect5' ||
        row.base_url !== expected.base_url || row.project_slug !== expected.project_slug ||
        row.provider !== expected.provider) {
        throw oauthError('CONNECTION_CHANGED');
    }
    assertAllowedEpicollectBase(row.base_url);
}

async function lockedAccessToken(expected, rejectedToken) {
    const client = await pool.connect();
    let committed = false;
    try {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout = '20s'");
        const { rows } = await client.query('SELECT * FROM api_connections WHERE id = $1 FOR UPDATE', [expected.id]);
        const row = rows[0];
        checkContext(row, expected);
        const now = Date.now();
        const cached = row.token_encrypted ? decryptCredential(row.token_encrypted, row.id) : null;
        if (cached && new Date(row.oauth_token_refresh_at).getTime() > now && cached !== rejectedToken) {
            await client.query('COMMIT');
            committed = true;
            return cached;
        }
        if (row.oauth_retry_after && new Date(row.oauth_retry_after).getTime() > now) {
            throw oauthError('OAUTH_RETRY_LATER', undefined, new Date(row.oauth_retry_after));
        }
        let tokenResult;
        try {
            tokenResult = await requestToken(row);
        } catch (error) {
            const code = ['OAUTH_RATE_LIMITED', 'OAUTH_TIMEOUT', 'OAUTH_CREDENTIALS_REJECTED',
                'OAUTH_RESPONSE_INVALID', 'OAUTH_UNAVAILABLE', 'CREDENTIAL_DECRYPT_FAILED'].includes(error.code)
                ? error.code : 'OAUTH_UNAVAILABLE';
            await client.query(`UPDATE api_connections SET token_encrypted = NULL,
                oauth_token_expires_at = NULL, oauth_token_refresh_at = NULL,
                oauth_error_code = $2, oauth_retry_after = $3 WHERE id = $1`,
            [row.id, code, error.retryAt || new Date(Date.now() + FAILURE_DELAY_MS)]);
            await client.query('COMMIT');
            committed = true;
            throw error;
        }
        await client.query(`UPDATE api_connections SET token_encrypted = $2,
            oauth_token_expires_at = $3, oauth_token_refresh_at = $4,
            oauth_error_code = NULL, oauth_retry_after = NULL WHERE id = $1`,
        [row.id, encryptCredential(tokenResult.token, row.id), tokenResult.expiresAt, tokenResult.refreshAt]);
        await client.query('COMMIT');
        committed = true;
        return tokenResult.token;
    } catch (error) {
        if (!committed) await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function getAccessToken(connection, { rejectedToken = null } = {}) {
    // La promesa evita duplicar trabajo en el proceso; FOR UPDATE cubre otros procesos.
    const key = createHash('sha256').update(JSON.stringify([
        connection.id, connection.base_url, connection.project_slug, connection.provider, rejectedToken,
    ])).digest('hex');
    if (inFlight.has(key)) return inFlight.get(key);
    const pending = lockedAccessToken(connection, rejectedToken);
    inFlight.set(key, pending);
    try { return await pending; }
    finally { inFlight.delete(key); }
}

async function invalidateRejectedToken(connection, token) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout = '20s'");
        const { rows } = await client.query('SELECT * FROM api_connections WHERE id = $1 FOR UPDATE', [connection.id]);
        const row = rows[0];
        if (row?.auth_type === 'oauth2' && row.base_url === connection.base_url &&
            row.project_slug === connection.project_slug && row.provider === connection.provider && row.token_encrypted &&
            decryptCredential(row.token_encrypted, row.id) === token) {
            await client.query(`UPDATE api_connections SET token_encrypted = NULL,
                oauth_token_expires_at = NULL, oauth_token_refresh_at = NULL,
                oauth_error_code = 'OAUTH_TOKEN_REJECTED', oauth_retry_after = $2 WHERE id = $1`,
            [row.id, new Date(Date.now() + FAILURE_DELAY_MS)]);
        }
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally { client.release(); }
}

module.exports = { getAccessToken, invalidateRejectedToken, retryTimestamp };
