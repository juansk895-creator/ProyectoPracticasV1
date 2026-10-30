const { readFile } = require('node:fs/promises');
const { assertAllowedEpicollectBase, normalizeApiBaseUrl } = require('../config/epicollect.config');
const { fetchAllEpicollectEntries } = require('./epicollect.service');
const fail = (code) => Object.assign(new Error(code), { code });
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

function normalizeSurveyorId(value) {
    if (value === null) return null;
    if (typeof value === 'number' && !Number.isSafeInteger(value)) throw fail('AUDIT_RESPONSE_INVALID');
    if (!['string', 'number'].includes(typeof value) || !/^[0-9]{1,20}$/.test(String(value))) throw fail('AUDIT_RESPONSE_INVALID');
    return String(value).replace(/^0+(?=\d)/, '');
}

function normalizeAuditEntry(record, stream) {
    const isBranch = stream.record_type === 'branch';
    const entry = isBranch ? record?.branch_entry : record?.entry;
    const uuid = entry?.entry_uuid;
    const user = record?.relationships?.user?.data;
    const uploadedAt = entry?.uploaded_at;
    if (typeof uuid !== 'string' || !UUID.test(uuid) || typeof record.id !== 'string' || record.id.toLowerCase() !== uuid.toLowerCase() ||
        record.type !== (isBranch ? 'branch_entry' : 'entry') ||
        record.attributes?.form?.ref !== stream.native_form_ref ||
        (isBranch && record.relationships?.branch?.data?.owner_input_ref !== stream.branch_ref) ||
        !user || !Object.hasOwn(user, 'id') || typeof uploadedAt !== 'string' ||
        !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(uploadedAt) || !Number.isFinite(Date.parse(uploadedAt))) {
        throw fail('AUDIT_RESPONSE_INVALID');
    }
    return { form_ref: stream.form_ref, entry_uuid: uuid.toLowerCase(),
        surveyor_id: normalizeSurveyorId(user.id), source_uploaded_at: new Date(uploadedAt).toISOString() };
}

async function auditSource(connection) {
    if (connection.provider !== 'epicollect5') throw fail('AUDIT_SOURCE_UNAVAILABLE');
    const base = assertAllowedEpicollectBase(connection.base_url);
    if (!process.env.AUDIT_SOURCES_FILE) throw fail('AUDIT_SOURCE_UNAVAILABLE');
    let sources;
    try {
        const contents = await readFile(process.env.AUDIT_SOURCES_FILE, 'utf8');
        if (contents.length > 65536) throw new Error();
        sources = JSON.parse(contents);
        if (!Array.isArray(sources) || sources.length > 100) throw new Error();
        const keys = sources.map((s) => JSON.stringify([normalizeApiBaseUrl(s.base_url), s.project_slug]));
        if (new Set(keys).size !== keys.length) throw new Error();
    } catch { throw fail('AUDIT_CONFIG_INVALID'); }
    const source = sources.find((s) => normalizeApiBaseUrl(s.base_url) === base && s.project_slug === connection.project_slug);
    if (!source) throw fail('AUDIT_SOURCE_UNAVAILABLE');
    let token = null;
    if (source.token_env !== undefined) {
        if (typeof source.token_env !== 'string' || !/^[A-Z][A-Z0-9_]{0,100}$/.test(source.token_env)) throw fail('AUDIT_CONFIG_INVALID');
        token = process.env[source.token_env];
        if (!token || token.length > 8192 || /[\r\n]/.test(token)) throw fail('AUDIT_CONFIG_INVALID');
    }
    // El acceso de usuario a /entries es independiente del OAuth de exportación.
    return { ...connection, base_url: base, auth_type: token ? 'bearer' : 'none', auth_token: token };
}

async function downloadAudit(connection, streams) {
    const source = await auditSource(connection);
    const rows = [];
    const seen = new Set();
    for (const stream of streams) {
        const result = await fetchAllEpicollectEntries(source, { rawEntries: true,
            perPage: Math.min(connection.sync_per_page || 100, 100), maxPages: connection.sync_max_pages || 5,
            delayMs: connection.sync_delay_ms ?? 500, formRef: stream.native_form_ref, branchRef: stream.branch_ref,
            sortBy: 'uploaded_at', sortOrder: 'ASC' });
        if (result.stoppedByMaxPages) throw fail('AUDIT_PAGE_LIMIT');
        for (const raw of result.entries) {
            const row = normalizeAuditEntry(raw, stream);
            const key = JSON.stringify([row.form_ref, row.entry_uuid]);
            if (seen.has(key)) throw fail('AUDIT_RESPONSE_INVALID');
            seen.add(key); rows.push(row);
        }
    }
    return rows;
}
module.exports = { downloadAudit, auditSource, normalizeAuditEntry, normalizeSurveyorId };
