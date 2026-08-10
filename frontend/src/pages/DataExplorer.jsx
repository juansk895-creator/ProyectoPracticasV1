import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { getConnections } from '../services/apiManager.service';
import { getStagingEntries } from '../services/staging.service';

import VirtualizedDataTable from '../components/VirtualizedDataTable';


const OPERATORS = [
    { value: 'contains', label: 'Contiene' },
    { value: 'eq', label: 'Es igual a' },
    { value: 'neq', label: 'Es diferente de' },
    { value: 'starts_with', label: 'Comienza con' },
    { value: 'is_null', label: 'Está vacío' },
    { value: 'not_null', label: 'No está vacío' },
];

const OPERATORS_WITHOUT_VALUE = new Set([
    'is_null',
    'not_null',
]);

const initialDraftFilter = {
    field: '',
    operator: 'contains',
    value: '',
};

function getErrorMessage(error) {
    const errors = error?.payload?.errors;

    if (Array.isArray(errors)) {
        return errors.join(' ');
    }

    return (
        error?.payload?.detail ||
        error?.message ||
        'No fue posible consultar los registros.'
    );
}

/* Ahora estas funciones se encuentran en VirtualizedDataTable.jsx
function getNestedValue(source, path) {
    if (!source || !path) {
        return null;
    }

    return path
        .split('.')
        .reduce(
            (current, segment) =>
                current?.[segment],
            source,
        );
}

function getCellValue(row, column) {
    if (column.source === 'payload') {
        return getNestedValue(
            row.payload,
            column.path,
        );
    }

    return row[column.key];
}

function formatCellValue(value, column) {
    if (value === null || value === undefined) {
        return '-';
    }

    if (column.type === 'datetime') {
        const date = new Date(value);

        if (!Number.isNaN(date.getTime())) {
            return date.toLocaleString();
        }
    }

    if (typeof value === 'boolean') {
        return value ? 'Sí' : 'No';
    }

    if (typeof value === 'object') {
        return JSON.stringify(value);
    }

    return String(value);
}
*/

