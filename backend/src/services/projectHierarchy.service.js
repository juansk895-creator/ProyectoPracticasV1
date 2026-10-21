const REF = /^[A-Za-z0-9_-]{1,150}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

function hierarchyError(code, message) {
    return Object.assign(new Error(message), { code });
}

function validRef(value) { return typeof value === 'string' && REF.test(value); }

function parseProjectHierarchy(body, projectSlug) {
    const project = body?.data?.project;
    if (!project || project.slug !== projectSlug || !Array.isArray(project.forms) ||
        project.forms.length === 0 || project.forms.length > 100) {
        throw hierarchyError('EPICOLLECT_PROJECT_INVALID', 'La definición del proyecto no es válida.');
    }
    const streams = [];
    const seen = new Set();
    function add(stream) {
        if (!validRef(stream.form_ref) || seen.has(stream.form_ref) || streams.length >= 500) {
            throw hierarchyError('EPICOLLECT_PROJECT_INVALID', 'La definición del proyecto contiene referencias no válidas.');
        }
        seen.add(stream.form_ref);
        streams.push(stream);
    }
    function branches(inputs, ownerRef, depth = 0) {
        if (!Array.isArray(inputs) || depth > 10 || inputs.length > 1000) {
            throw hierarchyError('EPICOLLECT_PROJECT_INVALID', 'La estructura de preguntas no es válida.');
        }
        for (const input of inputs) {
            if (!input || typeof input !== 'object') throw hierarchyError('EPICOLLECT_PROJECT_INVALID', 'Pregunta no válida.');
            if (input.type === 'branch') add({ form_ref: input.ref, native_form_ref: ownerRef,
                record_type: 'branch', parent_form_ref: ownerRef, branch_ref: input.ref });
            if (Array.isArray(input.group) && input.group.length) branches(input.group, ownerRef, depth + 1);
        }
    }
    project.forms.forEach((form, index) => {
        if (!form || !validRef(form.ref)) throw hierarchyError('EPICOLLECT_PROJECT_INVALID', 'Formulario no válido.');
        add({ form_ref: form.ref, native_form_ref: form.ref,
            record_type: index === 0 ? 'form' : 'child',
            parent_form_ref: index === 0 ? null : project.forms[index - 1].ref, branch_ref: null });
        branches(form.inputs, form.ref);
    });
    return { project_slug: projectSlug, streams, definition: body };
}

function normalizeHierarchyEntry(entry, projectSlug, stream) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw hierarchyError('STAGING_ENTRY_INVALID', 'La descarga contiene un registro no válido.');
    }
    const uuid = stream.record_type === 'branch'
        ? entry.ec5_branch_uuid : (entry.ec5_uuid || entry.entry_uuid || entry.uuid || entry.id);
    const parent = stream.record_type === 'branch' ? entry.ec5_branch_owner_uuid
        : stream.record_type === 'child' ? entry.ec5_parent_uuid : null;
    if (typeof uuid !== 'string' || !UUID.test(uuid) ||
        (stream.record_type !== 'form' && (typeof parent !== 'string' || !UUID.test(parent)))) {
        throw hierarchyError('STAGING_ENTRY_INVALID', 'Falta un identificador válido del registro o de su padre.');
    }
    const date = (value) => {
        if (!value) return null;
        const parsed = new Date(value);
        if (!Number.isFinite(parsed.getTime())) throw hierarchyError('STAGING_ENTRY_INVALID', 'Una fecha de origen no es válida.');
        return parsed;
    };
    return { project_slug: projectSlug, form_ref: stream.form_ref, entry_uuid: uuid.toLowerCase(),
        ec5_uuid: stream.record_type === 'branch' ? null : uuid.toLowerCase(),
        record_type: stream.record_type, branch_ref: stream.branch_ref,
        parent_form_ref: stream.parent_form_ref, parent_uuid: parent?.toLowerCase() || null,
        created_by: entry.created_by || entry.created_by_username || null,
        created_at_epicollect: date(entry.created_at), updated_at_epicollect: date(entry.updated_at),
        uploaded_at_epicollect: date(entry.uploaded_at), payload: entry };
}

module.exports = { hierarchyError, validRef, parseProjectHierarchy, normalizeHierarchyEntry };
