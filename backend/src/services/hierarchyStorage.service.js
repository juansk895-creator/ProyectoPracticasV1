const path = require('node:path');
const { readFile } = require('node:fs/promises');
const { hierarchyError, normalizeHierarchyEntry } = require('./projectHierarchy.service');
const { compileProjectFields, extractFieldValues } = require('./projectSchema.service');

async function assertHierarchyStorage(client) {
    const { rows } = await client.query(`SELECT column_name, is_nullable FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'entradas_staging'
          AND column_name IN ('project_id', 'entry_uuid', 'record_type', 'parent_form_ref', 'parent_uuid', 'branch_ref', 'form_ref', 'field_values')`);
    if (rows.length !== 8 || rows.some((row) => ['project_id', 'entry_uuid', 'record_type', 'form_ref', 'field_values'].includes(row.column_name) && row.is_nullable !== 'NO')) {
        throw hierarchyError('STAGING_MIGRATION_REQUIRED', 'Ejecuta npm --prefix backend run staging:migrate -- --apply antes de iniciar el servidor.');
    }
}

async function saveProjectHierarchy(client, baseUrl, graph) {
    const saved = await client.query(`INSERT INTO staging_projects (project_slug, base_url, definition)
        VALUES ($1, $2, $3::jsonb) ON CONFLICT (base_url, project_slug) DO UPDATE
        SET definition = EXCLUDED.definition, updated_at = now()
        RETURNING id`, [graph.project_slug, baseUrl, JSON.stringify(graph.definition)]);
    const projectId = saved.rows[0].id;
    for (const stream of graph.streams) {
        const old = (await client.query('SELECT record_type, parent_form_ref FROM staging_streams WHERE project_id = $1 AND form_ref = $2',
            [projectId, stream.form_ref])).rows[0];
        if (old && (old.record_type !== stream.record_type || old.parent_form_ref !== stream.parent_form_ref)) {
            throw hierarchyError('STAGING_SOURCE_CONFLICT', 'Cambió la relación de un formulario existente. Revisa el esquema del proyecto.');
        }
        await client.query(`INSERT INTO staging_streams (project_id, form_ref, native_form_ref, record_type, parent_form_ref, branch_ref)
            VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (project_id, form_ref) DO NOTHING`,
        [projectId, stream.form_ref, stream.native_form_ref, stream.record_type, stream.parent_form_ref, stream.branch_ref]);
    }
    return projectId;
}

