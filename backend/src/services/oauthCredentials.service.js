const { encryptCredential, decryptCredential, credentialError } = require('./credentialCrypto.service');

function validPair(pair) {
    return pair && typeof pair.client_id === 'string' && pair.client_id.trim().length > 0 &&
        Buffer.byteLength(pair.client_id) <= 256 && typeof pair.client_secret === 'string' &&
        pair.client_secret.trim().length > 0 && Buffer.byteLength(pair.client_secret) <= 8192 &&
        Buffer.byteLength(JSON.stringify({ client_id: pair.client_id, client_secret: pair.client_secret })) <= 16384;
}

function encryptOAuthCredentials(pair, id) {
    if (!validPair(pair)) throw credentialError('OAUTH_CREDENTIALS_INVALID', 'Revisa Client ID y Client Secret.');
    return encryptCredential(JSON.stringify({ client_id: pair.client_id, client_secret: pair.client_secret }), id, 'oauth_credentials');
}

function decryptOAuthCredentials(encrypted, id) {
    try {
        const pair = JSON.parse(decryptCredential(encrypted, id, 'oauth_credentials'));
        if (!validPair(pair)) throw new Error();
        return pair;
    } catch {
        throw credentialError('CREDENTIAL_DECRYPT_FAILED', 'No fue posible leer las credenciales OAuth.');
    }
}

module.exports = { encryptOAuthCredentials, decryptOAuthCredentials, validPair };
