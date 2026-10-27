const pool = require('../config/db');
const connections = require('../models/apiConnection.model');
const logs = require('../models/syncLog.model');
const sync = require('./sync.service');
const { context } = require('./syncContext.service');
const { safeConnectionError, safeConnectionErrorCode } = require('../utils/connectionError');

const active = new Map();
const lockKey = (id) => `sedecollect:sync:${id}`;
const syncError = (code) => Object.assign(new Error(code), { code });

async function recoverConnection(client, id) {
    const message = safeConnectionError({ code: 'SYNC_INTERRUPTED' });
    const recovered = await client.query(`UPDATE sync_logs SET status = 'failed', finished_at = now(),
        duration_ms = LEAST(2147483647, GREATEST(0, extract(epoch FROM (localtimestamp - started_at)) * 1000))::integer,
        error_message = $2, summary = summary || jsonb_build_object('error_code','SYNC_INTERRUPTED','error',$2::text)
        WHERE api_connection_id = $1 AND status = 'running' RETURNING project_slug, form_ref, summary`, [id, message]);
    for (const run of recovered.rows) {
        await client.query(`UPDATE api_connections SET last_sync_at=now(), last_sync_status='failed',
            last_sync_error_message=$2, last_sync_summary=$3::jsonb
            WHERE id=$1 AND project_slug=$4 AND form_ref IS NOT DISTINCT FROM $5
              AND ($6::text IS NULL OR base_url=$6)`,
        [id, message, JSON.stringify(run.summary), run.project_slug, run.form_ref, run.summary.source_base_url || null]);
    }
}

async function finish(client, run, connection, result, error) {
    const status = error ? 'failed' : result.database.skipped > 0 || result.database.pendingParents > 0 ? 'partial' : 'success';
    const summary = error ? { error: safeConnectionError(error),
        error_code: safeConnectionErrorCode(error, 'EPICOLLECT_SYNC_FAILED'),
        http_status: error.code === 'EPICOLLECT_HTTP_ERROR' && Number.isInteger(error.statusCode)
            && error.statusCode >= 400 && error.statusCode <= 599 ? error.statusCode : null } : result;
    await client.query('BEGIN');
    try {
        const current = await client.query("SELECT id FROM sync_logs WHERE id = $1 AND status = 'running' FOR UPDATE", [run.id]);
        if (!current.rowCount) throw syncError('SYNC_INTERRUPTED');
        const updatedConnection = await connections.updateConnectionSyncState(connection.id, {
            status, cursor: result?.cursor.nextCursor || null, errorMessage: error ? summary.error : null, summary,
        }, connection, client);
        if (!error && !updatedConnection) throw syncError('CONNECTION_CHANGED');
        const updated = await client.query(`UPDATE sync_logs SET status = $2, finished_at = $3,
            duration_ms = $4, mode = $5, filter_by = $6, filter_from = $7,
            cursor_before = $8, cursor_after = $9, total_entries_fetched = $10,
            processed_count = $11, skipped_count = $12, stopped_by_max_pages = $13,
            error_message = $14, summary = $15::jsonb WHERE id = $1 RETURNING *`, [
            run.id, status, new Date(), Math.min(2147483647, Math.max(0, Date.now() - new Date(run.started_at).getTime())),
            result?.mode || null, result?.filter.filterBy || connection.sync_filter_by,
            result?.filter.filterFrom || null, connection.sync_cursor,
            result?.cursor.nextCursor || connection.sync_cursor, result?.fetch.totalEntriesFetched || 0,
            result?.database.processed || 0, result?.database.skipped || 0,
            result?.fetch.stoppedByMaxPages || false, error ? summary.error : null, JSON.stringify(summary),
        ]);
        await client.query(`UPDATE api_connections SET sync_next_run_at = GREATEST(
            now() + sync_interval_minutes * interval '1 minute', oauth_retry_after, $2::timestamptz)
            WHERE id = $1 AND sync_schedule_enabled`, [connection.id, error?.retryAt || null]);
        await client.query('COMMIT');
        return { connection: updatedConnection, sync: result, log: updated.rows[0] };
    } catch (failure) { await client.query('ROLLBACK'); throw failure; }
}

