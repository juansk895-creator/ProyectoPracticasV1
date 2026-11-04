// Uso: npm --prefix backend run almacen:ficha -- <nucleo.json> <ficha.json> [--apply]
// Sin --apply se ejecuta todo dentro de una transacción que se revierte: es una vista previa exacta.
require('../src/config/env');
const { readFile } = require('node:fs/promises');
const pool = require('../src/config/db');
const { assertAlmacenStorage } = require('../src/services/almacenStorage.service');
const { planFicha, applyFicha } = require('../src/services/almacenCatalog.service');

async function leer(ruta) {
    try { return JSON.parse(await readFile(ruta, 'utf8')); } catch {
        throw Object.assign(new Error(`No se pudo leer ${ruta} como JSON.`), { code: 'ALMACEN_FICHA_INVALID', details: [] });
    }
}
(async () => {
    const [nucleoPath, fichaPath] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
    if (!nucleoPath || !fichaPath) throw Object.assign(new Error('Uso: almacen:ficha -- <nucleo.json> <ficha.json> [--apply]'), { code: 'USAGE' });
    const apply = process.argv.includes('--apply');
    const [nucleo, ficha] = [await leer(nucleoPath), await leer(fichaPath)];
    const client = await pool.connect();
    try {
        await assertAlmacenStorage(client);
        await client.query('BEGIN');
        const resultado = await applyFicha(client, await planFicha(client, nucleo, ficha));
        await client.query(apply ? 'COMMIT' : 'ROLLBACK');
        console.log(JSON.stringify(resultado, null, 2));
        console.log(apply ? 'Ficha cargada. Ejecuta almacen:proyectar para llevar los datos al almacén.'
            : 'Vista previa: no se modificó nada. Para aplicar, repite con --apply.');
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
})().catch((error) => {
    console.error(error.code?.startsWith('ALMACEN_') || error.code === 'USAGE' ? error.message : 'No se pudo cargar la ficha.');
    for (const detalle of error.details || []) console.error(`  - ${detalle}`);
    if (!error.code) console.error(error);
    process.exitCode = 1;
}).finally(() => pool.end());
