// Vistas anchas del almacén, generadas desde el catálogo: una columna por variable.
//   almacen_v_nucleo                  todas las encuestas y años, sólo el núcleo común
//   almacen_v_<encuesta>              núcleo + variables propias, años unificados
//   almacen_v_<encuesta>_<seccion>    una fila por repetición de la sección
//   almacen_v_respuestas              formato largo legible, con la condición de cada respuesta
// Los identificadores salen del catálogo, cuyas claves la base ya restringe a [a-z0-9_].

const IDENT = /^[a-z][a-z0-9_]{0,62}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

function ident(name) {
    if (!IDENT.test(name)) throw Object.assign(new Error(`Identificador no válido: ${name}`), { code: 'ALMACEN_VIEW_INVALID' });
    return `"${name}"`;
}
function uuid(value) {
    if (!UUID.test(value)) throw Object.assign(new Error('Identificador interno no válido.'), { code: 'ALMACEN_VIEW_INVALID' });
    return `'${value}'::uuid`;
}
// Hay a lo sumo una respuesta por registro y variable (clave primaria), así que max() sólo
// selecciona ese valor; opera sobre la columna de su tipo.
function columna(variable) {
    const valor = { texto: 'valor_texto', categoria: 'valor_texto', fecha: 'valor_fecha',
        decimal: 'valor_numero', entero: 'valor_numero' }[variable.tipo];
    const cast = variable.tipo === 'entero' ? '::bigint' : '';
    return `(max(r.${valor}) FILTER (WHERE r.variable_id = ${uuid(variable.id)}))${cast} AS ${ident(variable.clave)}`;
}

async function regenerateViews(client) {
    const existentes = await client.query(`SELECT viewname FROM pg_views
        WHERE schemaname = current_schema() AND viewname LIKE 'almacen\\_v\\_%'`);
    for (const { viewname } of existentes.rows) await client.query(`DROP VIEW IF EXISTS ${ident(viewname)}`);

    const encuestas = (await client.query('SELECT id, clave FROM almacen_encuestas ORDER BY clave')).rows;
    const variables = (await client.query(`SELECT v.id, v.clave, v.tipo, v.encuesta_id, s.clave AS seccion
        FROM almacen_variables v LEFT JOIN almacen_secciones s ON s.id = v.seccion_id
        ORDER BY v.encuesta_id NULLS FIRST, v.orden`)).rows;
    const nucleo = variables.filter((v) => !v.encuesta_id);
    const base = `FROM almacen_cuestionarios c
        JOIN almacen_levantamientos l ON l.id = c.levantamiento_id
        JOIN almacen_encuestas e ON e.id = l.encuesta_id
        JOIN almacen_registros g ON g.cuestionario_id = c.id AND g.seccion_id IS NULL
        LEFT JOIN almacen_respuestas r ON r.registro_id = g.id`;
    const fijas = 'c.id AS cuestionario_id, e.clave AS encuesta, l.anio, c.estado, c.desactualizado, c.origen_entry_uuid AS origen_uuid';
    const agrupar = 'GROUP BY c.id, e.clave, l.anio, c.estado, c.desactualizado, c.origen_entry_uuid';
    const creadas = [];

    await client.query(`CREATE VIEW almacen_v_nucleo AS SELECT ${[fijas, ...nucleo.map(columna)].join(', ')} ${base} ${agrupar}`);
    creadas.push('almacen_v_nucleo');

    for (const encuesta of encuestas) {
        const propias = variables.filter((v) => v.encuesta_id === encuesta.id);
        const principales = [...nucleo, ...propias.filter((v) => !v.seccion)];
        const nombre = `almacen_v_${encuesta.clave}`;
        await client.query(`CREATE VIEW ${ident(nombre)} AS SELECT ${[fijas, ...principales.map(columna)].join(', ')}
            ${base} WHERE e.id = ${uuid(encuesta.id)} ${agrupar}`);
        creadas.push(nombre);
        const secciones = [...new Set(propias.filter((v) => v.seccion).map((v) => v.seccion))];
        for (const seccion of secciones) {
            const deSeccion = propias.filter((v) => v.seccion === seccion);
            const vista = `almacen_v_${encuesta.clave}_${seccion}`;
            await client.query(`CREATE VIEW ${ident(vista)} AS SELECT g.id AS registro_id, g.padre_id, c.id AS cuestionario_id,
                    e.clave AS encuesta, l.anio, c.estado, ${deSeccion.map(columna).join(', ')}
                FROM almacen_registros g
                JOIN almacen_secciones s ON s.id = g.seccion_id AND s.clave = '${ident(seccion).slice(1, -1)}' AND s.encuesta_id = ${uuid(encuesta.id)}
                JOIN almacen_cuestionarios c ON c.id = g.cuestionario_id
                JOIN almacen_levantamientos l ON l.id = c.levantamiento_id
                JOIN almacen_encuestas e ON e.id = l.encuesta_id
                LEFT JOIN almacen_respuestas r ON r.registro_id = g.id
                GROUP BY g.id, g.padre_id, c.id, e.clave, l.anio, c.estado`);
            creadas.push(vista);
        }
    }

    await client.query(`CREATE VIEW almacen_v_respuestas AS
        SELECT c.id AS cuestionario_id, e.clave AS encuesta, l.anio, c.estado, s.clave AS seccion, g.id AS registro_id,
            v.clave AS variable, v.tipo, COALESCE(r.valor_texto, r.valor_numero::text, r.valor_fecha::text) AS valor,
            r.condicion, r.valor_origen
        FROM almacen_respuestas r
        JOIN almacen_registros g ON g.id = r.registro_id
        JOIN almacen_cuestionarios c ON c.id = g.cuestionario_id
        JOIN almacen_levantamientos l ON l.id = c.levantamiento_id
        JOIN almacen_encuestas e ON e.id = l.encuesta_id
        JOIN almacen_variables v ON v.id = r.variable_id
        LEFT JOIN almacen_secciones s ON s.id = g.seccion_id`);
    creadas.push('almacen_v_respuestas');
    return creadas;
}

module.exports = { regenerateViews };
