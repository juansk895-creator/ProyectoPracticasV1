const { normalizeSurveyorId } = require('./auditSource.service');
const fail = () => Object.assign(new Error('El directorio no es válido.'), { code: 'AUDIT_DIRECTORY_INVALID' });
async function replaceSurveyors(client, connection, document) {
    if (!document || typeof document.source !== 'string' || !document.source.trim() || document.source.length > 200 ||
        !Array.isArray(document.surveyors) || document.surveyors.length > 100000) throw fail();
    const seen = new Set();
    const rows = document.surveyors.map((row) => {
        let id;
        try { id = normalizeSurveyorId(row?.surveyor_id); } catch { throw fail(); }
        if (id === null || seen.has(id) || typeof row.display_name !== 'string' ||
            !row.display_name.trim() || row.display_name.length > 200 || /[\x00-\x1f\x7f]/.test(row.display_name)) throw fail();
        seen.add(id); return { id, name: row.display_name.trim() };
    });
    await client.query('BEGIN');
    try {
        const project = (await client.query(`SELECT id FROM staging_projects
            WHERE base_url = $1 AND project_slug = $2 FOR UPDATE`, [connection.base_url, connection.project_slug])).rows[0];
        if (!project) throw fail();
        await client.query('DELETE FROM staging_surveyors WHERE project_id = $1', [project.id]);
        for (const row of rows) await client.query(`INSERT INTO staging_surveyors
            (project_id, surveyor_id, display_name, source_reference) VALUES ($1,$2,$3,$4)`,
        [project.id, row.id, row.name, document.source.trim()]);
        await client.query('COMMIT');
        return { imported: rows.length };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
}
module.exports = { replaceSurveyors };