export default function DataExplorer() {
    const [selectedConnectionId, setSelectedConnectionId] =
        useState('');

    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);

    const [searchInput, setSearchInput] =
        useState('');

    const [search, setSearch] = useState('');

    const [sortBy, setSortBy] =
        useState('received_at');

    const [sortOrder, setSortOrder] =
        useState('desc');

    const [filters, setFilters] = useState([]);

    const [draftFilter, setDraftFilter] =
        useState(initialDraftFilter);

    const connectionsQuery = useQuery({
        queryKey: ['api-connections'],
        queryFn: getConnections,
    });

    const connections =
        connectionsQuery.data?.data || [];

    const selectedConnection =
        connections.find(
            (connection) =>
                connection.id ===
                selectedConnectionId,
        ) ||
        connections[0] ||
        null;

    const stagingQuery = useQuery({
        queryKey: [
            'staging-entries',
            {
                connectionId:
                    selectedConnection?.id,
                projectSlug:
                    selectedConnection?.project_slug,
                formRef:
                    selectedConnection?.form_ref,
                page,
                pageSize,
                search,
                filters,
                sortBy,
                sortOrder,
            },
        ],
        queryFn: () =>
            getStagingEntries({
                projectSlug:
                    selectedConnection.project_slug,
                formRef:
                    selectedConnection.form_ref,
                page,
                pageSize,
                search,
                filters,
                sortBy,
                sortOrder,
            }),
        enabled: Boolean(selectedConnection),
        placeholderData: keepPreviousData,
    });

    const stagingData =
        stagingQuery.data?.data;

    const columns = stagingData?.columns || [];
    const rows = stagingData?.rows || [];

    const pagination =
        stagingData?.pagination || {
            page: 1,
            page_size: pageSize,
            total: 0,
            total_pages: 0,
            has_previous: false,
            has_next: false,
        };

    const tableResetKey = JSON.stringify({
        connectionId: selectedConnection?.id || null,
        page,
        pageSize,
        search,
        filters,
        sortBy,
        sortOrder,
    });

    function resetQueryState() {
        setPage(1);
        setSearchInput('');
        setSearch('');
        setFilters([]);
        setDraftFilter(initialDraftFilter);
        setSortBy('received_at');
        setSortOrder('desc');
    }

    function handleConnectionChange(event) {
        setSelectedConnectionId(
            event.target.value,
        );

        resetQueryState();
    }

    function handleSearch(event) {
        event.preventDefault();

        setPage(1);
        setSearch(searchInput.trim());
    }

    function addFilter(event) {
        event.preventDefault();

        if (!draftFilter.field) {
            return;
        }

        const requiresValue =
            !OPERATORS_WITHOUT_VALUE.has(
                draftFilter.operator,
            );

        if (
            requiresValue &&
            !draftFilter.value.trim()
        ) {
            return;
        }

        setFilters((current) => [
            ...current,
            {
                field: draftFilter.field,
                operator:
                    draftFilter.operator,
                value: requiresValue
                    ? draftFilter.value.trim()
                    : undefined,
            },
        ]);

        setDraftFilter(initialDraftFilter);
        setPage(1);
    }

    function removeFilter(indexToRemove) {
        setFilters((current) =>
            current.filter(
                (_, index) =>
                    index !== indexToRemove,
            ),
        );

        setPage(1);
    }

    if (connectionsQuery.isPending) {
        return (
            <main className='min-h-screen bg-slate-100 p-6'>
                <p className='text-sm text-slate-600'>
                    Cargando conexiones…
                </p>
            </main>
        );
    }

    if (connectionsQuery.isError) {
        return (
            <main className='min-h-screen bg-slate-100 p-6'>
                <div className='rounded-lg border border-red-200 bg-red-50 p-4 text-red-800'>
                    {getErrorMessage(
                        connectionsQuery.error,
                    )}
                </div>
            </main>
        );
    }

    return (
        <main className='min-h-screen bg-slate-100 p-6 text-slate-900'>
            <section className='mx-auto max-w-[1600px] space-y-6'>
                <header>
                    <p className='text-sm font-semibold uppercase tracking-wide text-slate-500'>
                        Sistema Dinámico de Gestión de Encuestas
                    </p>

                    <h1 className='mt-1 text-3xl font-bold'>
                        Explorador de datos
                    </h1>

                    <p className='mt-2 max-w-3xl text-sm text-slate-600'>
                        Consulta los registros de staging mediante
                        columnas generadas automáticamente desde el
                        esquema JSONB.
                    </p>
                </header>

                <section className='rounded-xl bg-white p-5 shadow-sm'>
                    <div className='grid gap-4 lg:grid-cols-[minmax(260px,1fr)_2fr_auto]'>
                        <label className='block'>
                            <span className='text-sm font-medium'>
                                Proyecto y formulario
                            </span>

                            <select
                                className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2'
                                value={
                                    selectedConnection?.id ||
                                    ''
                                }
                                onChange={
                                    handleConnectionChange
                                }
                            >
                                {connections.map(
                                    (connection) => (
                                        <option
                                            key={
                                                connection.id
                                            }
                                            value={
                                                connection.id
                                            }
                                        >
                                            {connection.name} —{' '}
                                            {
                                                connection.project_slug
                                            }
                                            {connection.form_ref
                                                ? ` / ${connection.form_ref}`
                                                : ''}
                                        </option>
                                    ),
                                )}
                            </select>
                        </label>

                        <form
                            className='flex items-end gap-2'
                            onSubmit={handleSearch}
                        >
                            <label className='block flex-1'>
                                <span className='text-sm font-medium'>
                                    Búsqueda
                                </span>

                                <input
                                    className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2'
                                    value={searchInput}
                                    onChange={(event) =>
                                        setSearchInput(
                                            event.target
                                                .value,
                                        )
                                    }
                                    placeholder='Buscar en los registros'
                                />
                            </label>

                            <button
                                className='rounded-lg bg-slate-900 px-4 py-2 text-white'
                                type='submit'
                            >
                                Buscar
                            </button>
                        </form>

                        <label className='block'>
                            <span className='text-sm font-medium'>
                                Filas
                            </span>

                            <select
                                className='mt-1 rounded-lg border border-slate-300 px-3 py-2'
                                value={pageSize}
                                onChange={(event) => {
                                    setPageSize(
                                        Number(
                                            event.target
                                                .value,
                                        ),
                                    );
                                    setPage(1);
                                }}
                            >
                                <option value={25}>
                                    25
                                </option>
                                <option value={50}>
                                    50
                                </option>
                                <option value={100}>
                                    100
                                </option>
                                {/* Nuevas opciones */}
                                <option value={250}>
                                    250
                                </option>
                                <option value={500}>
                                    500
                                </option>
                                <option value={1000}>
                                    1,000
                                </option>
                            </select>
                        </label>
                    </div>

                    <div className='mt-4 grid gap-4 md:grid-cols-2'>
                        <label className='block'>
                            <span className='text-sm font-medium'>
                                Ordenar por
                            </span>

                            <select
                                className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2'
                                value={sortBy}
                                onChange={(event) => {
                                    setSortBy(
                                        event.target.value,
                                    );
                                    setPage(1);
                                }}
                            >
                                {columns.map(
                                    (column) => (
                                        <option
                                            key={
                                                column.key
                                            }
                                            value={
                                                column.key
                                            }
                                        >
                                            {column.label}
                                        </option>
                                    ),
                                )}
                            </select>
                        </label>

                        <label className='block'>
                            <span className='text-sm font-medium'>
                                Dirección
                            </span>

                            <select
                                className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2'
                                value={sortOrder}
                                onChange={(event) => {
                                    setSortOrder(
                                        event.target.value,
                                    );
                                    setPage(1);
                                }}
                            >
                                <option value='asc'>
                                    Ascendente
                                </option>
                                <option value='desc'>
                                    Descendente
                                </option>
                            </select>
                        </label>
                    </div>
                </section>

                <section className='rounded-xl bg-white p-5 shadow-sm'>
                    <h2 className='text-lg font-semibold'>
                        Filtros
                    </h2>

                    <form
                        className='mt-3 grid gap-3 lg:grid-cols-[2fr_1fr_2fr_auto]'
                        onSubmit={addFilter}
                    >
                        <select
                            className='rounded-lg border border-slate-300 px-3 py-2'
                            value={draftFilter.field}
                            onChange={(event) =>
                                setDraftFilter(
                                    (current) => ({
                                        ...current,
                                        field:
                                            event.target
                                                .value,
                                    }),
                                )
                            }
                        >
                            <option value=''>
                                Selecciona una columna
                            </option>

                            {columns.map((column) => (
                                <option
                                    key={column.key}
                                    value={column.key}
                                >
                                    {column.label}
                                </option>
                            ))}
                        </select>

                        <select
                            className='rounded-lg border border-slate-300 px-3 py-2'
                            value={
                                draftFilter.operator
                            }
                            onChange={(event) =>
                                setDraftFilter(
                                    (current) => ({
                                        ...current,
                                        operator:
                                            event.target
                                                .value,
                                    }),
                                )
                            }
                        >
                            {OPERATORS.map(
                                (operator) => (
                                    <option
                                        key={
                                            operator.value
                                        }
                                        value={
                                            operator.value
                                        }
                                    >
                                        {operator.label}
                                    </option>
                                ),
                            )}
                        </select>

                        <input
                            className='rounded-lg border border-slate-300 px-3 py-2 disabled:bg-slate-100'
                            disabled={OPERATORS_WITHOUT_VALUE.has(
                                draftFilter.operator,
                            )}
                            value={draftFilter.value}
                            onChange={(event) =>
                                setDraftFilter(
                                    (current) => ({
                                        ...current,
                                        value:
                                            event.target
                                                .value,
                                    }),
                                )
                            }
                            placeholder='Valor'
                        />

                        <button
                            className='rounded-lg border border-slate-300 px-4 py-2 font-medium'
                            type='submit'
                        >
                            Agregar
                        </button>
                    </form>

                    {filters.length > 0 && (
                        <div className='mt-4 flex flex-wrap gap-2'>
                            {filters.map(
                                (filter, index) => (
                                    <button
                                        className='rounded-full bg-slate-200 px-3 py-1 text-xs'
                                        key={`${filter.field}-${filter.operator}-${index}`}
                                        onClick={() =>
                                            removeFilter(
                                                index,
                                            )
                                        }
                                        type='button'
                                    >
                                        {
                                            filter.field
                                        }{' '}
                                        {
                                            filter.operator
                                        }{' '}
                                        {filter.value ??
                                            ''}
                                        {' ×'}
                                    </button>
                                ),
                            )}
                        </div>
                    )}
                </section>

                <section className='rounded-xl bg-white p-5 shadow-sm'>
                    <div className='mb-4 flex flex-wrap items-center justify-between gap-3'>
                        <div>
                            <h2 className='text-lg font-semibold'>
                                Registros
                            </h2>

                            <p className='text-sm text-slate-500'>
                                {pagination.total}{' '}
                                registros encontrados
                            </p>
                        </div>

                        {stagingQuery.isFetching && (
                            <span className='text-sm text-slate-500'>
                                Actualizando…
                            </span>
                        )}
                    </div>

                    {!selectedConnection ? (
                        <p className='text-sm text-slate-500'>
                            No hay conexiones disponibles.
                        </p>
                    ) : stagingQuery.isPending ? (
                        <p className='text-sm text-slate-500'>
                            Cargando registros…
                        </p>
                    ) : stagingQuery.isError ? (
                        <div className='rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800'>
                            {getErrorMessage(
                                stagingQuery.error,
                            )}
                        </div>
                    ) : rows.length === 0 ? (
                        <p className='text-sm text-slate-500'>
                            No hay registros que coincidan con la consulta.
                        </p>
                    ) : (

                        <VirtualizedDataTable
                            columns={columns}
                            resetKey={tableResetKey}
                            rows={rows}
                        />
                    )}

                    <footer className='mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4'>
                        <p className='text-sm text-slate-600'>
                            Página {pagination.page} de{' '}
                            {pagination.total_pages || 1}
                        </p>

                        <div className='flex gap-2'>
                            <button
                                className='rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:opacity-40'
                                disabled={
                                    !pagination.has_previous ||
                                    stagingQuery.isPlaceholderData
                                }
                                onClick={() =>
                                    setPage(
                                        (current) =>
                                            Math.max(
                                                1,
                                                current -
                                                    1,
                                            ),
                                    )
                                }
                                type='button'
                            >
                                Anterior
                            </button>

                            <button
                                className='rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:opacity-40'
                                disabled={
                                    !pagination.has_next ||
                                    stagingQuery.isPlaceholderData
                                }
                                onClick={() =>
                                    setPage(
                                        (current) =>
                                            current + 1,
                                    )
                                }
                                type='button'
                            >
                                Siguiente
                            </button>
                        </div>
                    </footer>
                </section>
            </section>
        </main>
    );
}

