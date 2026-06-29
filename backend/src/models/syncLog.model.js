const pool = require('../config/db');

function normalizeDate(value) {
    if (!value) {
        return null;
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return date;
}

async function createSyncLog(logData) {
    const {
        api_connection_id,
        project_slug,
        form_ref = null,
        status,
        mode = null,
        started_at,
        finished_at,
        duration_ms = 0,
        filter_by = null,
        filter_from = null,
        cursor_before = null,
        cursor_after = null,
        total_entries_fetched = 0,
        procced_count = 0,
        skipped_count = 0,
        stopped_by_max_pages = false,
        error_message = null,
        summary = {},
    } = logData;

    const result = await pool.query(`
        INSERT INTO sync_logs (
            api_connection_id,
            project_slug,
            form_ref,
            status,
            mode,
            started_at,
            finished_at,
            duration_ms,
            filter_by,
            filter_from,
            cursor_before,
            cursor_after,
            total_entries_fetched,
            processed_count,
            skipped_count,
            stopped_by_max_pages,
            error_message,
            summary
        ) VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            $9,
            $10,
            $11,
            $12,
            $13,
            $14,
            $15,
            $16,
            $17,
            $18::jsonb
        )
        RETURNING
            id,
            api_connection_id,
            project_slug,
            form_ref,
            status,
            mode,
            started_at,
            finished_at,
            duration_ms,
            filter_by,
            filter_from,
            cursor_before,
            cursor_after,
            total_entries_fetched,
            processed_count,
            skipped_count,
            stopped_by_max_pages,
            error_message,
            summary,
            created_at
    `, [
        api_connection_id,
        project_slug,
        form_ref,
        status,
        mode,
        started_at,
        finished_at,
        duration_ms,
        filter_by,
        filter_from,
        cursor_before,
        cursor_after,
        total_entries_fetched,
        processed_count,
        skipped_count,
        stopped_by_max_pages,
        error_message,
        JSON.stringify(summary),
    ],);

    return result.rows[0];
}

async function findSyncLogsByConnectionId(connectionId, limit = 20) {
    const result = await pool.query(`
        SELECT
            id,
            api_connection_id,
            project_slug,
            form_ref,
            status,
            mode,
            started_at,
            finished_at,
            duration_ms,
            filter_by,
            filter_from,
            cursor_before,
            cursor_after,
            total_entries_fetched,
            processed_count,
            skipped_count,
            stopped_by_max_pages,
            error_message,
            summary,
            created_at
        FROM sync_logs
        WHERE api_connection_id = $1
        ORDER BY started_at DESC
        LIMIT $2
    `[
        connectionId, limit
    ]);

    return result.rows;
}

async function findAllSyncLogs(limit = 50) {
    const result = await pool.query(`
        SELECT
            sl.id,
            sl.api_connection_id,
            sl.project_slug,
            sl.form_ref,
            sl.status,
            sl.mode,
            sl.started_at,
            sl.finished_at,
            sl.duration_ms,
            sl.filter_by,
            sl.filter_from,
            sl.cursor_before,
            sl.cursor_after,
            sl.total_entries_fetched,
            sl.processed_count,
            sl.skipped_count,
            sl.stopped_by_max_pages,
            sl.error_message,
            sl.created_at
        FROM sync_logs sl
        JOIN api_connections ac
            ON ac.id = sl.api_connection_id
        ORDER BY sl.started_at DESC
        LIMIT $1
    `,[
        limit
    ],);
}

module.exports = {
    createSyncLog,
    findSyncLogsByConnectionId,
    findAllSyncLogs,
};

