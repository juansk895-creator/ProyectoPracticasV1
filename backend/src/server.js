require('./config/env');
const pool = require('./config/db');
const { assertOAuthStorage } = require('./services/oauthStorage.service');
const { getAllowedApiBases } = require('./config/epicollect.config');
const { assertHierarchyStorage } = require('./services/hierarchyStorage.service');
const { assertSchedulerStorage } = require('./services/schedulerStorage.service');
const { schedulerConfig } = require('./config/scheduler.config');
const { createScheduler } = require('./services/syncScheduler.service');
const runner = require('./services/syncRunner.service');
const { safeConnectionErrorCode } = require('./utils/connectionError');

async function start() {
    getAllowedApiBases();
    await assertOAuthStorage(pool);
    await assertHierarchyStorage(pool);
    await assertSchedulerStorage(pool);
    const config = schedulerConfig();
    await runner.recoverInterruptedRuns();
    const app = require('./app');
    const port = process.env.PORT || 3001;
    const server = app.listen(port, () => console.log(`Backend running on port ${port}`));
    const scheduler = createScheduler({ config,
        onError: (error) => console.error('Sincronización programada:', safeConnectionErrorCode(error, 'SYNC_SCHEDULER_FAILED')) });
    scheduler.start();
    let closing = false;
    async function stop() {
        if (closing) return;
        closing = true;
        runner.cancelAll();
        const closed = new Promise((resolve) => server.close(resolve));
        server.closeIdleConnections();
        try { await scheduler.stop(); await closed; }
        finally { await pool.end(); }
    }
    function requestStop() {
        void stop().catch(() => { console.error('No se completó el cierre del backend.'); process.exitCode = 1; });
    }
    process.once('SIGTERM', requestStop);
    process.once('SIGINT', requestStop);
}

start().catch(async (error) => {
    const allowed = new Set(['CREDENTIAL_KEY_INVALID', 'CREDENTIAL_MIGRATION_REQUIRED',
        'CREDENTIAL_DECRYPT_FAILED', 'CREDENTIAL_STORAGE_INVALID', 'OAUTH_MIGRATION_REQUIRED', 'EPICOLLECT_CONFIG_INVALID', 'STAGING_MIGRATION_REQUIRED',
        'SYNC_SCHEDULER_MIGRATION_REQUIRED', 'SYNC_SCHEDULER_CONFIG_INVALID']);
    console.error(allowed.has(error.code) ? `${error.code}: ${error.message}`
        : 'No se pudo iniciar el backend. Verifica la base de datos y la configuración.');
    await pool.end();
    process.exitCode = 1;
});
