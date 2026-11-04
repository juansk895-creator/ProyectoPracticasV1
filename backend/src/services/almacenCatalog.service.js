const { parseFicha, resolveLevantamiento, fichaError } = require('./almacenFicha.service');
const { regenerateViews } = require('./almacenViews.service');

// Carga de la ficha en el catálogo. planFicha sólo lee (staging y catálogo) y devuelve el plan con
// todos los problemas; applyFicha escribe el plan. El script ejecuta ambos en una transacción y,
// sin --apply, la revierte: la vista previa es exactamente lo que se aplicaría.

async function loadStagingProject(client, baseUrl, slug) {
    const project = (await client.query('SELECT id, definition FROM staging_projects WHERE base_url = $1 AND project_slug = $2',
        [baseUrl, slug])).rows[0];
    if (!project) return null;
    const streams = (await client.query('SELECT form_ref, record_type, parent_form_ref FROM staging_streams WHERE project_id = $1',
        [project.id])).rows;
    return { ...project, streams };
}

async function planFicha(client, nucleo, ficha) {
    const parsed = parseFicha(nucleo, ficha);
    const errores = [];
    const advertencias = [];
    const levantamientos = [];
    for (const levantamiento of parsed.levantamientos) {
        const project = await loadStagingProject(client, levantamiento.base_url, levantamiento.slug);
        if (!project) {
            errores.push(`levantamiento ${levantamiento.anio}: el proyecto ${levantamiento.slug} de ${levantamiento.base_url} ` +
                'no está en staging. Sincronízalo antes de cargar la ficha.');
            continue;
        }
        const resolved = resolveLevantamiento(parsed, levantamiento, project);
        errores.push(...resolved.errores);
        advertencias.push(...resolved.advertencias);
        levantamientos.push({ ...levantamiento, staging_project_id: project.id, ...resolved });
    }
    if (errores.length) throw fichaError('ALMACEN_FICHA_INVALID', 'La ficha tiene errores; no se cargó nada.', errores);
    return { ...parsed, levantamientos, advertencias };
}

async function upsertVariable(client, variable, encuestaId, seccionId, orden) {
    const params = [encuestaId, seccionId, variable.clave, variable.etiqueta, variable.tipo, variable.si_falta,
        variable.categorias && JSON.stringify(variable.categorias), variable.rango_min, variable.rango_max, orden];
    const actual = (await client.query(`SELECT id, tipo FROM almacen_variables
        WHERE clave = $1 AND encuesta_id IS NOT DISTINCT FROM $2`, [variable.clave, encuestaId])).rows[0];
    if (actual && actual.tipo !== variable.tipo) {
        const usada = await client.query('SELECT 1 FROM almacen_respuestas WHERE variable_id = $1 LIMIT 1', [actual.id]);
        if (usada.rowCount) throw fichaError('ALMACEN_FICHA_CONFLICT', `La variable ${variable.clave} ya tiene datos como ${actual.tipo}; no puede cambiar a ${variable.tipo}.`);
    }
    if (actual) {
        await client.query(`UPDATE almacen_variables SET seccion_id = $1, etiqueta = $2, tipo = $3, si_falta = $4,
            categorias = $5::jsonb, rango_min = $6, rango_max = $7, orden = $8 WHERE id = $9`,
        [seccionId, variable.etiqueta, variable.tipo, variable.si_falta, variable.categorias && JSON.stringify(variable.categorias),
            variable.rango_min, variable.rango_max, orden, actual.id]);
        return actual.id;
    }
    return (await client.query(`INSERT INTO almacen_variables (encuesta_id, seccion_id, clave, etiqueta, tipo, si_falta,
        categorias, rango_min, rango_max, orden) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10) RETURNING id`, params)).rows[0].id;
}