async function runConnection(id, { trigger = 'manual' } = {}) {
    if (active.has(id)) throw syncError('SYNC_ALREADY_RUNNING');
    // Cada corrida reserva una sesión para el bloqueo. Quedan sesiones libres
    // en el pool para OAuth, las consultas de datos y la interfaz.
    if (active.size >= 2) throw syncError('SYNC_CAPACITY_BUSY');
    const controller = new AbortController();
    active.set(id, { controller, trigger });
    let client;
    let locked = false;
    let connection;
    let run;
    const lostSession = () => controller.abort(syncError('SYNC_INTERRUPTED'));
    try {
        client = await pool.connect();
        client.on?.('error', lostSession);
        locked = (await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired', [lockKey(id)])).rows[0].acquired;
        if (!locked) throw syncError('SYNC_ALREADY_RUNNING');
        connection = await connections.findConnectionById(id);
        if (!connection) throw syncError('CONNECTION_NOT_FOUND');
        if (!connection.is_active) throw syncError('CONNECTION_INACTIVE');
        controller.signal.throwIfAborted();
        if (trigger === 'scheduled') {
            const claimed = await client.query(`UPDATE api_connections
                SET sync_next_run_at = now() + sync_interval_minutes * interval '1 minute'
                WHERE id = $1 AND is_active AND sync_schedule_enabled
                  AND (sync_next_run_at IS NULL OR sync_next_run_at <= now())
                  AND (oauth_retry_after IS NULL OR oauth_retry_after <= now()) RETURNING id`, [id]);
            if (!claimed.rowCount) return null;
        }
        await recoverConnection(client, id);
        run = await logs.createSyncLog({ api_connection_id: id, project_slug: connection.project_slug,
            form_ref: connection.form_ref, status: 'running', started_at: new Date(),
            trigger_source: trigger, cursor_before: connection.sync_cursor, cursor_after: connection.sync_cursor,
            summary: { source_base_url: connection.base_url } });
        connection = await connections.findConnectionWithTokenById(id);
        const result = await context.run({ signal: controller.signal, runId: run.id, trigger },
            () => sync.syncConnectionToStaging(connection));
        controller.signal.throwIfAborted();
        return await finish(client, run, connection, result, null);
    } catch (error) {
        if (run) {
            try { await finish(client, run, connection, null, error); }
            catch { throw syncError('SYNC_STATE_WRITE_FAILED'); }
        }
        throw error;
    } finally {
        active.delete(id);
        client?.off?.('error', lostSession);
        if (client) {
            let destroy = false;
            try { if (locked) await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [lockKey(id)]); }
            catch { destroy = true; }
            client.release(destroy);
        }
    }
}

async function recoverInterruptedRuns() {
    const pending = await pool.query("SELECT DISTINCT api_connection_id FROM sync_logs WHERE status = 'running'");
    for (const { api_connection_id: id } of pending.rows) {
        if (active.has(id)) continue;
        const client = await pool.connect();
        let acquired = false;
        let destroy = false;
        try {
            acquired = (await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired', [lockKey(id)])).rows[0].acquired;
            if (acquired) await recoverConnection(client, id);
        } finally {
            try { if (acquired) await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [lockKey(id)]); }
            catch { destroy = true; }
            client.release(destroy);
        }
    }
}

function cancelRun(id, { scheduledOnly = false } = {}) {
    const run = active.get(id);
    if (run && (!scheduledOnly || run.trigger === 'scheduled')) run.controller.abort(syncError('CONNECTION_CHANGED'));
}
function cancelAll() { for (const run of active.values()) run.controller.abort(syncError('SYNC_INTERRUPTED')); }

module.exports = { runConnection, recoverInterruptedRuns, cancelRun, cancelAll };
