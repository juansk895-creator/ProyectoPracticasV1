const pool = require('../config/db');
const { schedulerConfig } = require('../config/scheduler.config');
const { checkSyncSignal, pause } = require('./syncContext.service');

async function waitForRequest(url) {
    const interval = schedulerConfig().requestIntervalMs;
    checkSyncSignal();
    // Las pruebas pueden omitir las pausas; los límites reales se prueban expresamente.
    if (interval === 0) return;
    const origin = new URL(url).origin;
    await pool.query('INSERT INTO source_request_gates (origin) VALUES ($1) ON CONFLICT DO NOTHING', [origin]);
    for (;;) {
        checkSyncSignal();
        const acquired = await pool.query(`UPDATE source_request_gates
            SET next_request_at = clock_timestamp() + $2::integer * interval '1 millisecond'
            WHERE origin = $1 AND next_request_at <= clock_timestamp() AND blocked_until <= clock_timestamp()
            RETURNING origin`, [origin, interval]);
        if (acquired.rowCount) return;
        const wait = await pool.query(`SELECT GREATEST(1, ceil(extract(epoch FROM
            (GREATEST(next_request_at, blocked_until) - clock_timestamp())) * 1000)) AS ms
            FROM source_request_gates WHERE origin = $1`, [origin]);
        await pause(Math.min(Number(wait.rows[0]?.ms || interval), 60000));
    }
}

async function deferRequests(url, retryAt) {
    if (schedulerConfig().requestIntervalMs === 0) return;
    const origin = new URL(url).origin;
    await pool.query(`INSERT INTO source_request_gates (origin, blocked_until) VALUES ($1,$2)
        ON CONFLICT (origin) DO UPDATE SET blocked_until = GREATEST(source_request_gates.blocked_until, EXCLUDED.blocked_until)`,
    [origin, retryAt]);
}

module.exports = { waitForRequest, deferRequests };
