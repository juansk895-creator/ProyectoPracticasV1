const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseFicha, resolveLevantamiento } = require('../src/services/almacenFicha.service');
const { convertValue } = require('../src/services/almacenProjection.service');

const BASE = 'https://five.epicollect.net/api';
const nucleo = { variables: [
    { clave: 'folio', tipo: 'texto', si_falta: 'invalida' },
    { clave: 'consentimiento', tipo: 'categoria', si_falta: 'invalida', categorias: { si: 'Sí', no: 'No' } },
] };
function definicion(preguntas, extra = {}) {
    return { meta: { project_mapping: [] }, data: { project: { slug: 'demo', forms: [
        { ref: 'p_f', name: 'Principal', inputs: preguntas }, ...(extra.forms || []),
    ] } } };
}
const radio = (ref, question, answers) => ({ ref, type: 'radio', question,
    possible_answers: answers.map((answer, i) => ({ answer, answer_ref: `${ref}a${i}` })) });
const streams = [{ form_ref: 'p_f', record_type: 'form' }];
function ficha(extra = {}) {
    return { encuesta: 'mezcal', variables: [{ clave: 'litros', tipo: 'entero', si_falta: 'invalida', rango: [50, 50000] }],
        levantamientos: [{ anio: 2024, proyecto: { base_url: BASE, slug: 'demo' },
            preguntas: { folio: 'Folio', consentimiento: 'Consentimiento', litros: 'Litros al año' } }], ...extra };
}
const preguntas = [{ ref: 'p_f_1', type: 'text', question: 'Folio' }, radio('p_f_2', 'Consentimiento', ['Sí', 'No']),
    { ref: 'p_f_3', type: 'integer', question: 'Litros al año' }];

test('una ficha válida resuelve cada variable a su pregunta y traduce las opciones', () => {
    const parsed = parseFicha(nucleo, ficha());
    const r = resolveLevantamiento(parsed, parsed.levantamientos[0], { definition: definicion(preguntas), streams });
    assert.deepEqual(r.errores, []);
    assert.deepEqual(r.correspondencias.map((c) => [c.variable, c.input_ref]),
        [['folio', 'p_f_1'], ['consentimiento', 'p_f_2'], ['litros', 'p_f_3']]);
    assert.deepEqual(r.correspondencias[1].opciones, { p_f_2a0: 'si', p_f_2a1: 'no' });
});

test('los errores de la ficha se acumulan y no se carga nada', () => {
    assert.throws(() => parseFicha(nucleo, ficha({ variables: [
        { clave: 'Litros', tipo: 'entero', si_falta: 'invalida' },
        { clave: 'estado', tipo: 'texto', si_falta: 'opcional' },
        { clave: 'x', tipo: 'moneda', si_falta: 'tal_vez' },
        { clave: 'folio', tipo: 'texto', si_falta: 'opcional' },
    ] })), (error) => error.code === 'ALMACEN_FICHA_INVALID' && error.details.length >= 5);
});

test('una pregunta inexistente, un tipo incompatible o una opción sin traducir detienen la carga', () => {
    const parsed = parseFicha(nucleo, ficha());
    const lev = parsed.levantamientos[0];
    const mal = [{ ref: 'p_f_1', type: 'integer', question: 'Folio' }, radio('p_f_2', 'Consentimiento', ['Sí', 'No', 'No sabe'])];
    const r = resolveLevantamiento(parsed, lev, { definition: definicion(mal), streams });
    assert.equal(r.errores.length, 3);
    assert.match(r.errores.join('\n'), /tipo texto.*integer/);
    assert.match(r.errores.join('\n'), /«No sabe»/);
    assert.match(r.errores.join('\n'), /ninguna pregunta coincide con «Litros al año»/);
});

