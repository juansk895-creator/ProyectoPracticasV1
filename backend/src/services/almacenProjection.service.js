// Proyección: aplica la ficha a las entradas de staging de un levantamiento y escribe
// cuestionarios, registros y respuestas. Es idempotente: repetirla actualiza lo pendiente sin
// duplicar. Un cuestionario que ya no está «pendiente» (validado o promovido en fases
// posteriores) no se reescribe; si su origen cambió, se marca como desactualizado.

const ISO = /^(\d{4})-(\d{2})-(\d{2})/;
// Formatos de fecha completa de Epicollect5. Los parciales (MM/YYYY, dd/MM) no se completan
// inventando el día o el año: quedan como no interpretables.
const FORMATOS = { 'dd/MM/YYYY': ['d', 'm', 'y'], 'MM/dd/YYYY': ['m', 'd', 'y'], 'YYYY/MM/dd': ['y', 'm', 'd'] };

function leerFecha(texto, formato) {
    let partes;
    const iso = ISO.exec(texto);
    if (iso) partes = { y: iso[1], m: iso[2], d: iso[3] };
    else if (FORMATOS[formato]) {
        const trozos = /^(\d{1,4})\/(\d{1,2})\/(\d{1,4})$/.exec(texto);
        if (!trozos) return null;
        partes = Object.fromEntries(FORMATOS[formato].map((clave, i) => [clave, trozos[i + 1]]));
    } else return null;
    const [y, m, d] = [Number(partes.y), Number(partes.m), Number(partes.d)];
    const fecha = new Date(Date.UTC(y, m - 1, d));
    if (String(partes.y).length !== 4 || fecha.getUTCFullYear() !== y || fecha.getUTCMonth() !== m - 1 || fecha.getUTCDate() !== d) return null;
    return `${partes.y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Convierte el valor de staging al tipo de la variable. Nunca adivina: lo que no puede
// interpretar queda como «no_interpretable», con el valor de origen intacto.
function convertValue(raw, variable, correspondencia) {
    const origen = raw === undefined ? null : raw;
    const vacio = (valor) => valor === null || valor === undefined || (typeof valor === 'string' && !valor.trim()) ||
        (Array.isArray(valor) && !valor.length);
    if (!correspondencia) return { condicion: 'no_se_pregunto', valor_origen: null };
    if (vacio(origen)) return { condicion: 'no_contesto', valor_origen: origen };
    const malo = { condicion: 'no_interpretable', valor_origen: origen };
    switch (variable.tipo) {
    case 'texto':
        return typeof origen === 'object' ? malo : { condicion: 'respondida', valor_texto: String(origen).trim(), valor_origen: origen };
    case 'entero':
    case 'decimal': {
        if (typeof origen === 'object' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(String(origen).trim())) return malo;
        const numero = Number(String(origen).trim());
        if (!Number.isFinite(numero) || (variable.tipo === 'entero' && !Number.isInteger(numero))) return malo;
        return { condicion: 'respondida', valor_numero: String(origen).trim(), valor_origen: origen };
    }
    case 'fecha': {
        const fecha = typeof origen === 'string' ? leerFecha(origen.trim(), correspondencia.formato_fecha) : null;
        return fecha ? { condicion: 'respondida', valor_fecha: fecha, valor_origen: origen } : malo;
    }
    case 'categoria': {
        const codigo = typeof origen === 'string' && correspondencia.opciones && Object.hasOwn(correspondencia.opciones, origen)
            ? correspondencia.opciones[origen] : null;
        return codigo ? { condicion: 'respondida', valor_texto: codigo, valor_origen: origen } : malo;
    }
    default:
        return malo;
    }
}

async function insertRespuestas(client, filas) {
    for (let i = 0; i < filas.length; i += 2000) {
        await client.query(`INSERT INTO almacen_respuestas (registro_id, variable_id, valor_texto, valor_numero, valor_fecha, condicion, valor_origen)
            SELECT registro_id, variable_id, valor_texto, valor_numero, valor_fecha, condicion, valor_origen
            FROM jsonb_to_recordset($1::jsonb) AS x(registro_id uuid, variable_id uuid, valor_texto text, valor_numero numeric,
                valor_fecha date, condicion text, valor_origen jsonb)
            ON CONFLICT (registro_id, variable_id) DO UPDATE SET valor_texto = EXCLUDED.valor_texto,
                valor_numero = EXCLUDED.valor_numero, valor_fecha = EXCLUDED.valor_fecha,
                condicion = EXCLUDED.condicion, valor_origen = EXCLUDED.valor_origen`, [JSON.stringify(filas.slice(i, i + 2000))]);
    }
}

async function projectLevantamiento(client, levantamientoId) {
    const lev = (await client.query(`SELECT l.id, l.anio, l.encuesta_id, l.staging_project_id, l.principal_form_ref, e.clave AS encuesta
        FROM almacen_levantamientos l JOIN almacen_encuestas e ON e.id = l.encuesta_id WHERE l.id = $1`, [levantamientoId])).rows[0];
    if (!lev) throw Object.assign(new Error('El levantamiento no existe.'), { code: 'ALMACEN_LEVANTAMIENTO_NOT_FOUND' });
    const variables = (await client.query(`SELECT id, clave, tipo, seccion_id FROM almacen_variables
        WHERE encuesta_id IS NULL OR encuesta_id = $1`, [lev.encuesta_id])).rows;
    const correspondencias = new Map((await client.query(`SELECT variable_id, input_ref, opciones, formato_fecha FROM almacen_correspondencias
        WHERE levantamiento_id = $1`, [lev.id])).rows.map((row) => [row.variable_id, row]));
    const secciones = new Map((await client.query(`SELECT form_ref, seccion_id FROM almacen_levantamiento_secciones
        WHERE levantamiento_id = $1`, [lev.id])).rows.map((row) => [row.form_ref, row.seccion_id]));
    // Se lee el proyecto completo: las formas intermedias no declaradas hacen falta para encontrar
    // el ancestro de una sección más profunda.
    const filas = (await client.query(`SELECT form_ref, entry_uuid, parent_form_ref, parent_uuid, uploaded_at_epicollect, field_values
        FROM entradas_staging WHERE project_id = $1`, [lev.staging_project_id])).rows;
    const porClave = new Map(filas.map((fila) => [`${fila.form_ref}|${fila.entry_uuid}`, fila]));

    const resumen = { levantamiento: `${lev.encuesta} ${lev.anio}`, cuestionarios: 0, registros_seccion: 0,
        respuestas: 0, conservados: 0, desactualizados: 0, huerfanos: 0, condiciones: {} };
    const registroDe = new Map();
    const conservados = new Set();
    const respuestas = [];
    function responder(registroId, fila, aplicables) {
        for (const variable of aplicables) {
            const correspondencia = correspondencias.get(variable.id);
            const valor = convertValue(correspondencia ? fila.field_values?.[correspondencia.input_ref] : undefined, variable, correspondencia);
            respuestas.push({ registro_id: registroId, variable_id: variable.id, valor_texto: valor.valor_texto ?? null,
                valor_numero: valor.valor_numero ?? null, valor_fecha: valor.valor_fecha ?? null,
                condicion: valor.condicion, valor_origen: valor.valor_origen ?? null });
            resumen.condiciones[valor.condicion] = (resumen.condiciones[valor.condicion] || 0) + 1;
        }
    }

    const principales = variables.filter((v) => !v.seccion_id);
    for (const fila of filas.filter((item) => item.form_ref === lev.principal_form_ref)) {
        const actual = (await client.query(`SELECT id, estado, origen_version FROM almacen_cuestionarios
            WHERE origen_project_id = $1 AND origen_form_ref = $2 AND origen_entry_uuid = $3`,
        [lev.staging_project_id, fila.form_ref, fila.entry_uuid])).rows[0];
        if (actual && actual.estado !== 'pendiente') {
            const cambio = String(actual.origen_version) !== String(fila.uploaded_at_epicollect);
            if (cambio) {
                await client.query('UPDATE almacen_cuestionarios SET desactualizado = true WHERE id = $1', [actual.id]);
                resumen.desactualizados += 1;
            }
            resumen.conservados += 1;
            conservados.add(`${fila.form_ref}|${fila.entry_uuid}`);
            continue;
        }
        const cuestionario = (await client.query(`INSERT INTO almacen_cuestionarios (levantamiento_id, origen_project_id, origen_form_ref,
                origen_entry_uuid, origen_version) VALUES ($1,$2,$3,$4,$5)
            ON CONFLICT (origen_project_id, origen_form_ref, origen_entry_uuid) DO UPDATE
            SET origen_version = EXCLUDED.origen_version, proyectado_en = now() RETURNING id`,
        [lev.id, lev.staging_project_id, fila.form_ref, fila.entry_uuid, fila.uploaded_at_epicollect])).rows[0].id;
        const registro = (await client.query(`INSERT INTO almacen_registros (cuestionario_id, origen_form_ref, origen_entry_uuid)
            VALUES ($1,$2,$3) ON CONFLICT (cuestionario_id, origen_form_ref, origen_entry_uuid) DO UPDATE SET origen_form_ref = EXCLUDED.origen_form_ref
            RETURNING id`, [cuestionario, fila.form_ref, fila.entry_uuid])).rows[0].id;
        registroDe.set(`${fila.form_ref}|${fila.entry_uuid}`, { registro, cuestionario });
        responder(registro, fila, principales);
        resumen.cuestionarios += 1;
    }

    // Secciones: cada entrada se cuelga del ancestro más cercano que ya tenga registro. Se procesan
    // por profundidad para que el padre siempre exista antes que el hijo.
    const profundidad = (fila) => { let n = 0; let p = fila; while (p?.parent_uuid && n < 20) { p = porClave.get(`${p.parent_form_ref}|${p.parent_uuid}`); n += 1; } return n; };
    const deSeccion = filas.filter((fila) => secciones.has(fila.form_ref)).sort((a, b) => profundidad(a) - profundidad(b));
    for (const fila of deSeccion) {
        let ancestro = fila.parent_uuid ? porClave.get(`${fila.parent_form_ref}|${fila.parent_uuid}`) : null;
        let destino = null;
        let conservado = false;
        for (let n = 0; ancestro && n < 20 && !destino && !conservado; n += 1) {
            const clave = `${ancestro.form_ref}|${ancestro.entry_uuid}`;
            destino = registroDe.get(clave);
            conservado = conservados.has(clave);
            if (!destino && !conservado) ancestro = ancestro.parent_uuid ? porClave.get(`${ancestro.parent_form_ref}|${ancestro.parent_uuid}`) : null;
        }
        if (conservado) continue;
        if (!destino) { resumen.huerfanos += 1; continue; }
        const seccionId = secciones.get(fila.form_ref);
        const registro = (await client.query(`INSERT INTO almacen_registros (cuestionario_id, seccion_id, padre_id, origen_form_ref, origen_entry_uuid)
            VALUES ($1,$2,$3,$4,$5) ON CONFLICT (cuestionario_id, origen_form_ref, origen_entry_uuid)
            DO UPDATE SET padre_id = EXCLUDED.padre_id, seccion_id = EXCLUDED.seccion_id RETURNING id`,
        [destino.cuestionario, seccionId, destino.registro, fila.form_ref, fila.entry_uuid])).rows[0].id;
        registroDe.set(`${fila.form_ref}|${fila.entry_uuid}`, { registro, cuestionario: destino.cuestionario });
        responder(registro, fila, variables.filter((v) => v.seccion_id === seccionId));
        resumen.registros_seccion += 1;
    }
    await insertRespuestas(client, respuestas);
    resumen.respuestas = respuestas.length;
    return resumen;
}

module.exports = { convertValue, projectLevantamiento };
