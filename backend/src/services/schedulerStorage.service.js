const { readFile } = require('node:fs/promises');
const path = require('node:path');

async function assertSchedulerStorage(client) {
    const { rows } = await client.query(`SELECT
        (SELECT count(*) = 3 FROM information_schema.columns WHERE table_schema = current_schema()
            AND table_name = 'api_connections'
            AND column_name IN ('sync_schedule_enabled','sync_interval_minutes','sync_next_run_at'))
        AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema()
            AND table_name = 'sync_logs' AND column_name = 'trigger_source')
        AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema()
            AND table_name = 'source_request_gates') AS ready`);
    if (!rows[0].ready) throw Object.assign(new Error('Ejecuta npm --prefix backend run scheduler:migrate antes de iniciar el servidor.'),
        { code: 'SYNC_SCHEDULER_MIGRATION_REQUIRED' });
}

async function migrateScheduler(client) {
    await client.query('BEGIN');
    try {
        await client.query("SET LOCAL lock_timeout = '20s'");
        await client.query(await readFile(path.resolve(__dirname, '../../../database/upgrades/scheduled_sync.sql'), 'utf8'));
        await assertSchedulerStorage(client);
        await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
}

module.exports = { assertSchedulerStorage, migrateScheduler };
