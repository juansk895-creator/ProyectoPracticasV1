require('../src/config/env');
const pool = require('../src/config/db');
const { assertHierarchyStorage } = require('../src/services/hierarchyStorage.service');
const { migrateAlmacen } = require('../src/services/almacenStorage.service');
(async () => {
    const client = await pool.connect();
    try {
        await assertHierarchyStorage(client);
        await migrateAlmacen(client);
        console.log('Almacén final preparado. Staging no se modificó.');
    } finally { client.release(); }
})().catch((error) => {
    console.error(error.code === 'STAGING_MIGRATION_REQUIRED' ? error.message
        : 'No se completó la preparación del almacén. Revisa la base y las migraciones anteriores.');
    process.exitCode = 1;
}).finally(() => pool.end());
