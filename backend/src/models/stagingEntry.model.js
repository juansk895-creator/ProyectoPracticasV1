const pool = require('../config/db');
const { buildWhereClause, buildOrderByClause } = require('../services/stagingQuery.service');
const { normalizeHierarchyEntry, hierarchyError } = require('../services/projectHierarchy.service');
const { saveProjectHierarchy } = require('../services/hierarchyStorage.service');
const { compileProjectFields, extractFieldValues, buildDeclaredColumns } = require('../services/projectSchema.service');
const { buildDynamicColumns } = require('../services/schemaAnalyzer.service');

async function upsertStagingEntry(client, row) {
    await client.query(`INSERT INTO entradas_staging (project_slug, form_ref, entry_uuid, ec5_uuid,
        record_type, parent_form_ref, parent_uuid, branch_ref, created_by, project_id,
        created_at_epicollect, updated_at_epicollect, uploaded_at_epicollect, payload,
        sync_status, validation_status, field_values)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$14,$10,$11,$12,$13::jsonb,'pending','unvalidated',$15::jsonb)
        ON CONFLICT (project_id, form_ref, entry_uuid) DO UPDATE SET
            ec5_uuid = EXCLUDED.ec5_uuid, record_type = EXCLUDED.record_type,
            parent_form_ref = EXCLUDED.parent_form_ref, parent_uuid = EXCLUDED.parent_uuid,
            branch_ref = EXCLUDED.branch_ref, created_by = EXCLUDED.created_by,
            created_at_epicollect = EXCLUDED.created_at_epicollect,
            updated_at_epicollect = EXCLUDED.updated_at_epicollect,
            uploaded_at_epicollect = EXCLUDED.uploaded_at_epicollect,
            payload = EXCLUDED.payload, field_values = entradas_staging.field_values || EXCLUDED.field_values,
            sync_status = 'pending', updated_at = now()`,
    [row.project_slug, row.form_ref, row.entry_uuid, row.ec5_uuid, row.record_type,
        row.parent_form_ref, row.parent_uuid, row.branch_ref, row.created_by,
        row.created_at_epicollect, row.updated_at_epicollect, row.uploaded_at_epicollect, JSON.stringify(row.payload), row.project_id,
        JSON.stringify(row.field_values || {})]);
}

function iso(value) { return value ? new Date(value).toISOString() : null; }

async function persistHierarchy(connection, graph, downloads) {
    const { fields } = compileProjectFields(graph.definition);
    const entries = downloads.flatMap((download) => download.entries.map(
        (entry) => ({ ...normalizeHierarchyEntry(entry, connection.project_slug, download.stream),
            field_values: extractFieldValues(entry, fields, download.stream.form_ref) })));
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout = '20s'");
        const current = (await client.query('SELECT * FROM api_connections WHERE id = $1 FOR UPDATE', [connection.id])).rows[0];
        if (!current?.is_active || ['provider', 'base_url', 'project_slug', 'form_ref', 'sync_filter_by', 'auth_type'].some(
            (field) => current[field] !== connection[field])) {
            throw hierarchyError('CONNECTION_CHANGED', 'La conexión cambió durante la descarga.');
        }
        const projectId = await saveProjectHierarchy(client, connection.base_url, graph);
        for (const download of downloads) {
            const saved = (await client.query(`SELECT sync_cursor FROM connection_streams
                WHERE connection_id = $1 AND form_ref = $2`, [connection.id, download.stream.form_ref])).rows[0];
            if (iso(saved?.sync_cursor) !== iso(download.previousCursor)) {
                throw hierarchyError('CONNECTION_CHANGED', 'Otra sincronización actualizó el avance. Repite la operación.');
            }
        }
        for (const entry of entries) await upsertStagingEntry(client, { ...entry, project_id: projectId });
        for (const download of downloads) {
            await client.query(`INSERT INTO connection_streams (connection_id, project_id, form_ref, sync_cursor)
                VALUES ($1,$2,$3,$4) ON CONFLICT (connection_id, form_ref) DO UPDATE SET sync_cursor = EXCLUDED.sync_cursor`,
            [connection.id, projectId, download.stream.form_ref, download.nextCursor]);
        }
        const pending = await client.query(`SELECT count(*)::integer AS total FROM entradas_staging s
            WHERE s.project_id = $1 AND s.form_ref = ANY($2::text[]) AND s.parent_uuid IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM entradas_staging p WHERE p.project_id = s.project_id
                AND p.form_ref = s.parent_form_ref AND p.entry_uuid = s.parent_uuid)`,
        [projectId, downloads.map((item) => item.stream.form_ref)]);
        await client.query('COMMIT');
        return { received: entries.length, processed: entries.length, skipped: 0, errors: [], pendingParents: pending.rows[0].total };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally { client.release(); }
}

