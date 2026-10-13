const { getEncryptionKey, encryptCredential, decryptCredential, credentialError } =
    require('./credentialCrypto.service');

async function storageColumns(client) {
    const result = await client.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'api_connections'
          AND column_name IN ('auth_token', 'token_encrypted')
    `);
    return new Set(result.rows.map((row) => row.column_name));
}

async function assertCredentialStorage(client) {
    getEncryptionKey();
    const columns = await storageColumns(client);
    if (columns.has('auth_token') || !columns.has('token_encrypted')) {
        throw credentialError('CREDENTIAL_MIGRATION_REQUIRED',
            'Ejecuta npm --prefix backend run credentials:migrate antes de iniciar el servidor.');
    }
    const { rows } = await client.query('SELECT id, auth_type, token_encrypted FROM api_connections');
    for (const row of rows) {
        if (row.auth_type !== 'none') decryptCredential(row.token_encrypted, row.id);
        else if (row.token_encrypted !== null) {
            throw credentialError('CREDENTIAL_STORAGE_INVALID',
                'Una conexión sin autenticación conserva una credencial. Revisa la migración.');
        }
    }
}

// El llamador entrega un único cliente de pg, nunca un pool: la transacción
// y el bloqueo deben permanecer en la misma conexión hasta COMMIT/ROLLBACK.
async function migrateCredentials(client) {
    getEncryptionKey();
    await client.query('BEGIN');
    try {
        await client.query('LOCK TABLE api_connections IN ACCESS EXCLUSIVE MODE');
        const columns = await storageColumns(client);
        if (!columns.has('auth_token')) {
            await assertCredentialStorage(client);
            await client.query('COMMIT');
            return { migrated: false, encrypted: 0, withoutAuth: 0 };
        }
        await client.query('ALTER TABLE api_connections ADD COLUMN IF NOT EXISTS token_encrypted TEXT');
        const { rows } = await client.query(
            'SELECT id, auth_type, auth_token, token_encrypted FROM api_connections');
        let encrypted = 0;
        let withoutAuth = 0;
        for (const row of rows) {
            let value = null;
            if (row.auth_type !== 'none') {
                if (row.token_encrypted !== null) {
                    const plain = decryptCredential(row.token_encrypted, row.id);
                    if (row.auth_token !== null && row.auth_token !== plain) {
                        throw credentialError('CREDENTIAL_MIGRATION_CONFLICT',
                            'Hay credenciales inconsistentes; la migración se canceló.');
                    }
                    value = row.token_encrypted;
                } else {
                    if (row.auth_token === 'NO_AUTH_REQUIRED') {
                        throw credentialError('CREDENTIAL_MIGRATION_INVALID',
                            'Una conexión autenticada carece de token real; corrígela antes de migrar.');
                    }
                    value = encryptCredential(row.auth_token, row.id);
                    if (decryptCredential(value, row.id) !== row.auth_token) {
                        throw credentialError('CREDENTIAL_MIGRATION_INVALID',
                            'No se pudo verificar el cifrado; la migración se canceló.');
                    }
                }
                encrypted += 1;
            } else {
                withoutAuth += 1;
            }
            await client.query('UPDATE api_connections SET token_encrypted = $2 WHERE id = $1',
                [row.id, value]);
        }
        await client.query(`
            ALTER TABLE api_connections DROP COLUMN auth_token;
            ALTER TABLE api_connections ADD CONSTRAINT api_connections_credential_check CHECK (
                (auth_type = 'none' AND token_encrypted IS NULL) OR
                (auth_type <> 'none' AND token_encrypted IS NOT NULL AND token_encrypted LIKE 'v1.%')
            );
        `);
        await assertCredentialStorage(client);
        await client.query('COMMIT');
        return { migrated: true, encrypted, withoutAuth };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
}

module.exports = { assertCredentialStorage, migrateCredentials };