async function migrateHierarchy(client, projects = []) {
    await client.query('BEGIN');
    try {
        await client.query('LOCK TABLE api_connections, entradas_staging IN ACCESS EXCLUSIVE MODE');
        const hadFields = (await client.query(`SELECT 1 FROM information_schema.columns
            WHERE table_schema = current_schema() AND table_name = 'entradas_staging' AND column_name = 'field_values'`)).rowCount > 0;
        await client.query(await readFile(path.resolve(__dirname, '../../../database/upgrades/staging_hierarchy.sql'), 'utf8'));
        const pending = (await client.query(`SELECT * FROM entradas_staging WHERE project_id IS NULL OR entry_uuid IS NULL
            OR record_type IS NULL OR form_ref IS NULL`)).rows;
        const projectIds = new Map();
        for (const project of projects) {
            if (projectIds.has(project.graph.project_slug) && pending.some((row) => row.project_slug === project.graph.project_slug)) {
                throw hierarchyError('STAGING_PROJECT_REQUIRED', 'Los datos anteriores tienen un proyecto con procedencia ambigua.');
            }
            projectIds.set(project.graph.project_slug, await saveProjectHierarchy(client, project.base_url, project.graph));
        }
        let migrated = 0;
        for (const row of pending) {
            const project = projects.find((item) => item.graph.project_slug === row.project_slug);
            if (!project) throw hierarchyError('STAGING_PROJECT_REQUIRED', 'Falta la definición de un proyecto con datos existentes.');
            const stream = row.form_ref ? project.graph.streams.find((item) => item.form_ref === row.form_ref)
                : project.graph.streams.find((item) => item.record_type === 'form');
            if (!stream) throw hierarchyError('STAGING_PROJECT_REQUIRED', 'Un formulario existente no aparece en la definición del proyecto.');
            const normalized = normalizeHierarchyEntry(row.payload, row.project_slug, stream);
            if (normalized.entry_uuid !== row.ec5_uuid) throw hierarchyError('STAGING_ENTRY_INVALID', 'El identificador guardado no coincide con su documento original.');
            await client.query(`UPDATE entradas_staging SET entry_uuid = $2, form_ref = $3, record_type = $4,
                parent_form_ref = $5, parent_uuid = $6, branch_ref = $7, project_id = $12,
                created_at_epicollect = $9, updated_at_epicollect = $10, uploaded_at_epicollect = $11
                WHERE ec5_uuid = $1 AND project_slug = $8`,
            [row.ec5_uuid, normalized.entry_uuid, normalized.form_ref, normalized.record_type,
                normalized.parent_form_ref, normalized.parent_uuid, normalized.branch_ref, row.project_slug,
                normalized.created_at_epicollect?.toISOString() || null,
                normalized.updated_at_epicollect?.toISOString() || null,
                normalized.uploaded_at_epicollect?.toISOString() || null, projectIds.get(row.project_slug)]);
            migrated += 1;
        }
        if (!hadFields) {
            const savedProjects = (await client.query('SELECT id, definition FROM staging_projects')).rows;
            for (const project of savedProjects) {
                const { fields } = compileProjectFields(project.definition, 'default');
                const records = (await client.query('SELECT form_ref, entry_uuid, payload FROM entradas_staging WHERE project_id = $1', [project.id])).rows;
                for (const record of records) {
                    await client.query(`UPDATE entradas_staging SET field_values = $4::jsonb
                        WHERE project_id = $1 AND form_ref = $2 AND entry_uuid = $3`,
                    [project.id, record.form_ref, record.entry_uuid, JSON.stringify(extractFieldValues(record.payload, fields, record.form_ref))]);
                }
            }
            // La primera descarga con EC5_AUTO recupera también preguntas ocultas por el mapeo anterior.
            await client.query('UPDATE connection_streams SET sync_cursor = NULL');
            await client.query('UPDATE api_connections SET sync_cursor = NULL');
        }
        await client.query(`ALTER TABLE entradas_staging DROP CONSTRAINT IF EXISTS entradas_staging_pkey;
            ALTER TABLE entradas_staging
            ALTER COLUMN project_id SET NOT NULL, ALTER COLUMN entry_uuid SET NOT NULL, ALTER COLUMN form_ref SET NOT NULL,
            ALTER COLUMN record_type SET NOT NULL, ALTER COLUMN ec5_uuid DROP NOT NULL;
            ALTER TABLE entradas_staging ADD PRIMARY KEY (project_id, form_ref, entry_uuid);
            CREATE INDEX IF NOT EXISTS idx_staging_parent ON entradas_staging (project_id, parent_form_ref, parent_uuid);
            ALTER TABLE entradas_staging DROP CONSTRAINT IF EXISTS staging_record_type_check;
            ALTER TABLE entradas_staging ADD CONSTRAINT staging_record_type_check
                CHECK (record_type IN ('form', 'child', 'branch'));
            ALTER TABLE entradas_staging DROP CONSTRAINT IF EXISTS staging_stream_check;
            ALTER TABLE entradas_staging ADD CONSTRAINT staging_stream_check
                FOREIGN KEY (project_id, form_ref) REFERENCES staging_streams(project_id, form_ref);
        `);
        const dates = await client.query(`SELECT column_name FROM information_schema.columns
            WHERE table_schema = current_schema() AND table_name = 'entradas_staging'
              AND column_name IN ('created_at_epicollect', 'updated_at_epicollect', 'uploaded_at_epicollect')
              AND data_type = 'timestamp without time zone'`);
        for (const { column_name: column } of dates.rows) {
            await client.query(`ALTER TABLE entradas_staging ALTER COLUMN "${column}" TYPE TIMESTAMPTZ
                USING "${column}" AT TIME ZONE 'UTC'`);
        }
        await assertHierarchyStorage(client);
        await client.query('COMMIT');
        return { migrated, preserved: pending.length };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
}

module.exports = { assertHierarchyStorage, saveProjectHierarchy, migrateHierarchy };
