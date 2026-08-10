//import * as stagingEntryModel from '../models/stagingEntry.model.js';

const stagingEntryModel = require('../models/stagingEntry.model.js');

const { buildDynamicColumns, } = require('../services/schemaAnalyzer.service.js');

const { parseFilters, normalizeSortOptions, } = require('../services/stagingQuery.service.js');

const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]+$/;
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 1_000;

const TECHNICAL_COLUMNS = [
    {
        key: 'ec5_uuid',
        label: 'UUID Epicollect5',
        type: 'uuid',
        source: 'system',
    },
    {
        key: 'project_slug',
        label: 'Proyecto',
        type: 'text',
        source: 'system',
    },
    {
        key: 'form_ref',
        label: 'Formulario',
        type: 'text',
        source: 'system',
    },
    {
        key: 'created_by',
        label: 'Creado por',
        type: 'text',
        source: 'system',
    },
    {
        key: 'created_at_epicollect',
        label: 'Creado en Epicollect5',
        type: 'datetime',
        source: 'system',
    },
    {
        key: 'updated_at_epicollect',
        label: 'Actualizado en Epicollect5',
        type: 'datetime',
        source: 'system',
    },
    {
        key: 'uploaded_at_epicollect',
        label: 'Cargado en Epicollect5',
        type: 'datetime',
        source: 'system',
    },
    {
        key: 'sync_status',
        label: 'Estado de sincronización',
        type: 'status',
        source: 'system',
    },
    {
        key: 'validation_status',
        label: 'Estado de validación',
        type: 'status',
        source: 'system',
    },
    {
        key: 'received_at',
        label: 'Recibido en staging',
        type: 'datetime',
        source: 'system',
    },
];

function parsePositiveInteger(value, defaultValue) {
    if (value === undefined) {
        return defaultValue;
    }

    if (typeof value !== 'string' || !/^\d+$/.test(value)) {
        return null;
    }

    const parsedValue = Number.parseInt(value, 10);

    if (!Number.isSafeInteger(parsedValue) || parsedValue < 1) {
        return null;
    }

    return parsedValue;
}

async function getStagingEntries(req, res) {
    try {
        const errors = [];

        const rawProjectSlug = req.query.project_slug;
        const rawFormRef = req.query.form_ref;

        const projectSlug =
            typeof rawProjectSlug === 'string'
                ? rawProjectSlug.trim()
                : '';

        let formRef = null;         

        if (rawFormRef !== undefined) {
            if (typeof rawFormRef !== 'string') {
                errors.push('El campo form_ref debe ser una cadena de texto');
            } else {
                formRef = rawFormRef.trim();

                if (!formRef) {
                    errors.push('El campo form_ref no puede estar vacío');
                }
            }
        }

        const page = parsePositiveInteger(
            req.query.page,
            DEFAULT_PAGE,
        );

        const pageSize = parsePositiveInteger(
            req.query.page_size,
            DEFAULT_PAGE_SIZE,
        );

        const rawSearch = req.query.search;

        let search = null;

        if (rawSearch !== undefined) {
            if (typeof rawSearch !== 'string') {
                errors.push('El parámetro search debe ser una cadena de texto');
            } else {
                search = rawSearch.trim();

                if (search.length > 200) {
                    errors.push('El parámetro search no puede superar 200 caracteres');
                }

                if (!search) {
                    search = null;
                }
            }
        }

        const filterResult = parseFilters(
            req.query.filters,
        );

        errors.push(...filterResult.errors);

        const sortResult = normalizeSortOptions(
            req.query.sort_by,
            req.query.sort_order,
        );

        errors.push(...sortResult.errors);



        if (!projectSlug) {
            errors.push('El campo project_slug es obligatorio');
        } else if (projectSlug.length > 150) {
            errors.push(
                'El campo project_slug no puede superar 150 caracteres',
            );
        } else if (!IDENTIFIER_PATTERN.test(projectSlug)) {
            errors.push(
                'El campo project_slug solo debe contener letras, números, guiones y guiones bajos',
            );
        }

        if (formRef) {
            if (formRef.length > 150) {
                errors.push(
                    'El campo form_ref no puede superar 150 caracteres',
                );
            } else if (!IDENTIFIER_PATTERN.test(formRef)) {
                errors.push(
                    'El campo form_ref solo debe contener letras, números, guiones y guiones bajos',
                );
            }
        }

        if (page === null) {
            errors.push(
                'El campo page debe ser un número entero mayor o igual a 1',
            );
        }

        if (pageSize === null) {
            errors.push(
                'El campo page_size debe ser un número entero mayor o igual a 1',
            );
        } else if (pageSize > MAX_PAGE_SIZE) {
            errors.push(
                `El campo page_size no puede superar ${MAX_PAGE_SIZE}`,
            );
        }

        if (errors.length > 0) {
            return res.status(400).json({
                status: 'error',
                code: 'STAGING_QUERY_INVALID',
                message: 'Los parámetros de consulta no son válidos',
                errors,
            });
        }

        /*const result = await stagingEntryModel.findStagingEntries({
            projectSlug,
            formRef,
            page,
            pageSize,
        });*/
        const [result, schemaRows] = await Promise.all([
            stagingEntryModel.findStagingEntries({
                projectSlug,
                formRef,
                page,
                pageSize,
                search,
                filters: filterResult.filters,
                sortBy: sortResult.sortBy,
                sortOrder: sortResult.sortOrder,
            }),
            stagingEntryModel.findStagingSchema({
                projectSlug,
                formRef,
            }),
        ]);

        const dynamicColumns = buildDynamicColumns(schemaRows);

        const columns = [
            ...TECHNICAL_COLUMNS,
            ...dynamicColumns,
        ];

        const totalPages =
            result.total === 0
                ? 0
                : Math.ceil(result.total / pageSize);

        return res.json({
            status: 'ok',
            data: {
                scope: {
                    project_slug: projectSlug,
                    form_ref: formRef,
                },
                //columns: TECHNICAL_COLUMNS,
                columns,
                schema: {
                    technical_columns: TECHNICAL_COLUMNS.length,
                    dynamic_columns: dynamicColumns.length,
                    total_columns: columns.length,
                },
                query: {
                    search,
                    filters: filterResult.filters,
                    sort_by: sortResult.sortBy,
                    sort_order: sortResult.sortOrder,
                },
                rows: result.rows,
                pagination: {
                    page,
                    page_size: pageSize,
                    total: result.total,
                    total_pages: totalPages,
                    has_previous: page > 1 && result.total > 0,
                    has_next: page * pageSize < result.total,
                },
            },
        });
    } catch (error) {
        return res.status(500).json({
            status: 'error',
            code: 'STAGING_LIST_FAILED',
            message: 'Error al consultar registros de staging',
            detail: error.message,
        });
    }
}

module.exports = {
    getStagingEntries,
};

