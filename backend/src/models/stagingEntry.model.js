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
        stagingEntry.updated_at_epicolect,
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

module.exports = {
    upsertManyEpicollectEntries,
};





