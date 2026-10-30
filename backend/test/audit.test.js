const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseAuditQuery } = require('../src/services/auditQuery.service');
const { normalizeAuditEntry, normalizeSurveyorId } = require('../src/services/auditSource.service');
const stream = { form_ref: 'main', native_form_ref: 'main', record_type: 'form' };
const id = '00000000-0000-4000-8000-000000000001';
const raw = () => ({ id, type: 'entry', attributes: { form: { ref: 'main' } },
    relationships: { user: { data: { id: 123 } } }, entry: { entry_uuid: id, uploaded_at: '2026-10-10T12:00:00Z' } });
test('identidad numérica estable, sin inferirla de las respuestas', () => {
    assert.equal(normalizeSurveyorId('000123'), '123');
    assert.equal(normalizeSurveyorId(null), null);
    for (const value of [undefined, {}, 'María', -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        assert.throws(() => normalizeSurveyorId(value), { code: 'AUDIT_RESPONSE_INVALID' });
    }
    assert.equal(normalizeAuditEntry(raw(), stream).surveyor_id, '123');
    const anonymous = raw(); anonymous.relationships.user.data.id = null;
    assert.equal(normalizeAuditEntry(anonymous, stream).surveyor_id, null);
});
test('rechaza UUID, formulario, usuario y fechas inconsistentes', () => {
    for (const mutate of [
        (r) => { r.id = 'otro'; }, (r) => { r.id = 12; },
        (r) => { r.attributes.form.ref = 'otro'; }, (r) => { delete r.relationships.user; },
        (r) => { r.entry.uploaded_at = 'sin fecha'; }, (r) => { r.entry.uploaded_at = '2026-10-10T12:00:00'; },
    ]) { const record = raw(); mutate(record); assert.throws(() => normalizeAuditEntry(record, stream), { code: 'AUDIT_RESPONSE_INVALID' }); }
});
test('una rama se vincula por su referencia y su propio UUID', () => {
    const record = raw(); record.type = 'branch_entry'; record.branch_entry = record.entry; delete record.entry;
    record.relationships.branch = { data: { owner_input_ref: 'visits' } };
    const branch = { ...stream, form_ref: 'visits', branch_ref: 'visits', record_type: 'branch' };
    assert.equal(normalizeAuditEntry(record, branch).form_ref, 'visits');
    record.relationships.branch.data.owner_input_ref = 'otra';
    assert.throws(() => normalizeAuditEntry(record, branch), { code: 'AUDIT_RESPONSE_INVALID' });
});
test('filtros tipados: fechas reales, límites, duplicados y entradas maliciosas', () => {
    assert.equal(parseAuditQuery({ surveyor_id: '00042', date_from: '2026-10-01', date_to: '2026-10-27' }).surveyor_id, '42');
    for (const query of [ { page_size: '201' }, { page: '0' }, { date_from: '2026-02-30' },
        { date_from: '2026-10-28', date_to: '2026-10-27' }, { surveyor_id: '1 OR true' },
        { date_field: 'payload; DROP TABLE' }, { surveyor_id: ['1','2'] }, { audit_status: 'inexistente' }, { unknown: 'x' } ]) {
        assert.throws(() => parseAuditQuery(query), { code: 'AUDIT_QUERY_INVALID' });
    }
});
