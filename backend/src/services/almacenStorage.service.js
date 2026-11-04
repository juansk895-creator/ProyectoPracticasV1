const { readFile } = require('node:fs/promises');
const path = require('node:path');

const TABLAS = ['almacen_encuestas', 'almacen_secciones', 'almacen_variables', 'almacen_levantamientos',
    'almacen_levantamiento_secciones', 'almacen_correspondencias', 'almacen_reglas',
    'almacen_cuestionarios', 'almacen_registros', 'almacen_respuestas'];

async function assertAlmacenStorage(client) {
    const { rows } = await client.query(`SELECT count(*)::integer AS total FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name = ANY($1::text[])`, [TABLAS]);
    if (rows[0].total !== TABLAS.length) {
        throw Object.assign(new Error('Ejecuta npm --prefix backend run almacen:migrate.'), { code: 'ALMACEN_MIGRATION_REQUIRED' });
    }
}

async function migrateAlmacen(client) {
    await client.query('BEGIN');
    try {
        await client.query(await readFile(path.resolve(__dirname, '../../../database/upgrades/almacen.sql'), 'utf8'));
        await assertAlmacenStorage(client);
        await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
}

module.exports = { assertAlmacenStorage, migrateAlmacen };
