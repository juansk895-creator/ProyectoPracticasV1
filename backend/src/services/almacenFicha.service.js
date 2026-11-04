const { compileProjectFields } = require('./projectSchema.service');
const { normalizeApiBaseUrl } = require('../config/epicollect.config');

// Ficha de correspondencia: declara qué variables del almacén salen de qué preguntas de cada
// levantamiento. Se valida completa antes de escribir nada; los errores se acumulan para que
// quien mantiene la ficha los vea todos de una vez.

const CLAVE = /^[a-z][a-z0-9_]{0,47}$/;
const CLAVE_CORTA = /^[a-z][a-z0-9_]{0,39}$/;
const CODIGO = /^[a-z0-9][a-z0-9_]{0,39}$/;
const SLUG = /^[A-Za-z0-9_-]{1,150}$/;
const REF = /^[A-Za-z0-9_-]{1,150}$/;
const TIPOS = new Set(['texto', 'entero', 'decimal', 'fecha', 'categoria']);
const SI_FALTA = new Set(['invalida', 'recuperable', 'opcional']);
const EFECTOS = new Set(['rechaza', 'observa']);
// Columnas fijas de las vistas anchas; ninguna variable puede llamarse así.
const RESERVADAS = new Set(['cuestionario_id', 'registro_id', 'padre_id', 'encuesta', 'anio', 'estado',
    'origen_uuid', 'desactualizado', 'seccion']);
// Tipo de la pregunta en Epicollect5 (según compileProjectFields) que admite cada tipo de variable.
const COMPATIBLE = { texto: 'text', entero: 'number', decimal: 'number', fecha: 'date', categoria: 'choice' };

