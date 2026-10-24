const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { compileProjectFields, extractFieldValues, buildDeclaredColumns } = require('../src/services/projectSchema.service');
// Definición pública: https://five.epicollect.net/api/export/project/ec5-api-test
const publicDefinition = require('./fixtures/public_project_schema.json');

test('la definición pública declara preguntas sin respuestas, opciones y campos ocultos', () => {
    const { fields, mapIndex } = compileProjectFields(publicDefinition);
    assert.equal(mapIndex, 0);
    assert.equal(fields.length, 7);
    assert.equal(fields.find((field) => field.export_path[0] === '2_Age').hidden, true);
    const sex = fields.find((field) => field.type === 'choice');
    assert.deepEqual(sex.options.map((option) => option.label), ['Male', 'Female']);
    assert.equal(fields.filter((field) => field.form_label.includes('Family Members')).length, 2);
});

test('convierte las exportaciones automática y personalizada a la misma referencia estable', () => {
    const auto = compileProjectFields(publicDefinition);
    const custom = compileProjectFields(publicDefinition, 'default');
    const form = publicDefinition.data.project.forms[0].ref;
    const name = auto.fields.find((field) => field.export_path[0] === '1_Name');
    const sex = auto.fields.find((field) => field.type === 'choice');
    const original = { '1_Name': 'Ana', '2_Age': '10', '4_Sex': 'Male' };
    const before = structuredClone(original);
    const first = extractFieldValues(original, auto.fields, form);
    const second = extractFieldValues({ name: 'Ana', sex: 'M' }, custom.fields, form);
    assert.equal(first[name.input_ref], second[name.input_ref]);
    assert.equal(first[sex.input_ref], second[sex.input_ref]);
    assert.deepEqual(original, before);
});

test('renombrar una columna o pregunta conserva la clave del explorador', () => {
    const project = { id: randomUUID(), definition: structuredClone(publicDefinition) };
    const before = buildDeclaredColumns([project]);
    const form = project.definition.data.project.forms[0];
    form.inputs[0].question = 'Nombre actualizado';
    project.definition.meta.project_mapping[0].forms[form.ref][form.inputs[0].ref].map_to = 'new_name';
    const after = buildDeclaredColumns([project]);
    assert.deepEqual(before.map((column) => column.key), after.map((column) => column.key));
    assert.match(after[0].label, /Nombre actualizado/);
});

test('normaliza grupos anidados, selección múltiple y preguntas de una rama', () => {
    const definition = { meta: { project_mapping: [{ name: 'EC5_AUTO', map_index: 0, forms: { main: {
        group: { map_to: 'group_values', group: { tags: { map_to: 'options', possible_answers: {
            one: { map_to: 'A' }, two: { map_to: 'B' },
        } } } }, branch: { branch: { title: { map_to: 'branch_title' } } },
    } } }] }, data: { project: { forms: [{ ref: 'main', name: 'Encuesta', inputs: [
        { ref: 'group', type: 'group', question: 'Grupo', group: [{ ref: 'tags', type: 'checkbox', question: 'Opciones',
            possible_answers: [{ answer_ref: 'one', answer: 'Primera' }, { answer_ref: 'two', answer: 'Segunda' }] }] },
        { ref: 'branch', type: 'branch', question: 'Rama', branch: [{ ref: 'title', type: 'text', question: 'Título' }] },
    ] }] } } };
    const { fields } = compileProjectFields(definition);
    assert.deepEqual([...extractFieldValues({ group_values: { options: ['A', 'B'] } }, fields, 'main').tags], ['one', 'two']);
    assert.deepEqual([...extractFieldValues({ options: 'A, B' }, fields, 'main').tags], ['one', 'two']);
    assert.equal(extractFieldValues({ branch_title: 'Visita' }, fields, 'branch').title, 'Visita');
    assert.match(fields.find((field) => field.input_ref === 'tags').label, /Grupo › Opciones/);
});

test('conserva números grandes y valores desconocidos sin reinterpretarlos', () => {
    const { fields } = compileProjectFields(publicDefinition);
    const form = publicDefinition.data.project.forms[0].ref;
    const age = fields.find((field) => field.export_path[0] === '2_Age');
    const sex = fields.find((field) => field.type === 'choice');
    const values = extractFieldValues({ '2_Age': '9007199254740993', '4_Sex': 'Valor histórico' }, fields, form);
    assert.equal(values[age.input_ref], '9007199254740993');
    assert.equal(values[sex.input_ref], 'Valor histórico');
});

test('rechaza definiciones ambiguas sin guardar una asociación incorrecta', () => {
    const definition = structuredClone(publicDefinition);
    const form = definition.data.project.forms[0];
    form.inputs.push(structuredClone(form.inputs[0]));
    assert.throws(() => compileProjectFields(definition), { code: 'EPICOLLECT_SCHEMA_INVALID' });
    assert.throws(() => compileProjectFields({ data: { project: {} } }), { code: 'EPICOLLECT_SCHEMA_INVALID' });
    const missing = structuredClone(publicDefinition);
    delete missing.meta.project_mapping[0].forms[form.ref][form.inputs[0].ref];
    assert.throws(() => compileProjectFields(missing), { code: 'EPICOLLECT_SCHEMA_INVALID' });
    const duplicate = structuredClone(publicDefinition);
    duplicate.meta.project_mapping[0].forms[form.ref][form.inputs[1].ref].map_to = '1_Name';
    assert.throws(() => compileProjectFields(duplicate), { code: 'EPICOLLECT_SCHEMA_INVALID' });
});