async function applyFicha(client, plan) {
    // Núcleo común: se actualiza o se agrega; nunca se borra desde la ficha de una encuesta.
    const ids = new Map();
    for (const [orden, variable] of plan.nucleo.entries()) ids.set(variable.clave, await upsertVariable(client, variable, null, null, orden));

    const encuestaId = (await client.query(`INSERT INTO almacen_encuestas (clave, nombre) VALUES ($1, $2)
        ON CONFLICT (clave) DO UPDATE SET nombre = EXCLUDED.nombre, actualizada_en = now() RETURNING id`,
    [plan.encuesta.clave, plan.encuesta.nombre])).rows[0].id;

    const seccionIds = new Map();
    for (const seccion of plan.secciones) {
        seccionIds.set(seccion.clave, (await client.query(`INSERT INTO almacen_secciones (encuesta_id, clave, etiqueta) VALUES ($1,$2,$3)
            ON CONFLICT (encuesta_id, clave) DO UPDATE SET etiqueta = EXCLUDED.etiqueta RETURNING id`,
        [encuestaId, seccion.clave, seccion.etiqueta])).rows[0].id);
    }
    for (const [orden, variable] of plan.variables.entries()) {
        ids.set(variable.clave, await upsertVariable(client, variable, encuestaId, seccionIds.get(variable.seccion) || null, orden));
    }

    // Lo que ya no está en la ficha se retira sólo si no tiene datos; si los tiene, se detiene todo.
    const sobrantes = await client.query(`DELETE FROM almacen_variables v WHERE v.encuesta_id = $1 AND NOT (v.clave = ANY($2::text[]))
        AND NOT EXISTS (SELECT 1 FROM almacen_respuestas r WHERE r.variable_id = v.id) RETURNING clave`,
    [encuestaId, plan.variables.map((v) => v.clave)]);
    const conDatos = await client.query('SELECT clave FROM almacen_variables WHERE encuesta_id = $1 AND NOT (clave = ANY($2::text[]))',
        [encuestaId, plan.variables.map((v) => v.clave)]);
    if (conDatos.rowCount) {
        throw fichaError('ALMACEN_FICHA_CONFLICT', 'La ficha quita variables que ya tienen datos en el almacén.', conDatos.rows.map((r) => r.clave));
    }
    await client.query('DELETE FROM almacen_secciones WHERE encuesta_id = $1 AND NOT (clave = ANY($2::text[]))',
        [encuestaId, plan.secciones.map((s) => s.clave)]);

    const levantamientos = [];
    for (const lev of plan.levantamientos) {
        const actual = (await client.query('SELECT id, staging_project_id FROM almacen_levantamientos WHERE encuesta_id = $1 AND anio = $2',
            [encuestaId, lev.anio])).rows[0];
        if (actual && actual.staging_project_id !== lev.staging_project_id) {
            const usado = await client.query('SELECT 1 FROM almacen_cuestionarios WHERE levantamiento_id = $1 LIMIT 1', [actual.id]);
            if (usado.rowCount) throw fichaError('ALMACEN_FICHA_CONFLICT', `El levantamiento ${lev.anio} ya tiene datos de otro proyecto.`);
        }
        const id = (await client.query(`INSERT INTO almacen_levantamientos (encuesta_id, anio, staging_project_id, principal_form_ref)
            VALUES ($1,$2,$3,$4) ON CONFLICT (encuesta_id, anio) DO UPDATE
            SET staging_project_id = EXCLUDED.staging_project_id, principal_form_ref = EXCLUDED.principal_form_ref RETURNING id`,
        [encuestaId, lev.anio, lev.staging_project_id, lev.principal_form_ref])).rows[0].id;
        await client.query('DELETE FROM almacen_levantamiento_secciones WHERE levantamiento_id = $1', [id]);
        for (const [clave, formRef] of Object.entries(lev.secciones)) {
            await client.query(`INSERT INTO almacen_levantamiento_secciones (levantamiento_id, seccion_id, staging_project_id, form_ref)
                VALUES ($1,$2,$3,$4)`, [id, seccionIds.get(clave), lev.staging_project_id, formRef]);
        }
        await client.query('DELETE FROM almacen_correspondencias WHERE levantamiento_id = $1', [id]);
        for (const item of lev.correspondencias) {
            await client.query(`INSERT INTO almacen_correspondencias (levantamiento_id, variable_id, form_ref, input_ref, opciones, formato_fecha)
                VALUES ($1,$2,$3,$4,$5::jsonb,$6)`, [id, ids.get(item.variable), item.form_ref, item.input_ref,
                item.opciones && JSON.stringify(item.opciones), item.formato_fecha]);
        }
        levantamientos.push({ anio: lev.anio, id, correspondencias: lev.correspondencias.length });
    }
    const retirados = await client.query(`DELETE FROM almacen_levantamientos l WHERE l.encuesta_id = $1 AND NOT (l.anio = ANY($2::int[]))
        AND NOT EXISTS (SELECT 1 FROM almacen_cuestionarios c WHERE c.levantamiento_id = l.id) RETURNING anio`,
    [encuestaId, plan.levantamientos.map((l) => l.anio)]);

    await client.query('DELETE FROM almacen_reglas WHERE encuesta_id = $1', [encuestaId]);
    for (const regla of plan.reglas) {
        await client.query('INSERT INTO almacen_reglas (encuesta_id, clave, efecto, definicion) VALUES ($1,$2,$3,$4::jsonb)',
            [encuestaId, regla.clave, regla.efecto, JSON.stringify(regla.definicion)]);
    }
    const vistas = await regenerateViews(client);
    return { encuesta: plan.encuesta.clave, variables_nucleo: plan.nucleo.length, variables_encuesta: plan.variables.length,
        variables_retiradas: sobrantes.rows.map((r) => r.clave), levantamientos, levantamientos_retirados: retirados.rows.map((r) => r.anio),
        reglas: plan.reglas.length, vistas, advertencias: plan.advertencias };
}

module.exports = { planFicha, applyFicha, loadStagingProject };