function fichaError(code, message, details = []) {
    return Object.assign(new Error(message), { code, details });
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const texto = (value) => typeof value === 'string' && value.trim().length > 0;
// Comparación de etiquetas: sin distinguir mayúsculas, acentos ni espacios repetidos.
function normalizar(value) {
    return String(value).normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function parseVariable(spec, donde, errores, secciones) {
    if (!isObject(spec)) { errores.push(`${donde}: cada variable debe ser un objeto.`); return null; }
    const { clave, tipo, si_falta: siFalta } = spec;
    const etiqueta = texto(spec.etiqueta) ? spec.etiqueta.trim() : clave;
    const nombre = `${donde} › ${typeof clave === 'string' ? clave : '?'}`;
    if (typeof clave !== 'string' || !CLAVE.test(clave)) {
        errores.push(`${nombre}: la clave debe empezar con letra y usar sólo minúsculas, números y guion bajo (máximo 48).`);
    } else if (RESERVADAS.has(clave)) errores.push(`${nombre}: «${clave}» está reservada para las vistas.`);
    if (!TIPOS.has(tipo)) errores.push(`${nombre}: el tipo debe ser uno de ${[...TIPOS].join(', ')}.`);
    if (!SI_FALTA.has(siFalta)) errores.push(`${nombre}: si_falta debe ser invalida, recuperable u opcional.`);
    let categorias = null;
    if (tipo === 'categoria') {
        if (!isObject(spec.categorias) || !Object.keys(spec.categorias).length) {
            errores.push(`${nombre}: una variable de categoría necesita su lista de categorías.`);
        } else {
            categorias = {};
            const etiquetas = new Set();
            for (const [codigo, label] of Object.entries(spec.categorias)) {
                if (!CODIGO.test(codigo)) errores.push(`${nombre}: el código «${codigo}» no es válido.`);
                if (!texto(label)) errores.push(`${nombre}: el código «${codigo}» necesita una etiqueta.`);
                else if (etiquetas.has(normalizar(label))) errores.push(`${nombre}: la etiqueta «${label}» está repetida.`);
                else etiquetas.add(normalizar(label));
                categorias[codigo] = texto(label) ? label.trim() : '';
            }
        }
    } else if (spec.categorias !== undefined) errores.push(`${nombre}: sólo las variables de categoría llevan categorías.`);
    let rango = [null, null];
    if (spec.rango !== undefined) {
        const valido = Array.isArray(spec.rango) && spec.rango.length === 2 &&
            spec.rango.every((n) => n === null || Number.isFinite(n)) &&
            (spec.rango[0] === null || spec.rango[1] === null || spec.rango[0] <= spec.rango[1]);
        if (!['entero', 'decimal'].includes(tipo)) errores.push(`${nombre}: sólo las variables numéricas llevan rango.`);
        else if (!valido) errores.push(`${nombre}: el rango debe ser [mínimo, máximo], con null para no acotar.`);
        else rango = spec.rango;
    }
    let seccion = null;
    if (spec.seccion !== undefined) {
        if (!secciones) errores.push(`${nombre}: las variables del núcleo común no pueden pertenecer a una sección.`);
        else if (!secciones.has(spec.seccion)) errores.push(`${nombre}: la sección «${spec.seccion}» no está declarada.`);
        else seccion = spec.seccion;
    }
    return { clave, etiqueta, tipo, si_falta: siFalta, categorias, rango_min: rango[0], rango_max: rango[1], seccion };
}

function parseFicha(nucleo, ficha) {
    const errores = [];
    if (!isObject(nucleo) || !Array.isArray(nucleo.variables)) {
        throw fichaError('ALMACEN_FICHA_INVALID', 'El archivo del núcleo común debe tener una lista «variables».');
    }
    if (!isObject(ficha)) throw fichaError('ALMACEN_FICHA_INVALID', 'La ficha debe ser un objeto JSON.');

    const variablesNucleo = nucleo.variables.map((spec, i) => parseVariable(spec, `núcleo[${i}]`, errores, null));
    if (typeof ficha.encuesta !== 'string' || !CLAVE_CORTA.test(ficha.encuesta)) {
        errores.push('encuesta: la clave debe empezar con letra y usar sólo minúsculas, números y guion bajo (máximo 40).');
    }
    const nombre = texto(ficha.nombre) ? ficha.nombre.trim() : ficha.encuesta;
    const secciones = [];
    const clavesSeccion = new Set();
    for (const [i, spec] of (Array.isArray(ficha.secciones) ? ficha.secciones : []).entries()) {
        if (!isObject(spec) || typeof spec.clave !== 'string' || !CLAVE_CORTA.test(spec.clave)) {
            errores.push(`secciones[${i}]: la sección necesita una clave válida.`); continue;
        }
        if (clavesSeccion.has(spec.clave)) errores.push(`secciones › ${spec.clave}: está repetida.`);
        clavesSeccion.add(spec.clave);
        secciones.push({ clave: spec.clave, etiqueta: texto(spec.etiqueta) ? spec.etiqueta.trim() : spec.clave });
    }
    if (ficha.secciones !== undefined && !Array.isArray(ficha.secciones)) errores.push('secciones: debe ser una lista.');
    if (!Array.isArray(ficha.variables) || !ficha.variables.length) errores.push('variables: la encuesta necesita al menos una variable propia.');
    const variablesEncuesta = (Array.isArray(ficha.variables) ? ficha.variables : [])
        .map((spec, i) => parseVariable(spec, `variables[${i}]`, errores, clavesSeccion));

    const todas = [...variablesNucleo.map((v) => v && { ...v, nucleo: true }),
        ...variablesEncuesta.map((v) => v && { ...v, nucleo: false })].filter(Boolean);
    const vistas = new Set();
    for (const variable of todas) {
        if (typeof variable.clave !== 'string') continue;
        if (vistas.has(variable.clave)) errores.push(`variable ${variable.clave}: la clave se repite entre el núcleo y la encuesta.`);
        vistas.add(variable.clave);
    }
    for (const seccion of secciones) {
        if (!variablesEncuesta.some((v) => v?.seccion === seccion.clave)) errores.push(`secciones › ${seccion.clave}: no tiene variables.`);
    }

    const levantamientos = [];
    const anios = new Set();
    if (!Array.isArray(ficha.levantamientos) || !ficha.levantamientos.length) {
        errores.push('levantamientos: la ficha necesita al menos un levantamiento.');
    }
    for (const [i, spec] of (Array.isArray(ficha.levantamientos) ? ficha.levantamientos : []).entries()) {
        const donde = `levantamientos[${i}]`;
        if (!isObject(spec)) { errores.push(`${donde}: debe ser un objeto.`); continue; }
        if (!Number.isInteger(spec.anio) || spec.anio < 1990 || spec.anio > 2200) errores.push(`${donde}: el año no es válido.`);
        else if (anios.has(spec.anio)) errores.push(`${donde}: el año ${spec.anio} está repetido.`);
        anios.add(spec.anio);
        let baseUrl = null;
        try { baseUrl = normalizeApiBaseUrl(spec.proyecto?.base_url); } catch { errores.push(`${donde}: proyecto.base_url debe ser una URL HTTPS válida.`); }
        if (typeof spec.proyecto?.slug !== 'string' || !SLUG.test(spec.proyecto.slug)) errores.push(`${donde}: proyecto.slug no es válido.`);
        const seccionesLev = {};
        for (const [clave, fuente] of Object.entries(isObject(spec.secciones) ? spec.secciones : {})) {
            if (!clavesSeccion.has(clave)) errores.push(`${donde} › secciones › ${clave}: la sección no está declarada.`);
            else if (!texto(fuente)) errores.push(`${donde} › secciones › ${clave}: indica el formulario hijo o la pregunta de rama.`);
            else seccionesLev[clave] = fuente.trim();
        }
        const preguntas = {};
        if (!isObject(spec.preguntas)) errores.push(`${donde}: «preguntas» debe asignar cada variable a una pregunta.`);
        for (const [clave, fuente] of Object.entries(isObject(spec.preguntas) ? spec.preguntas : {})) {
            const variable = todas.find((v) => v.clave === clave);
            if (!variable) { errores.push(`${donde} › ${clave}: la variable no está declarada.`); continue; }
            const pregunta = typeof fuente === 'string' ? { pregunta: fuente } : fuente;
            if (!isObject(pregunta) || (pregunta.ref === undefined) === (pregunta.pregunta === undefined)) {
                errores.push(`${donde} › ${clave}: indica la pregunta por su texto o con {"ref": …}, no ambas.`); continue;
            }
            if (pregunta.ref !== undefined && (typeof pregunta.ref !== 'string' || !REF.test(pregunta.ref))) {
                errores.push(`${donde} › ${clave}: la referencia no es válida.`); continue;
            }
            if (pregunta.pregunta !== undefined && !texto(pregunta.pregunta)) {
                errores.push(`${donde} › ${clave}: el texto de la pregunta está vacío.`); continue;
            }
            if (pregunta.opciones !== undefined) {
                if (variable.tipo !== 'categoria' || !isObject(pregunta.opciones)) {
                    errores.push(`${donde} › ${clave}: «opciones» sólo aplica a variables de categoría y debe ser un objeto.`); continue;
                }
                const malas = Object.values(pregunta.opciones).filter((codigo) => !variable.categorias || !Object.hasOwn(variable.categorias, codigo));
                if (malas.length) { errores.push(`${donde} › ${clave}: códigos inexistentes en «opciones»: ${malas.join(', ')}.`); continue; }
            }
            preguntas[clave] = pregunta;
        }
        levantamientos.push({ anio: spec.anio, base_url: baseUrl, slug: spec.proyecto?.slug, secciones: seccionesLev, preguntas });
    }

    const reglas = [];
    for (const [i, spec] of (Array.isArray(ficha.reglas) ? ficha.reglas : []).entries()) {
        if (!isObject(spec) || typeof spec.clave !== 'string' || !/^[a-z][a-z0-9_]{0,59}$/.test(spec.clave) || !EFECTOS.has(spec.efecto)) {
            errores.push(`reglas[${i}]: cada regla necesita una clave válida y un efecto (rechaza u observa).`); continue;
        }
        reglas.push({ clave: spec.clave, efecto: spec.efecto, definicion: spec });
    }

    if (errores.length) throw fichaError('ALMACEN_FICHA_INVALID', 'La ficha tiene errores; no se cargó nada.', errores);
    return { encuesta: { clave: ficha.encuesta, nombre }, secciones,
        nucleo: variablesNucleo, variables: variablesEncuesta, levantamientos, reglas };
}

// Formularios hijos (por nombre) y preguntas de rama (por texto) de la definición del proyecto.
function fuentesDeSeccion(definition) {
    const fuentes = [];
    const forms = definition?.data?.project?.forms || [];
    forms.forEach((form, index) => {
        if (index > 0) fuentes.push({ tipo: 'formulario hijo', nombre: form.name || form.ref, form_ref: form.ref });
        (function ramas(inputs) {
            for (const input of inputs || []) {
                if (input?.type === 'branch') fuentes.push({ tipo: 'rama', nombre: input.question || input.ref, form_ref: input.ref });
                if (input?.type === 'group') ramas(input.group);
            }
        })(form.inputs);
    });
    return fuentes;
}

// Resuelve un levantamiento contra la definición de su proyecto en staging. Es puro: recibe la
// definición y los streams ya leídos, y devuelve las correspondencias o la lista de problemas.
function resolveLevantamiento(parsed, levantamiento, { definition, streams }) {
    const errores = [];
    const advertencias = [];
    const donde = `levantamiento ${levantamiento.anio}`;
    const principal = streams.find((stream) => stream.record_type === 'form');
    if (!principal) return { errores: [`${donde}: el proyecto no tiene formulario principal en staging.`], advertencias };
    let fields;
    try { ({ fields } = compileProjectFields(definition)); } catch {
        return { errores: [`${donde}: la definición del proyecto en staging no se pudo interpretar.`], advertencias };
    }
    const seccionForm = {};
    const fuentes = fuentesDeSeccion(definition);
    for (const [clave, fuente] of Object.entries(levantamiento.secciones)) {
        const candidatas = fuentes.filter((item) => normalizar(item.nombre) === normalizar(fuente));
        if (candidatas.length !== 1) {
            errores.push(`${donde} › secciones › ${clave}: ${candidatas.length ? 'hay varias' : 'no hay ninguna'} fuente llamada «${fuente}». ` +
                `Disponibles: ${fuentes.map((item) => `«${item.nombre}» (${item.tipo})`).join(', ') || 'ninguna'}.`);
            continue;
        }
        if (!streams.some((stream) => stream.form_ref === candidatas[0].form_ref)) {
            errores.push(`${donde} › secciones › ${clave}: «${fuente}» no está sincronizada en staging.`); continue;
        }
        seccionForm[clave] = candidatas[0].form_ref;
    }

    const correspondencias = [];
    const usadas = new Map();
    const variables = [...parsed.nucleo, ...parsed.variables];
    for (const variable of variables) {
        const pregunta = levantamiento.preguntas[variable.clave];
        if (!pregunta) {
            if (variable.si_falta === 'invalida') {
                advertencias.push(`${donde} › ${variable.clave}: no se asignó; como «no se preguntó» no invalidará, pero revísalo.`);
            }
            continue;
        }
        const formRef = variable.seccion ? seccionForm[variable.seccion] : principal.form_ref;
        if (!formRef) {
            if (!Object.hasOwn(levantamiento.secciones, variable.seccion)) {
                errores.push(`${donde} › ${variable.clave}: pertenece a la sección «${variable.seccion}», que no está asignada en este levantamiento.`);
            }
            continue;
        }
        const disponibles = fields.filter((field) => field.form_ref === formRef);
        let field;
        if (pregunta.ref) {
            field = disponibles.find((item) => item.input_ref === pregunta.ref);
            if (!field) { errores.push(`${donde} › ${variable.clave}: no existe la pregunta con referencia ${pregunta.ref} en ese formulario.`); continue; }
        } else {
            const buscado = normalizar(pregunta.pregunta);
            let candidatas = disponibles.filter((item) => normalizar(item.label) === buscado);
            if (!candidatas.length) candidatas = disponibles.filter((item) => normalizar(item.label.split(' › ').at(-1)) === buscado);
            if (candidatas.length !== 1) {
                errores.push(`${donde} › ${variable.clave}: ${candidatas.length ? 'varias preguntas coinciden' : 'ninguna pregunta coincide'} con «${pregunta.pregunta}».` +
                    (candidatas.length ? ' Usa {"ref": …} para elegir una.' : ''));
                continue;
            }
            [field] = candidatas;
        }
        if (COMPATIBLE[variable.tipo] !== field.type) {
            errores.push(`${donde} › ${variable.clave}: la variable es de tipo ${variable.tipo} y la pregunta «${field.label}» es de tipo ${field.input_type}.`);
            continue;
        }
        if (usadas.has(field.input_ref)) {
            errores.push(`${donde} › ${variable.clave}: la pregunta «${field.label}» ya está asignada a ${usadas.get(field.input_ref)}.`); continue;
        }
        usadas.set(field.input_ref, variable.clave);
        let opciones = null;
        if (variable.tipo === 'categoria') {
            opciones = {};
            const explicitas = pregunta.opciones || {};
            const etiquetas = new Map(Object.entries(variable.categorias).map(([codigo, label]) => [normalizar(label), codigo]));
            const sinTraduccion = [];
            for (const option of field.options) {
                const explicita = Object.entries(explicitas).find(([label]) => normalizar(label) === normalizar(option.label));
                const codigo = explicita ? explicita[1] : etiquetas.get(normalizar(option.label));
                if (codigo) opciones[option.value] = codigo; else sinTraduccion.push(`«${option.label}»`);
            }
            const sobrantes = Object.keys(explicitas).filter((label) => !field.options.some((o) => normalizar(o.label) === normalizar(label)));
            if (sinTraduccion.length) errores.push(`${donde} › ${variable.clave}: estas respuestas no tienen categoría: ${sinTraduccion.join(', ')}.`);
            if (sobrantes.length) errores.push(`${donde} › ${variable.clave}: «opciones» menciona respuestas que la pregunta no tiene: ${sobrantes.join(', ')}.`);
            if (sinTraduccion.length || sobrantes.length) continue;
        }
        correspondencias.push({ variable: variable.clave, form_ref: formRef, input_ref: field.input_ref, opciones,
            formato_fecha: variable.tipo === 'fecha' ? field.datetime_format || null : null });
    }
    return { principal_form_ref: principal.form_ref, secciones: seccionForm, correspondencias, errores, advertencias };
}

module.exports = { parseFicha, resolveLevantamiento, fuentesDeSeccion, fichaError, normalizar, RESERVADAS };
