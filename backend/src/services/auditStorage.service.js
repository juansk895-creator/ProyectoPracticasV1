const { readFile } = require('node:fs/promises');
const path = require('node:path');

async function assertAuditStorage(client) {
    const { rows } = await client.query("SELECT to_regclass('staging_audit_records') AS view");
    if (!rows[0].view) throw Object.assign(new Error('Ejecuta npm --prefix backend run audit:migrate.'),
        { code: 'AUDIT_MIGRATION_REQUIRED' });
}

async function migrateAudit(client) {
    await client.query('BEGIN');
    try {
        await client.query(await readFile(path.resolve(__dirname, '../../../database/upgrades/survey_audit.sql'), 'utf8'));
        await assertAuditStorage(client);
        await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
}
module.exports = { assertAuditStorage, migrateAudit };
