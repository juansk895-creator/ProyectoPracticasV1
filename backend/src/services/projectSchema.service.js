const { validRef, hierarchyError } = require('./projectHierarchy.service');

const TYPES = { integer: 'number', decimal: 'number', number: 'number', radio: 'choice',
    dropdown: 'choice', checkbox: 'choices', date: 'date', time: 'time', location: 'location',
    photo: 'media', audio: 'media', video: 'media', barcode: 'text', text: 'text', textarea: 'text' };
const NUMERIC = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const own = (object, key) => object && Object.hasOwn(object, key) ? object[key] : undefined;

function schemaError() {
    return hierarchyError('EPICOLLECT_SCHEMA_INVALID', 'La definición de preguntas o su correspondencia de exportación no es válida.');
}

function compileProjectFields(definition, mode = 'auto') {
    const forms = definition?.data?.project?.forms;
    if (!Array.isArray(forms)) throw schemaError();
    const mappings = definition.meta?.project_mapping || [];
    if (!Array.isArray(mappings)) throw schemaError();
    const defaultMapping = mappings.find((item) => item.is_default === true) || mappings[0];
    const automatic = mappings.find((item) => item.name === 'EC5_AUTO' || Number(item.map_index) === 0);
    if (mode === 'auto' && mappings.length && !automatic) throw schemaError();
    const mapping = mode === 'auto' ? automatic || defaultMapping : defaultMapping;
    const fields = [];
    const seen = new Set();
    function walk(inputs, mapped, defaults, formRef, formLabel, path = [], groups = [], inheritedHidden = false, depth = 0) {
        if (!Array.isArray(inputs) || depth > 10) throw schemaError();
        for (const input of inputs) {
            if (!input || !validRef(input.ref) || typeof input.type !== 'string') throw schemaError();
            const selected = own(mapped, input.ref) || {};
            const defaultField = own(defaults, input.ref) || {};
            const hidden = inheritedHidden || defaultField.hide === true || input.is_hidden === true;
            const label = typeof input.question === 'string' && input.question.trim() ? input.question.trim() : input.ref;
            const alias = typeof selected.map_to === 'string' && selected.map_to ? selected.map_to : input.ref;
            if (input.type === 'readme') continue;
            if (input.type === 'group') {
                walk(input.group, selected.group, defaultField.group, formRef, formLabel,
                    [...path, alias], [...groups, label], hidden, depth + 1);
            } else if (input.type === 'branch') {
                walk(input.branch || [], selected.branch, defaultField.branch, input.ref,
                    `${formLabel} › ${label}`, [], [], hidden, depth + 1);
            } else {
                const identity = `${formRef}.${input.ref}`;
                if (seen.has(identity) || fields.length >= 10000) throw schemaError();
                if (mappings.length && !own(mapped, input.ref)) throw schemaError();
                seen.add(identity);
                if (!Array.isArray(input.possible_answers || [])) throw schemaError();
                const options = (input.possible_answers || []).map((answer) => {
                    if (!validRef(answer.answer_ref) || typeof answer.answer !== 'string') throw schemaError();
                    const exported = own(selected.possible_answers, answer.answer_ref)?.map_to;
                    return { value: answer.answer_ref, label: answer.answer,
                        exported: exported === undefined ? answer.answer : String(exported) };
                });
                if (new Set(options.map((option) => option.value)).size !== options.length) throw schemaError();
                fields.push({ input_ref: input.ref, form_ref: formRef, form_label: formLabel,
                    label: [...groups, label].join(' › '), type: TYPES[input.type] || 'text',
                    input_type: input.type, hidden, required: input.is_required === true,
                    datetime_format: input.datetime_format || null, options,
                    export_path: [...path, alias] });
            }
        }
    }
    for (const form of forms) {
        if (!validRef(form.ref)) throw schemaError();
        walk(form.inputs, own(mapping?.forms, form.ref), own(defaultMapping?.forms, form.ref),
            form.ref, form.name || form.ref);
    }
    const leafCounts = new Map();
    const paths = new Set();
    for (const field of fields) {
        const pathKey = JSON.stringify([field.form_ref, field.export_path]);
        if (paths.has(pathKey)) throw schemaError();
        paths.add(pathKey);
        const key = `${field.form_ref}.${field.export_path.at(-1)}`;
        leafCounts.set(key, (leafCounts.get(key) || 0) + 1);
    }
    for (const field of fields) field.flat_alias_allowed = leafCounts.get(`${field.form_ref}.${field.export_path.at(-1)}`) === 1;
    const mapIndex = mapping?.map_index;
    if (mapIndex !== undefined && (!Number.isSafeInteger(Number(mapIndex)) || Number(mapIndex) < 0)) throw schemaError();
    return { fields, mapIndex: mapIndex === undefined ? null : Number(mapIndex) };
}

function readPath(payload, path) {
    let current = payload;
    for (const part of path) {
        if (!current || typeof current !== 'object' || !Object.hasOwn(current, part)) return undefined;
        current = current[part];
    }
    return current;
}

function normalizeFieldValue(value, field) {
    if (value === undefined || value === null || value === '') return null;
    if (field.type === 'number' && typeof value !== 'object' && NUMERIC.test(String(value)) && Number.isSafeInteger(Number(value))) return Number(value);
    if (field.type !== 'choice' && field.type !== 'choices') return value;
    function optionRef(raw) {
        const text = String(raw);
        const matches = field.options.filter((option) => option.exported === text);
        if (matches.length > 1) throw schemaError();
        return matches[0]?.value || field.options.find((option) => option.value === text)?.value || raw;
    }
    if (field.type === 'choice') return optionRef(value);
    if (Array.isArray(value)) return value.map(optionRef);
    if (field.options.some((option) => option.exported === String(value))) return [optionRef(value)];
    const parts = String(value).split(',').map((part) => part.trim());
    if (parts.every((part) => field.options.some((option) => option.exported === part || option.value === part))) {
        return parts.map(optionRef);
    }
    return value;
}

function extractFieldValues(payload, fields, formRef) {
    const result = Object.create(null);
    const selected = fields.filter((field) => field.form_ref === formRef);
    for (const field of selected) {
        let value = readPath(payload, field.export_path);
        if (value === undefined) value = own(payload, field.input_ref);
        const leaf = field.export_path.at(-1);
        if (value === undefined && field.flat_alias_allowed) {
            value = own(payload, leaf);
        }
        result[field.input_ref] = normalizeFieldValue(value, field);
    }
    return result;
}

function buildDeclaredColumns(projects, formRef = null) {
    return projects.flatMap((project) => compileProjectFields(project.definition).fields
        .filter((field) => !formRef || field.form_ref === formRef)
        .map((field) => ({ key: `field.${project.id}.${field.form_ref}.${field.input_ref}`,
            project_id: project.id, form_ref: field.form_ref, input_ref: field.input_ref,
            label: `${field.form_label} › ${field.label}`, type: field.type, source: 'field_values',
            hidden: field.hidden, required: field.required, nullable: true,
            input_type: field.input_type, datetime_format: field.datetime_format,
            options: field.options.map(({ value, label }) => ({ value, label })) })));
}

module.exports = { compileProjectFields, extractFieldValues, buildDeclaredColumns };