test('la comparación de textos ignora acentos y mayúsculas; las opciones renombradas se traducen explícitamente', () => {
    const f = ficha({ variables: [{ clave: 'agave', tipo: 'categoria', si_falta: 'invalida', categorias: { espadin: 'Espadín', otra: 'Otra' } }] });
    f.levantamientos[0].preguntas = { agave: { pregunta: 'especie de agave', opciones: { 'Espadín (A. angustifolia)': 'espadin' } } };
    const parsed = parseFicha(nucleo, f);
    const r = resolveLevantamiento(parsed, parsed.levantamientos[0],
        { definition: definicion([radio('p_f_9', 'Especie de Agave', ['Espadín (A. angustifolia)', 'OTRA'])]), streams });
    assert.deepEqual(r.errores, []);
    assert.deepEqual(r.correspondencias[0].opciones, { p_f_9a0: 'espadin', p_f_9a1: 'otra' });
    assert.equal(r.advertencias.length, 2, 'folio y consentimiento sin asignar se advierten');
});

test('las secciones se resuelven contra el formulario hijo o la pregunta de rama', () => {
    const f = ficha({ secciones: [{ clave: 'visitas' }],
        variables: [{ clave: 'minutos', tipo: 'entero', si_falta: 'opcional', seccion: 'visitas' }] });
    f.levantamientos[0].preguntas = { minutos: 'Minutos' };
    f.levantamientos[0].secciones = { visitas: 'Visita' };
    const parsed = parseFicha(nucleo, f);
    const def = definicion([], { forms: [{ ref: 'p_v', name: 'Visita', inputs: [{ ref: 'p_v_1', type: 'integer', question: 'Minutos' }] }] });
    const r = resolveLevantamiento(parsed, parsed.levantamientos[0],
        { definition: def, streams: [...streams, { form_ref: 'p_v', record_type: 'child' }] });
    assert.deepEqual(r.errores, []);
    assert.deepEqual(r.secciones, { visitas: 'p_v' });
    assert.equal(r.correspondencias[0].form_ref, 'p_v');
});

test('la conversión distingue respondida, no contestó, no se preguntó y no interpretable', () => {
    const entero = { tipo: 'entero' };
    const corr = { input_ref: 'x', opciones: null };
    assert.equal(convertValue(1200, entero, corr).valor_numero, '1200');
    assert.equal(convertValue(null, entero, corr).condicion, 'no_contesto');
    assert.equal(convertValue('', entero, corr).condicion, 'no_contesto');
    assert.equal(convertValue(12.5, entero, corr).condicion, 'no_interpretable');
    assert.equal(convertValue('mil', entero, corr).condicion, 'no_interpretable');
    assert.equal(convertValue(5, entero, null).condicion, 'no_se_pregunto');
    assert.equal(convertValue('2025-03-14T00:00:00.000', { tipo: 'fecha' }, corr).valor_fecha, '2025-03-14');
    const dmy = { input_ref: 'x', opciones: null, formato_fecha: 'dd/MM/YYYY' };
    assert.equal(convertValue('01/05/1954', { tipo: 'fecha' }, dmy).valor_fecha, '1954-05-01');
    assert.equal(convertValue('31/02/2024', { tipo: 'fecha' }, dmy).condicion, 'no_interpretable', 'fecha imposible');
    assert.equal(convertValue('05/1954', { tipo: 'fecha' }, { ...dmy, formato_fecha: 'MM/YYYY' }).condicion, 'no_interpretable', 'parcial');
    assert.equal(convertValue('05/01/1954', { tipo: 'fecha' }, { ...dmy, formato_fecha: 'MM/dd/YYYY' }).valor_fecha, '1954-05-01');
    const cat = { input_ref: 'x', opciones: { abc: 'si' } };
    assert.equal(convertValue('abc', { tipo: 'categoria' }, cat).valor_texto, 'si');
    const desconocida = convertValue('zzz', { tipo: 'categoria' }, cat);
    assert.equal(desconocida.condicion, 'no_interpretable');
    assert.equal(desconocida.valor_origen, 'zzz');
});
