require('../src/config/env');
const pool = require('../src/config/db');
const { migrateCredentials } = require('../src/services/credentialStorage.service');
const { getEncryptionKey } = require('../src/services/credentialCrypto.service');

async function main() {
    getEncryptionKey();
    const client = await pool.connect();
    try {
        const result = await migrateCredentials(client);
        console.log(result.migrated
            ? `Migración completada: ${result.encrypted} credenciales cifradas; ${result.withoutAuth} conexiones sin autenticación.`
            : 'La migración ya estaba aplicada. Se verificó el descifrado con la clave actual.');
    } finally {
        client.release();
    }
}

main().catch((error) => {
    const safeCodes = new Set(['CREDENTIAL_KEY_INVALID', 'CREDENTIAL_DECRYPT_FAILED',
        'CREDENTIAL_MIGRATION_REQUIRED', 'CREDENTIAL_MIGRATION_CONFLICT',
        'CREDENTIAL_MIGRATION_INVALID', 'CREDENTIAL_STORAGE_INVALID', 'INVALID_CREDENTIAL']);
    console.error(safeCodes.has(error.code) ? `${error.code}: ${error.message}`
        : 'No se completó la migración. Verifica PostgreSQL y los permisos de la base.');
    process.exitCode = 1;
}).finally(() => pool.end());
