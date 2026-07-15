const pool = require('../config/db');

const { buildWhereClause, buildOrderByClause, } = require('../services/stagingQuery.service');

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

function mapEpicollectEntryToStaging(entry, connection){
    const ec5Uuid = entry.ec5_uuid || entry.entry_uuid || entry.uuid || entry.id;

    if (!ec5Uuid) {
        throw new Error('La entrada no contiene ec5_uuid, entry_uuid, uuid ni id.');
    }

    return {
        ec5_uuid: ec5Uuid,
        project_slug: connection.project_slug,
        form_ref: connection.form_ref || null,
        created_by: entry.created_by || entry.created_by_username || null,
        created_at_epicollect: normalizeDate(entry.created_at),
        updated_at_epicollect: normalizeDate(entry.updated_at),
        uploaded_at_epicollect: normalizeDate(entry.uploaded_at),
        payload: entry,
    };
}

async function upsertStagingEntry(client, stagingEntry) {
    const result = await client.query(`
        INSERT INTO entradas_staging (
            ec5_uuid,
            project_slug,
            form_ref,
            created_by,
            created_at_epicollect,
            updated_at_epicollect,
            uploaded_at_epicollect,
            payload,
            sync_status,
            validation_status
        )
        VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8::jsonb,
            'pending',
            'unvalidated'
        )
        ON CONFLICT (ec5_uuid)
        DO UPDATE SET
            project_slug = EXCLUDED.project_slug,
            form_ref = EXCLUDED.form_ref,
            created_by =EXCLUDED.created_by,
            created_at_epicollect = EXCLUDED.created_at_epicollect,
            updated_at_epicollect = EXCLUDED.updated_at_epicollect,
            uploaded_at_epicollect = EXCLUDED.uploaded_at_epicollect,
            payload = EXCLUDED.payload,
            sync_status = 'pending',
            updated_at = now()
        RETURNING ec5_uuid
    `,[
        stagingEntry.ec5_uuid,
        stagingEntry.project_slug,
        stagingEntry.form_ref,
        stagingEntry.created_by,
        stagingEntry.created_at_epicollect,
        stagingEntry.updated_at_epicollect,
        stagingEntry.uploaded_at_epicollect,
        JSON.stringify(stagingEntry.payload),
    ],);

    return result.rows[0];
}

async function upsertManyEpicollectEntries(entries, connection) {
    const client = await pool.connect();

    const summary = {
        received: entries.length,
        processed:0,
        skipped: 0,
        errors: [],
    };

    try {
        await client.query('BEGIN');

        for (const entry of entries) {
            try {
                const stagingEntry = mapEpicollectEntryToStaging(entry, connection);

                await upsertStagingEntry(client, stagingEntry);

                summary.processed +=1;
            } catch (error) {
                summary.skipped +=1;
                summary.errors.push({
                    reason: error.message,
                    entry,
                });
            }
        }

        await client.query('COMMIT');

        return summary;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

// 3.1
async function findStagingEntries({
    projectSlug,
    formRef = null,
    page = 1,
    pageSize = 50,
    //
    search = null,
    filters = [],
    sortBy = 'received_at',
    sortOrder = 'desc',

}) {

    const {
        whereClause,
        values: filterValues,
    } = buildWhereClause({
        projectSlug,
        formRef,
        search,
        filters,
    });

    const rowValues = [...filterValues];

    const orderByClause = buildOrderByClause({
        sortBy,
        sortOrder,
        values: rowValues,
    });

    const offset = (page - 1) * pageSize;

    const limitPosition = rowValues.length + 1;

    const offsetPosition = rowValues.length + 2;

    rowValues.push(pageSize, offset);

    const [rowResult, countResult] = await Promise.all([
        pool.query(`
            SELECT
                ec5_uuid,
                project_slug,
                form_ref,
                created_by,
                created_at_epicollect,
                updated_at_epicollect,
                uploaded_at_epicollect,
                payload,
                sync_status,
                validation_status,
                received_at,
                updated_at
            FROM entradas_staging
            WHERE ${whereClause}
            ORDER BY ${orderByClause}
            LIMIT $${limitPosition}
            OFFSET $${offsetPosition}
        `,rowValues,
        ),
        pool.query(`
            SELECT
            COUNT(*)::integer AS total
            FROM entradas_staging
            WHERE ${whereClause}
        `,filterValues,
        ),
    ]);

    return {
        rows: rowResult.rows,
        total: countResult.rows[0]?.total ?? 0,
    };
}

async function findStagingSchema({
    projectSlug,
    formRef = null,
}) {
    const conditions = ['project_slug = $1'];
    const filterValues = [projectSlug];

    if (formRef) {
        filterValues.push(formRef);
        conditions.push(`form_ref = $${filterValues.length}`);
    }

    const whereClause = conditions.join(' AND ');

    const result = await pool.query(
        `
            WITH RECURSIVE scoped_payloads AS (
                SELECT payload
                FROM entradas_staging
                WHERE ${whereClause}
            ),
            json_tree (path, value) AS (
                SELECT
                    ARRAY[root_field.key]::text[] AS path,
                    root_field.value
                FROM scoped_payloads
                CROSS JOIN LATERAL jsonb_each(
                    CASE
                        WHEN jsonb_typeof(payload) = 'object'
                            THEN payload
                        ELSE '{}'::jsonb
                    END
                ) AS root_field(key, value)

                UNION ALL

                SELECT
                    json_tree.path || child_field.key,
                    child_field.value
                FROM json_tree
                CROSS JOIN LATERAL jsonb_each(
                    CASE
                        WHEN jsonb_typeof(json_tree.value) = 'object'
                            THEN json_tree.value
                        ELSE '{}'::jsonb
                    END
                ) AS child_field(key, value)
            )
            SELECT
                array_to_string(path, '.') AS field_path,
                array_agg(
                    DISTINCT jsonb_typeof(value)
                    ORDER BY jsonb_typeof(value)
                ) AS observed_types,
                COUNT(*)::integer AS occurrences,
                (
                    SELECT COUNT(*)::integer
                    FROM scoped_payloads
                ) AS total_entries
            FROM json_tree
            WHERE jsonb_typeof(value) <> 'object'
            GROUP BY path
            ORDER BY path
        `,
        filterValues,
    );

    return result.rows;
}

module.exports = {
    upsertStagingEntry,
    upsertManyEpicollectEntries,
    findStagingEntries,
    findStagingSchema,
};

