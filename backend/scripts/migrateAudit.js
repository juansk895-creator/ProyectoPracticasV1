require('../src/config/env');
const pool = require('../src/config/db');
const { assertHierarchyStorage } = require('../src/services/hierarchyStorage.service');
const { migrateAudit } = require('../src/services/auditStorage.service');
(async () => {
    const client = await pool.connect();
    try {
        await assertHierarchyStorage(client);
        await migrateAudit(client);
        console.log('Almacenamiento de auditoría preparado. Los datos y estados anteriores se conservaron.');
    } finally { client.release(); }
})().catch(() => {
    console.error('No se completó la preparación de auditoría. Revisa la base y las migraciones anteriores.');
    process.exitCode = 1;
}).finally(() => pool.end());
