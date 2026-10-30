const error = () => Object.assign(new Error('Revisa los filtros de auditoría.'), { code: 'AUDIT_QUERY_INVALID' });
const STATUSES = new Set(['pending', 'stale', 'anonymous', 'identified']);
function parseAuditQuery(query) {
    const permitted = new Set(['surveyor_id', 'date_from', 'date_to', 'date_field', 'validation_status', 'audit_status', 'page', 'page_size']);
    if (Object.keys(query).some((key) => !permitted.has(key)) ||
        Object.values(query).some((value) => typeof value !== 'string')) throw error();
    const result = { page: 1, page_size: 50, date_field: 'created_at_epicollect' };
    for (const key of ['page', 'page_size']) {
        if (query[key] !== undefined) {
            if (!/^[1-9]\d{0,7}$/.test(query[key])) throw error();
            result[key] = Number(query[key]);
        }
    }
    if (result.page_size > 200) throw error();
    if (query.date_field !== undefined) {
        if (!['created_at_epicollect', 'uploaded_at_epicollect'].includes(query.date_field)) throw error();
        result.date_field = query.date_field;
    }
    for (const key of ['date_from', 'date_to']) {
        if (query[key] !== undefined) {
            if (!/^\d{4}-\d\d-\d\d$/.test(query[key]) || Number(query[key].slice(0, 4)) < 1 || Number(query[key].slice(0, 4)) > 9998 || !Number.isFinite(Date.parse(query[key])) ||
                new Date(query[key]).toISOString().slice(0, 10) !== query[key]) throw error();
            result[key] = query[key];
        }
    }
    if (result.date_from && result.date_to && result.date_from > result.date_to) throw error();
    if (query.surveyor_id !== undefined) {
        if (!/^[0-9]{1,20}$/.test(query.surveyor_id)) throw error();
        result.surveyor_id = query.surveyor_id.replace(/^0+(?=\d)/, '');
    }
    if (query.validation_status !== undefined) {
        if (!/^[A-Za-z0-9_-]{1,30}$/.test(query.validation_status)) throw error();
        result.validation_status = query.validation_status;
    }
    if (query.audit_status !== undefined) {
        if (!STATUSES.has(query.audit_status)) throw error();
        result.audit_status = query.audit_status;
    }
    return result;
}
function auditWhere(projectId, formRef, query) {
    const values = [projectId];
    const clauses = ['project_id = $1'];
    const add = (expression, value) => { values.push(value); clauses.push(expression.replace('?', `$${values.length}`)); };
    if (formRef) add('form_ref = ?', formRef);
    for (const key of ['surveyor_id', 'audit_status', 'validation_status']) {
        if (query[key] !== undefined) add(`${key} = ?`, query[key]);
    }
    if (query.date_from) add(`${query.date_field} >= ?::timestamptz`, `${query.date_from}T00:00:00Z`);
    if (query.date_to) {
        const end = new Date(`${query.date_to}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 1);
        add(`${query.date_field} < ?::timestamptz`, end.toISOString());
    }
    return { sql: clauses.join(' AND '), values };
}
module.exports = { parseAuditQuery, auditWhere };
