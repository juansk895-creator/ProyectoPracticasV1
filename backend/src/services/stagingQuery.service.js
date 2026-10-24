
const TECHNICAL_FILTER_FIELDS = Object.freeze({
    entry_uuid: 'entry_uuid::text',
    record_type: 'record_type',
    parent_uuid: 'parent_uuid::text',
    parent_form_ref: 'parent_form_ref',
    branch_ref: 'branch_ref',
    ec5_uuid: 'ec5_uuid::text',
    project_slug: 'project_slug',
    form_ref: 'form_ref',
    created_by: 'created_by',
    created_at_epicollect:
        'created_at_epicollect::text',
    updated_at_epicollect:
        'updated_at_epicollect::text',
    uploaded_at_epicollect:
        'uploaded_at_epicollect::text',
    sync_status: 'sync_status',
    validation_status: 'validation_status',
    received_at: 'received_at::text',
    updated_at: 'updated_at::text',
});

const TECHNICAL_SORT_FIELDS = Object.freeze({
    entry_uuid: 'entry_uuid',
    record_type: 'record_type',
    parent_uuid: 'parent_uuid',
    parent_form_ref: 'parent_form_ref',
    branch_ref: 'branch_ref',
    ec5_uuid: 'ec5_uuid',
    project_slug: 'project_slug',
    form_ref: 'form_ref',
    created_by: 'created_by',
    created_at_epicollect:
        'created_at_epicollect',
    updated_at_epicollect:
        'updated_at_epicollect',
    uploaded_at_epicollect:
        'uploaded_at_epicollect',
    sync_status: 'sync_status',
    validation_status: 'validation_status',
    received_at: 'received_at',
    updated_at: 'updated_at',
});

const ALLOWED_OPERATORS = new Set([
    'eq',
    'neq',
    'contains',
    'starts_with',
    'is_null',
    'not_null',
]);

const OPERATORS_WITHOUT_VALUE = new Set([
    'is_null',
    'not_null',
]);

const PAYLOAD_FIELD_PATTERN =
    /^payload\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;
const DECLARED_FIELD_PATTERN = /^field\.[a-f0-9-]{36}\.[A-Za-z0-9_-]{1,150}\.[A-Za-z0-9_-]{1,150}$/i;

const MAX_FILTERS = 10;
const MAX_FILTER_VALUE_LENGTH = 500;

function isPayloadField(field) {
    return PAYLOAD_FIELD_PATTERN.test(field);
}

function isFilterableField(field) {
    return (
        Object.hasOwn(
            TECHNICAL_FILTER_FIELDS,
            field,
        ) || isPayloadField(field) || DECLARED_FIELD_PATTERN.test(field)
    );
}

function isSortableField(field) {
    return (
        Object.hasOwn(
            TECHNICAL_SORT_FIELDS,
            field,
        ) || isPayloadField(field) || DECLARED_FIELD_PATTERN.test(field)
    );
}

function getPayloadPath(field) {
    return field
        .slice('payload.'.length)
        .split('.');
}

function parseFilters(rawFilters) {
    if (rawFilters === undefined) {
        return {
            filters: [],
            errors: [],
        };
    }

    if (typeof rawFilters !== 'string') {
        return {
            filters: [],
            errors: [
                'El parámetro filters debe ser una cadena JSON',
            ],
        };
    }

    let parsedFilters;

    try {
        parsedFilters = JSON.parse(rawFilters);
    } catch {
        return {
            filters: [],
            errors: [
                'El parámetro filters no contiene JSON válido',
            ],
        };
    }

    if (!Array.isArray(parsedFilters)) {
        return {
            filters: [],
            errors: [
                'El parámetro filters debe contener un arreglo',
            ],
        };
    }

    if (parsedFilters.length > MAX_FILTERS) {
        return {
            filters: [],
            errors: [
                `No se permiten más de ${MAX_FILTERS} filtros`,
            ],
        };
    }

    const filters = [];
    const errors = [];

    parsedFilters.forEach((filter, index) => {
        const position = index + 1;

        if (
            !filter ||
            typeof filter !== 'object' ||
            Array.isArray(filter)
        ) {
            errors.push(
                `El filtro ${position} no es válido`,
            );
            return;
        }

        const field =
            typeof filter.field === 'string'
                ? filter.field.trim()
                : '';

        const operator =
            typeof filter.operator === 'string'
                ? filter.operator.trim()
                : '';

        if (!isFilterableField(field)) {
            errors.push(
                `El campo del filtro ${position} no está permitido`,
            );
        }

        if (!ALLOWED_OPERATORS.has(operator)) {
            errors.push(
                `El operador del filtro ${position} no está permitido`,
            );
        }

        let value = null;

        if (!OPERATORS_WITHOUT_VALUE.has(operator)) {
            if (
                filter.value === undefined ||
                filter.value === null ||
                typeof filter.value === 'object'
            ) {
                errors.push(
                    `El filtro ${position} requiere un valor simple`,
                );
            } else {
                value = String(filter.value);

                if (
                    value.length >
                    MAX_FILTER_VALUE_LENGTH
                ) {
                    errors.push(
                        `El valor del filtro ${position} supera ${MAX_FILTER_VALUE_LENGTH} caracteres`,
                    );
                }
            }
        }

        if (
            isFilterableField(field) &&
            ALLOWED_OPERATORS.has(operator) &&
            (
                OPERATORS_WITHOUT_VALUE.has(operator) ||
                value !== null
            )
        ) {
            filters.push({
                field,
                operator,
                value,
            });
        }
    });

    return {
        filters,
        errors,
    };
}

