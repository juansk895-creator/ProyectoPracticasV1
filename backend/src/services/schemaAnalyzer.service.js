const EXCLUDED_PAYLOAD_PATHS = new Set([
    'ec5_uuid',
    'entry_uuid',
    'uuid',
    'project_slug',
    'form_ref',
    'created_by',
    'created_by_username',
    'created_at',
    'updated_at',
    'uploaded_at',
]);

const JSON_TYPE_MAP = {
    string: 'text',
    number: 'number',
    boolean: 'boolean',
    array: 'array',
    object: 'json',
};

function buildLabel(fieldPath) {
    return fieldPath.split('.').map((segment) => segment.replace(/[_-]+/g, ' ').trim(),
    ).join(' › ');
}

function resolveColumnType(observedTypes) {
    const meaningfulTypes = observedTypes.filter(
        (type) => type !== 'null',
    );

    if (meaningfulTypes.length === 0) {
        return 'unknown';
    }

    if (meaningfulTypes.length > 1) {
        return 'mixed';
    }

    return JSON_TYPE_MAP[meaningfulTypes[0]] || 'unknown';
}

function buildDynamicColumns(schemaRows) {
    return schemaRows.filter(
        (schemaRow) => !EXCLUDED_PAYLOAD_PATHS.has(schemaRow.fieldPath,),
    ).map((schemaRow) => {
        const observedTypes = schemaRow.observed_types || [];

        const occurrences = Number(schemaRow.total_entries) || 0;

        const totalEntries = Number(schemaRow.total_entries) || 0;

        return {
            key: `payload.${schemaRow.field_path}`,
            path: schemaRow.field_path,
            label: buildLabel(schemaRow.field_path),
            type: resolveColumnType(observedTypes),
            source: 'payload',
            nullable: observedTypes.includes('null') || occurrences < totalEntries,
            observed_types: observedTypes,
        };
    });
}

module.exports = {
    buildDynamicColumns,
};

