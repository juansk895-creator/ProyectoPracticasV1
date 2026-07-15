
const TECHNICAL_FILTER_FIELDS = Object.freeze({
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
        ) || isPayloadField(field)
    );
}

function isSortableField(field) {
    return (
        Object.hasOwn(
            TECHNICAL_SORT_FIELDS,
            field,
        ) || isPayloadField(field)
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

function getFilterExpression(field, values) {
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
    formRef,
    search,
    filters,
}) {
    const conditions = ['project_slug = $1'];
    const values = [projectSlug];

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
                ec5_uuid::text ILIKE $${searchPosition}
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
        ec5_uuid ASC
    `;
}

module.exports = {
    parseFilters,
    normalizeSortOptions,
    buildWhereClause,
    buildOrderByClause,
};