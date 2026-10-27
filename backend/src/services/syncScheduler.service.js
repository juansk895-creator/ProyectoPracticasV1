const pool = require('../config/db');
const runner = require('./syncRunner.service');
const { schedulerConfig } = require('../config/scheduler.config');

function createScheduler({ config = schedulerConfig(), onError = () => {} } = {}) {
    let stopped = false;
    let started = false;
    let timer;
    let task = null;
    async function tick() {
        if (!config.enabled || task) return;
        task = (async () => {
            await runner.recoverInterruptedRuns();
            const due = await pool.query(`SELECT id FROM api_connections
                WHERE is_active AND sync_schedule_enabled
                  AND (sync_next_run_at IS NULL OR sync_next_run_at <= now())
                  AND (oauth_retry_after IS NULL OR oauth_retry_after <= now())
                ORDER BY sync_next_run_at NULLS FIRST, id LIMIT 20`);
            for (const { id } of due.rows) {
                if (stopped) break;
                try { await runner.runConnection(id, { trigger: 'scheduled' }); }
                catch (error) {
                    if (!['SYNC_ALREADY_RUNNING', 'SYNC_CAPACITY_BUSY', 'CONNECTION_INACTIVE', 'CONNECTION_NOT_FOUND'].includes(error.code)) {
                        onError(error);
                    }
                }
            }
        })();
        try { await task; } finally { task = null; }
    }
    async function loop() {
        try { await tick(); } catch (error) { onError(error); }
        if (!stopped) timer = setTimeout(loop, config.pollMs);
    }
    return {
        start() { if (started || !config.enabled) return; started = true; stopped = false; void loop(); },
        async stop() { stopped = true; started = false; clearTimeout(timer); await task; },
        tick,
    };
}

module.exports = { createScheduler };
