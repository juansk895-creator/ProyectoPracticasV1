require('../src/config/env');
const pool = require('../src/config/db');
const { assertOAuthStorage } = require('../src/services/oauthStorage.service');
const { assertHierarchyStorage } = require('../src/services/hierarchyStorage.service');
const { migrateScheduler } = require('../src/services/schedulerStorage.service');

(async () => {
    const client = await pool.connect();
    try {
        await assertOAuthStorage(client);
        await assertHierarchyStorage(client);
        await migrateScheduler(client);
        console.log('Preparación de sincronización programada completada. Se conservaron las fechas y la configuración existentes.');
    } finally { client.release(); }
})().catch(() => {
    console.error('No se completó la preparación. Revisa las migraciones anteriores y el acceso a la base de datos.');
    process.exitCode = 1;
}).finally(() => pool.end());