async function findStagingEntries({ projectSlug, sourceBaseUrl = null, formRef = null, page = 1, pageSize = 50,
    search = null, filters = [], sortBy = 'received_at', sortOrder = 'desc', fieldColumns = [] }) {
    const { whereClause, values: filterValues } = buildWhereClause({ projectSlug, sourceBaseUrl, formRef, search, filters, fieldColumns });
    const rowValues = [...filterValues];
    const orderByClause = buildOrderByClause({ sortBy, sortOrder, values: rowValues, fieldColumns });
    const limit = rowValues.push(pageSize);
    const offset = rowValues.push((page - 1) * pageSize);
    const [rows, count] = await Promise.all([
        pool.query(`SELECT ec5_uuid, entry_uuid, project_id, project_slug, form_ref, record_type,
            (SELECT base_url FROM staging_projects WHERE id = s.project_id) AS source_base_url,
            branch_ref, parent_form_ref, parent_uuid,
            CASE WHEN parent_uuid IS NULL THEN true ELSE EXISTS (
                SELECT 1 FROM entradas_staging p WHERE p.project_id = s.project_id
                  AND p.form_ref = s.parent_form_ref AND p.entry_uuid = s.parent_uuid) END AS parent_found,
            created_by, created_at_epicollect, updated_at_epicollect, uploaded_at_epicollect,
            payload, field_values, sync_status, validation_status, received_at, updated_at
            FROM entradas_staging s WHERE ${whereClause} ORDER BY ${orderByClause} LIMIT $${limit} OFFSET $${offset}`, rowValues),
        pool.query(`SELECT count(*)::integer AS total FROM entradas_staging WHERE ${whereClause}`, filterValues),
    ]);
    return { rows: rows.rows.map((row) => ({ ...row,
        row_key: JSON.stringify([row.project_id, row.form_ref, row.entry_uuid]) })), total: count.rows[0].total };
}

async function findStagingSchema({ projectSlug, sourceBaseUrl = null, formRef = null }) {
    const values = [projectSlug];
    let where = 'project_slug = $1';
    if (sourceBaseUrl) {
        values.push(sourceBaseUrl);
        where += ` AND base_url = $${values.length}`;
    }
    const result = await pool.query(`SELECT id, definition FROM staging_projects WHERE ${where} ORDER BY base_url, id`, values);
    const columns = buildDeclaredColumns(result.rows, formRef);
    const customIds = result.rows.filter((project) => project.definition.meta?.sedecollect_source === 'custom').map((project) => project.id);
    if (customIds.length) {
        const observed = await pool.query(`WITH RECURSIVE scoped AS (
                SELECT payload FROM entradas_staging WHERE project_id = ANY($1::uuid[])
                  AND ($2::text IS NULL OR form_ref = $2)
            ), tree (path, value) AS (
                SELECT ARRAY[f.key]::text[], f.value FROM scoped
                CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(payload) = 'object' THEN payload ELSE '{}'::jsonb END) f
                UNION ALL SELECT t.path || f.key, f.value FROM tree t
                CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(t.value) = 'object' THEN t.value ELSE '{}'::jsonb END) f
            ) SELECT array_to_string(path, '.') AS field_path, array_agg(DISTINCT jsonb_typeof(value)) AS observed_types,
                count(*)::integer AS occurrences, (SELECT count(*)::integer FROM scoped) AS total_entries
              FROM tree WHERE jsonb_typeof(value) <> 'object' GROUP BY path ORDER BY path`, [customIds, formRef]);
        columns.push(...buildDynamicColumns(observed.rows));
    }
    return columns;
}

module.exports = { upsertStagingEntry, persistHierarchy, findStagingEntries, findStagingSchema };
