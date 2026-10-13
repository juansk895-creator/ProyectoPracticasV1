require('../src/config/env');
const pool = require('../src/config/db');
const { migrateOAuth } = require('../src/services/oauthStorage.service');

async function main() {
    const client = await pool.connect();
    try {
        await migrateOAuth(client);
        console.log('Migración OAuth completada. Las conexiones y credenciales existentes se conservaron.');
    } finally { client.release(); }
}

main().catch((error) => {
    const safe = ['CREDENTIAL_KEY_INVALID', 'CREDENTIAL_DECRYPT_FAILED',
        'CREDENTIAL_MIGRATION_REQUIRED', 'OAUTH_MIGRATION_REQUIRED'];
    console.error(safe.includes(error.code) ? `${error.code}: ${error.message}`
        : 'No se completó la migración OAuth. Verifica PostgreSQL y que el cifrado anterior esté aplicado.');
    process.exitCode = 1;
}).finally(() => pool.end());
