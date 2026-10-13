const { randomBytes, createCipheriv, createDecipheriv } = require('node:crypto');

const MAX_CREDENTIAL_BYTES = 16384;

function credentialError(code, message) {
    return Object.assign(new Error(message), { code });
}

function getEncryptionKey() {
    const value = process.env.CREDENTIAL_ENCRYPTION_KEY;
    if (typeof value !== 'string' || !/^[a-fA-F0-9]{64}$/.test(value)) {
        throw credentialError('CREDENTIAL_KEY_INVALID',
            'Configura CREDENTIAL_ENCRYPTION_KEY con una clave de 32 bytes en hexadecimal.');
    }
    return Buffer.from(value, 'hex');
}

function credentialContext(connectionId) {
    if (typeof connectionId !== 'string' ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(connectionId)) {
        throw credentialError('CREDENTIAL_CONTEXT_INVALID', 'Identificador de conexión no válido.');
    }
    // Impide trasladar un cifrado válido a otra conexión sin detectar el cambio.
    return Buffer.from(`api_connections:${connectionId.toLowerCase()}:auth_token:v1`);
}

function encryptCredential(value, connectionId) {
    if (typeof value !== 'string' || value.trim().length === 0 ||
        Buffer.byteLength(value, 'utf8') > MAX_CREDENTIAL_BYTES) {
        throw credentialError('INVALID_CREDENTIAL', 'La credencial no tiene un formato válido.');
    }
    const key = getEncryptionKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    cipher.setAAD(credentialContext(connectionId));
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64url'), encrypted.toString('base64url'),
        cipher.getAuthTag().toString('base64url')].join('.');
}

function decodePart(value) {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid encoding');
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.toString('base64url') !== value) throw new Error('Invalid encoding');
    return decoded;
}

function decryptCredential(value, connectionId) {
    const key = getEncryptionKey();
    const context = credentialContext(connectionId);
    try {
        if (typeof value !== 'string' || value.length > MAX_CREDENTIAL_BYTES * 2) {
            throw new Error('Invalid envelope');
        }
        const parts = value.split('.');
        if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Invalid version');
        const [iv, encrypted, tag] = parts.slice(1).map(decodePart);
        if (iv.length !== 12 || tag.length !== 16 || encrypted.length === 0 ||
            encrypted.length > MAX_CREDENTIAL_BYTES) throw new Error('Invalid envelope');
        const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
        decipher.setAAD(context);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    } catch {
        // No incluir el valor recibido, la clave ni el error interno de OpenSSL.
        throw credentialError('CREDENTIAL_DECRYPT_FAILED',
            'No fue posible descifrar la credencial. Verifica la clave del servidor.');
    }
}

module.exports = { getEncryptionKey, encryptCredential, decryptCredential, credentialError };
