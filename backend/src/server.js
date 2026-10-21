require('./config/env');
const pool = require('./config/db');
const { assertOAuthStorage } = require('./services/oauthStorage.service');
const { getAllowedApiBases } = require('./config/epicollect.config');
const { assertHierarchyStorage } = require('./services/hierarchyStorage.service');

async function start() {
    getAllowedApiBases();
    await assertOAuthStorage(pool);
    await assertHierarchyStorage(pool);
    const app = require('./app');
    const port = process.env.PORT || 3001;
    app.listen(port, () => console.log(`Backend running on port ${port}`));
}

start().catch(async (error) => {
    const allowed = new Set(['CREDENTIAL_KEY_INVALID', 'CREDENTIAL_MIGRATION_REQUIRED',
        'CREDENTIAL_DECRYPT_FAILED', 'CREDENTIAL_STORAGE_INVALID', 'OAUTH_MIGRATION_REQUIRED', 'EPICOLLECT_CONFIG_INVALID', 'STAGING_MIGRATION_REQUIRED']);
    console.error(allowed.has(error.code) ? `${error.code}: ${error.message}`
        : 'No se pudo iniciar el backend. Verifica la base de datos y la configuración.');
    await pool.end();
    process.exitCode = 1;
});
