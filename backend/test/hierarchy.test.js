const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { parseProjectHierarchy, normalizeHierarchyEntry } = require('../src/services/projectHierarchy.service');

const definition = { data: { project: { slug: 'demo', forms: [
    { ref: 'root', inputs: [{ type: 'group', group: [{ type: 'branch', ref: 'visits' }] }] },
    { ref: 'children', inputs: [{ type: 'branch', ref: 'notes' }] },
    { ref: 'grandchildren', inputs: [] },
] } } };

test('descubre formularios, ramas dentro de grupos y la cadena de padres', () => {
    const graph = parseProjectHierarchy(definition, 'demo');
    assert.deepEqual(graph.streams.map((item) => [item.form_ref, item.record_type, item.parent_form_ref]),
        [['root', 'form', null], ['visits', 'branch', 'root'], ['children', 'child', 'root'],
            ['notes', 'branch', 'children'], ['grandchildren', 'child', 'children']]);
});

test('rechaza proyectos, referencias duplicadas y estructuras de preguntas no válidas', () => {
    for (const body of [null, { data: { project: { slug: 'otro', forms: [] } } },
        { data: { project: { slug: 'demo', forms: [{ ref: '../root', inputs: [] }] } } },
        { data: { project: { slug: 'demo', forms: [{ ref: 'root', inputs: [{ type: 'branch', ref: 'root' }] }] } } },
        { data: { project: { slug: 'demo', forms: [{ ref: 'root', inputs: null }] } } }]) {
        assert.throws(() => parseProjectHierarchy(body, 'demo'), { code: 'EPICOLLECT_PROJECT_INVALID' });
    }
});

test('normaliza los tres tipos sin confundir ec5_branch_uuid con ec5_uuid', () => {
    const streams = parseProjectHierarchy(definition, 'demo').streams;
    const id = randomUUID();
    const parent = randomUUID();
    const root = normalizeHierarchyEntry({ ec5_uuid: id }, 'demo', streams[0]);
    const branch = normalizeHierarchyEntry({ ec5_branch_uuid: id, ec5_branch_owner_uuid: parent }, 'demo', streams[1]);
    const child = normalizeHierarchyEntry({ ec5_uuid: id, ec5_parent_uuid: parent }, 'demo', streams[2]);
    assert.equal(root.parent_uuid, null);
    assert.equal(branch.ec5_uuid, null);
    assert.equal(branch.entry_uuid, id);
    assert.equal(branch.parent_uuid, parent);
    assert.equal(branch.parent_form_ref, 'root');
    assert.equal(child.parent_uuid, parent);
    assert.equal(child.record_type, 'child');
});

test('rechaza padres ausentes, identificadores inválidos y fechas corruptas antes de guardar', () => {
    const streams = parseProjectHierarchy(definition, 'demo').streams;
    for (const [entry, stream] of [[null, streams[0]], [{ ec5_uuid: 'sin-uuid' }, streams[0]],
        [{ ec5_branch_uuid: randomUUID() }, streams[1]], [{ ec5_uuid: randomUUID() }, streams[2]],
        [{ ec5_uuid: randomUUID(), uploaded_at: 'sin-fecha' }, streams[0]]]) {
        assert.throws(() => normalizeHierarchyEntry(entry, 'demo', stream), { code: 'STAGING_ENTRY_INVALID' });
    }
});