function normalizeSortOptions(
    rawSortBy,
    rawSortOrder,
) {
    const errors = [];

    const sortBy =
        rawSortBy === undefined
            ? 'received_at'
            : typeof rawSortBy === 'string'
                ? rawSortBy.trim()
                : '';

    const sortOrder =
        rawSortOrder === undefined
            ? 'desc'
            : typeof rawSortOrder === 'string'
                ? rawSortOrder.trim().toLowerCase()
                : '';

    if (!isSortableField(sortBy)) {
        errors.push(
            'El parámetro sort_by no corresponde a una columna permitida',
        );
    }

    if (
        sortOrder !== 'asc' &&
        sortOrder !== 'desc'
    ) {
        errors.push(
            'El parámetro sort_order solo admite asc o desc',
        );
    }

    return {
        sortBy,
        sortOrder,
        errors,
    };
}

function getDeclaredExpression(field, values, fieldColumns) {
    const column = fieldColumns.find((item) => item.key === field);
    if (!column) throw Object.assign(new Error('La pregunta seleccionada no pertenece al proyecto.'), { code: 'STAGING_QUERY_INVALID' });
    const project = values.push(column.project_id);
    const form = values.push(column.form_ref);
    const input = values.push(column.input_ref);
    return `CASE WHEN project_id = $${project}::uuid AND form_ref = $${form} THEN field_values -> $${input}::text END`;
}

function getFilterExpression(field, values, fieldColumns = []) {
    if (DECLARED_FIELD_PATTERN.test(field)) return `(${getDeclaredExpression(field, values, fieldColumns)}) #>> '{}'`;
    if (
        Object.hasOwn(
            TECHNICAL_FILTER_FIELDS,
            field,
        )
    ) {
        return TECHNICAL_FILTER_FIELDS[field];
    }

    values.push(getPayloadPath(field));

    return (
        `payload #>> $${values.length}::text[]`
    );
}

function buildWhereClause({
    projectSlug,
    sourceBaseUrl,
    formRef,
    search,
    filters,
    fieldColumns = [],
}) {
    const conditions = ['project_slug = $1'];
    const values = [projectSlug];
    if (sourceBaseUrl) {
        values.push(sourceBaseUrl);
        conditions.push(`project_id IN (SELECT id FROM staging_projects WHERE base_url = $${values.length})`);
    }

    if (formRef) {
        values.push(formRef);

        conditions.push(
            `form_ref = $${values.length}`,
        );
    }

    if (search) {
        values.push(`%${search}%`);

        const searchPosition = values.length;

        conditions.push(`
            (
                entry_uuid::text ILIKE $${searchPosition}
                OR COALESCE(created_by, '')
                    ILIKE $${searchPosition}
                OR COALESCE(sync_status, '')
                    ILIKE $${searchPosition}
                OR COALESCE(validation_status, '')
                    ILIKE $${searchPosition}
                OR payload::text
                    ILIKE $${searchPosition}
            )
        `);
    }

    for (const filter of filters) {
        const expression = getFilterExpression(
            filter.field,
            values,
            fieldColumns,
        );

        if (filter.operator === 'is_null') {
            conditions.push(
                `${expression} IS NULL`,
            );

            continue;
        }

        if (filter.operator === 'not_null') {
            conditions.push(
                `${expression} IS NOT NULL`,
            );

            continue;
        }

        values.push(filter.value);

        const valuePosition = values.length;

        const column = fieldColumns.find((item) => item.key === filter.field);
        if (column?.type === 'choices' && ['eq', 'neq'].includes(filter.operator)) {
            const json = getDeclaredExpression(filter.field, values, fieldColumns);
            const match = `((${json}) ? $${valuePosition} OR ${expression} = $${valuePosition})`;
            conditions.push(filter.operator === 'eq' ? match : `NOT COALESCE(${match}, false)`);
            continue;
        }

        if (filter.operator === 'eq') {
            conditions.push(
                `${expression} = $${valuePosition}`,
            );
        }

        if (filter.operator === 'neq') {
            conditions.push(
                `${expression} IS DISTINCT FROM $${valuePosition}`,
            );
        }

        if (filter.operator === 'contains') {
            conditions.push(`
                COALESCE(${expression}, '')
                ILIKE '%' || $${valuePosition} || '%'
            `);
        }

        if (
            filter.operator === 'starts_with'
        ) {
            conditions.push(`
                COALESCE(${expression}, '')
                ILIKE $${valuePosition} || '%'
            `);
        }
    }

    return {
        whereClause: conditions.join(' AND '),
        values,
    };
}

function buildOrderByClause({
    sortBy,
    sortOrder,
    values,
    fieldColumns = [],
}) {
    let expression;

    if (
        Object.hasOwn(
            TECHNICAL_SORT_FIELDS,
            sortBy,
        )
    ) {
        expression =
            TECHNICAL_SORT_FIELDS[sortBy];
    } else if (DECLARED_FIELD_PATTERN.test(sortBy)) {
        expression = `(${getDeclaredExpression(sortBy, values, fieldColumns)}) #>> '{}'`;
        if (fieldColumns.find((column) => column.key === sortBy)?.type === 'number') {
            expression = `CASE WHEN length(${expression}) < 1000 AND ${expression} ~ '^[+-]?([0-9]+(\\.[0-9]*)?|\\.[0-9]+)([eE][+-]?[0-9]{1,3})?$'
                THEN (${expression})::numeric END`;
        }
    } else {
        values.push(getPayloadPath(sortBy));

        expression =
            `payload #>> $${values.length}::text[]`;
    }

    const direction =
        sortOrder === 'asc'
            ? 'ASC'
            : 'DESC';

    return `
        ${expression} ${direction} NULLS LAST,
        project_id ASC, form_ref ASC, entry_uuid ASC
    `;
}

module.exports = {
    parseFilters,
    normalizeSortOptions,
    buildWhereClause,
    buildOrderByClause,
};
