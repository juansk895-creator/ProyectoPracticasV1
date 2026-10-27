const pool = require('../config/db');
const { safeConnectionError, safeConnectionErrorCode } = require('../utils/connectionError');

async function getDashboard(days) {
    // Una sola sentencia mantiene todos los recuentos sobre la misma instantánea.
    // El historial existente usa TIMESTAMP sin zona: el período sigue su calendario.
    const result = await pool.query(`
        WITH period AS (
            SELECT (CURRENT_DATE - ($1::integer - 1))::timestamp AS starts,
                (CURRENT_DATE + 1)::timestamp AS ends
        ), logs AS MATERIALIZED (
            SELECT sl.* FROM sync_logs sl, period p
            WHERE sl.started_at >= p.starts AND sl.started_at < p.ends
        ), daily AS (
            SELECT started_at::date AS day, count(*) AS runs,
                count(*) FILTER (WHERE status = 'success') AS successful,
                count(*) FILTER (WHERE status = 'failed') AS failed,
                count(*) FILTER (WHERE status = 'partial') AS partial,
                count(*) FILTER (WHERE status = 'running') AS running,
                sum(processed_count) AS processed
            FROM logs GROUP BY started_at::date
        )
        SELECT jsonb_build_object(
            'generatedAt', CURRENT_TIMESTAMP,
            'period', (SELECT jsonb_build_object('days', $1::integer,
                'from', starts::date::text, 'through', (ends::date - 1)::text) FROM period),
            'connections', (SELECT jsonb_build_object('total', count(*),
                'active', count(*) FILTER (WHERE is_active)) FROM api_connections),
            'staging', (SELECT jsonb_build_object('total', count(*),
                'unvalidated', count(*) FILTER (WHERE validation_status = 'unvalidated'),
                'forms', count(*) FILTER (WHERE record_type = 'form'),
                'children', count(*) FILTER (WHERE record_type = 'child'),
                'branches', count(*) FILTER (WHERE record_type = 'branch'),
                'pendingParents', count(*) FILTER (WHERE s.parent_uuid IS NOT NULL
                    AND NOT EXISTS (SELECT 1 FROM entradas_staging parent
                        WHERE parent.project_id = s.project_id
                          AND parent.form_ref = s.parent_form_ref
                          AND parent.entry_uuid = s.parent_uuid))) FROM entradas_staging s),
            'validation', COALESCE((SELECT jsonb_agg(v ORDER BY v.status) FROM (
                SELECT validation_status AS status, count(*) AS total
                FROM entradas_staging GROUP BY validation_status) v), '[]'::jsonb),
            'sync', (SELECT jsonb_build_object('runs', count(*),
                'successful', count(*) FILTER (WHERE status = 'success'),
                'failed', count(*) FILTER (WHERE status = 'failed'),
                'partial', count(*) FILTER (WHERE status = 'partial'),
                'running', count(*) FILTER (WHERE status = 'running'),
                'fetched', COALESCE(sum(total_entries_fetched), 0),
                'processed', COALESCE(sum(processed_count), 0),
                'skipped', COALESCE(sum(skipped_count), 0),
                'durationMs', COALESCE(sum(duration_ms), 0),
                'recordsPerSecond', CASE WHEN sum(duration_ms) > 0 THEN
                    round(sum(processed_count)::numeric * 1000 / sum(duration_ms), 2)
                    ELSE NULL END) FROM logs),
            'daily', (SELECT jsonb_agg(jsonb_build_object('day', calendar.day::date::text,
                'runs', COALESCE(d.runs, 0), 'successful', COALESCE(d.successful, 0),
                'failed', COALESCE(d.failed, 0), 'partial', COALESCE(d.partial, 0),
                'running', COALESCE(d.running, 0),
                'processed', COALESCE(d.processed, 0)) ORDER BY calendar.day)
                FROM period p CROSS JOIN LATERAL generate_series(
                    p.starts, p.ends - interval '1 day', interval '1 day') calendar(day)
                LEFT JOIN daily d ON d.day = calendar.day::date),
            'recent', COALESCE((SELECT jsonb_agg(r ORDER BY r.started_at DESC, r.id DESC)
                FROM (SELECT sl.id, sl.api_connection_id, ac.name AS connection_name,
                    sl.project_slug, sl.form_ref, sl.status, sl.mode, sl.trigger_source,
                    to_char(sl.started_at, 'YYYY-MM-DD HH24:MI:SS') AS started_at,
                    to_char(sl.finished_at, 'YYYY-MM-DD HH24:MI:SS') AS finished_at,
                    sl.duration_ms, sl.processed_count, sl.skipped_count,
                    sl.total_entries_fetched, sl.cursor_before, sl.cursor_after,
                    sl.summary->>'error_code' AS error_code,
                    sl.summary->'http_status' AS http_status
                FROM logs sl JOIN api_connections ac ON ac.id = sl.api_connection_id
                ORDER BY sl.started_at DESC, sl.id DESC LIMIT 20) r), '[]'::jsonb),
            'consolidated', NULL
        ) AS dashboard`, [days]);
    const dashboard = result.rows[0].dashboard;
    dashboard.recent = dashboard.recent.map(({ error_code: storedCode, http_status: httpStatus, ...run }) => {
        const error = { code: storedCode, statusCode: httpStatus };
        return { ...run, error_code: run.status === 'failed'
            ? safeConnectionErrorCode(error, 'SYNC_FAILED') : null,
        error_message: run.status === 'failed' ? safeConnectionError(error) : null };
    });
    return dashboard;
}

module.exports = { getDashboard };
