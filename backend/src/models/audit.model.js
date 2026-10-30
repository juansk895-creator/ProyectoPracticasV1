const pool = require('../config/db');
const { auditWhere } = require('../services/auditQuery.service');
const { assertAuditStorage } = require('../services/auditStorage.service');
const { parseProjectHierarchy } = require('../services/projectHierarchy.service');
const { downloadAudit } = require('../services/auditSource.service');
const { buildDeclaredColumns } = require('../services/projectSchema.service');
const fail = (code) => Object.assign(new Error(code), { code });

async function projectFor(client, connection) {
    const project = (await client.query('SELECT * FROM staging_projects WHERE base_url = $1 AND project_slug = $2',
        [connection.base_url, connection.project_slug])).rows[0];
    if (!project) throw fail('AUDIT_PROJECT_NOT_READY');
    return project;
}

async function findAudit(connection, query) {
    const client = await pool.connect();
    try {
        await assertAuditStorage(client);
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const project = await projectFor(client, connection);
        const scope = auditWhere(project.id, connection.form_ref, query);
        const summary = (await client.query(`SELECT count(*)::integer AS total,
            count(*) FILTER (WHERE audit_status = 'identified')::integer AS identified,
            count(*) FILTER (WHERE audit_status = 'anonymous')::integer AS anonymous,
            count(*) FILTER (WHERE audit_status = 'pending')::integer AS pending,
            count(*) FILTER (WHERE audit_status = 'stale')::integer AS stale,
            count(DISTINCT surveyor_id)::integer AS surveyors,
            min(created_at_epicollect) AS first_capture, max(created_at_epicollect) AS last_capture
            FROM staging_audit_records WHERE ${scope.sql}`, scope.values)).rows[0];
        const rows = (await client.query(`SELECT * FROM staging_audit_records WHERE ${scope.sql}
            ORDER BY created_at_epicollect DESC NULLS LAST, form_ref, entry_uuid
            LIMIT $${scope.values.length + 1} OFFSET $${scope.values.length + 2}`,
        [...scope.values, query.page_size, (query.page - 1) * query.page_size])).rows;
        const surveyors = (await client.query(`SELECT surveyor_id, surveyor_name, count(*)::integer AS records,
            count(*) FILTER (WHERE record_type = 'form')::integer AS main_records,
            count(*) FILTER (WHERE record_type = 'child')::integer AS child_records,
            count(*) FILTER (WHERE record_type = 'branch')::integer AS branch_records,
            min(created_at_epicollect) AS first_capture, max(created_at_epicollect) AS last_capture
            FROM staging_audit_records WHERE ${scope.sql} AND surveyor_id IS NOT NULL
            GROUP BY surveyor_id, surveyor_name ORDER BY count(*) DESC, surveyor_id LIMIT 100`, scope.values)).rows;
        const statuses = (await client.query(`SELECT DISTINCT validation_status FROM entradas_staging
            WHERE project_id = $1 AND ($2::text IS NULL OR form_ref = $2) ORDER BY validation_status`, [project.id, connection.form_ref])).rows;
        await client.query('COMMIT');
        return { summary, surveyors, surveyor_limit: 100, validation_statuses: statuses.map((s) => s.validation_status),
            columns: buildDeclaredColumns([project], connection.form_ref),
            rows: rows.map((row) => ({ ...row, row_key: JSON.stringify([row.project_id, row.form_ref, row.entry_uuid]) })),
            pagination: { page: query.page, page_size: query.page_size, total: summary.total,
                total_pages: Math.ceil(summary.total / query.page_size) } };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
}

async function refreshAudit(connection) {
    const client = await pool.connect();
    let locked = false;
    let key;
    try {
        await assertAuditStorage(client);
        const project = await projectFor(client, connection);
        key = `sedecollect:audit:${project.id}`;
        locked = (await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS ok', [key])).rows[0].ok;
        if (!locked) throw fail('AUDIT_ALREADY_RUNNING');
        const graph = parseProjectHierarchy(project.definition, connection.project_slug);
        const streams = graph.streams.filter((s) => !connection.form_ref || s.form_ref === connection.form_ref);
        if (!streams.length) throw fail('EPICOLLECT_FORM_UNKNOWN');
        const rows = await downloadAudit(connection, streams);
        await client.query('BEGIN');
        const current = (await client.query('SELECT * FROM api_connections WHERE id = $1 FOR UPDATE', [connection.id])).rows[0];
        if (!current?.is_active || ['base_url','project_slug','form_ref','provider'].some((k) => current[k] !== connection[k])) throw fail('CONNECTION_CHANGED');
        await client.query('DELETE FROM staging_entry_audit WHERE project_id = $1 AND form_ref = ANY($2::text[])',
            [project.id, streams.map((s) => s.form_ref)]);
        let matched = 0;
        for (const row of rows) {
            const result = await client.query(`INSERT INTO staging_entry_audit
                (project_id, form_ref, entry_uuid, surveyor_id, source_uploaded_at)
                SELECT project_id, form_ref, entry_uuid, $4, $5::timestamptz FROM entradas_staging
                WHERE project_id = $1 AND form_ref = $2 AND entry_uuid = $3 AND uploaded_at_epicollect = $5::timestamptz
                ON CONFLICT (project_id, form_ref, entry_uuid) DO UPDATE SET surveyor_id = EXCLUDED.surveyor_id,
                    source_uploaded_at = EXCLUDED.source_uploaded_at, checked_at = now()`,
            [project.id, row.form_ref, row.entry_uuid, row.surveyor_id, row.source_uploaded_at]);
            matched += result.rowCount;
        }
        await client.query('COMMIT');
        return { received: rows.length, matched, unmatched: rows.length - matched };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally {
        let destroy = false;
        try { if (locked) await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [key]); }
        catch { destroy = true; }
        client.release(destroy);
    }
}
module.exports = { findAudit, refreshAudit };
