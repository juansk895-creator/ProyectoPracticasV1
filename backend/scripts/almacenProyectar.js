// Uso: npm --prefix backend run almacen:proyectar -- <encuesta> [anio] [--apply]
require('../src/config/env');
const pool = require('../src/config/db');
const { assertAlmacenStorage } = require('../src/services/almacenStorage.service');
const { projectLevantamiento } = require('../src/services/almacenProjection.service');
(async () => {
    const [encuesta, anio] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
    if (!encuesta) throw Object.assign(new Error('Uso: almacen:proyectar -- <encuesta> [anio] [--apply]'), { code: 'USAGE' });
    const apply = process.argv.includes('--apply');
    const client = await pool.connect();
    try {
        await assertAlmacenStorage(client);
        await client.query('BEGIN');
        const levantamientos = (await client.query(`SELECT l.id FROM almacen_levantamientos l JOIN almacen_encuestas e ON e.id = l.encuesta_id
            WHERE e.clave = $1 AND ($2::int IS NULL OR l.anio = $2) ORDER BY l.anio`, [encuesta, anio ? Number(anio) : null])).rows;
        if (!levantamientos.length) throw Object.assign(new Error('No hay levantamientos con esa encuesta y año.'), { code: 'ALMACEN_LEVANTAMIENTO_NOT_FOUND' });
        const resultados = [];
        for (const { id } of levantamientos) resultados.push(await projectLevantamiento(client, id));
        await client.query(apply ? 'COMMIT' : 'ROLLBACK');
        console.log(JSON.stringify(resultados, null, 2));
        console.log(apply ? 'Proyección aplicada.' : 'Vista previa: no se modificó nada. Para aplicar, repite con --apply.');
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
})().catch((error) => {
    console.error(error.code?.startsWith('ALMACEN_') || error.code === 'USAGE' ? error.message : 'No se pudo proyectar.');
    if (!error.code) console.error(error);
    process.exitCode = 1;
}).finally(() => pool.end());
