import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
    activateConnection,
    createConnection,
    deactivateConnection,
    getConnections,
    getSyncLogs,
    syncConnection,
    testConnection,
} from '../services/apiManager.service';


const initialFormState = {
    name: '',
    project_slug: '',
    form_ref: '',
    base_url: 'https://five.epicollect.net/api',
    auth_type: 'none',
    auth_token: '',
    sync_filter_by: 'uploaded_at',
    sync_per_page: 500,
    sync_max_pages: 5,
    sync_delay_ms: 500,
    sync_overlap_minutes: 5,
};

function formatDate(value) {
    if (!value) {
        return '-';
    }

    return new Date(value).toLocaleString();
}

function getErrorMessage(error) {
    const errors = error?.payload?.errors;

    if (Array.isArray(errors) && errors.length > 0) {
        return errors.map((item) => item.message).join('  ');
    }

    return error?.payload?.detail || error?.message || 'Error desconocido,';
}

export default function ApiManager() {
    const queryClient = useQueryClient();
    const [formData, setFormData] = useState(initialFormState);
    const [operationMessage, setOperationMessage] = useState(null);

    const connectionsQuery = useQuery({
        queryKey: ['api-connections'],
        queryFn: getConnections,
    });

    const syncLogsQuery = useQuery({
        queryKey: ['sync-logs'],
        queryFn: () => getSyncLogs(10),
    });

    const connections = connectionsQuery.data?.data || [];
    const logs = syncLogsQuery.data?.data || [];

    const isLoading = connectionsQuery.isLoading || syncLogsQuery.isLoading;

    const activeConnectionsCount = useMemo(() => {
        return connections.filter((connection) => connection.is_active).length;
    }, [connections]);

    function invalidateApiManagerQueries() {
        queryClient.invalidateQueries({ queryKey: ['api-connections'] });
        queryClient.invalidateQueries({ queryKey: ['sync-logs'] });
    }

    const createMutation = useMutation({
        mutationFn: createConnection,
        onSuccess: () => {
            setOperationMessage({
                type: 'success',
                text: 'Conexión creada correctamente',
            });
            setFormData(initialFormState);
            invalidateApiManagerQueries();
        },
        onError: (error) => {
            setOperationMessage({
                type: 'error',
                text: getErrorMessage(error),
            });
        },
    });

    const activateMutation = useMutation({
        mutationFn: activateConnection,
        onSuccess: () => {
            setOperationMessage({
                type: 'success',
                text: 'Conexión activada correctamente.',
            });
            invalidateApiManagerQueries();
        },
        onError: (error) => {
            setOperationMessage({
                type: 'error',
                text: getErrorMessage(error),
            });
        },
    });

    const deactivateMutation = useMutation({
        mutationFn: deactivateConnection,
        onSuccess: () => {
            setOperationMessage({
                type: 'success',
                text: 'Conexión desactivada correctamente.',
            });
            invalidateApiManagerQueries();
        },
        onError: (error) => {
            setOperationMessage({
                type: 'error',
                text: getErrorMessage(error),
            });
        },
    });

    const testMutation = useMutation({
        mutationFn: testConnection,
        onSuccess: () => {
            setOperationMessage({
                type: 'success',
                text: 'Conectividad validada correctamente.',
            });
            invalidateApiManagerQueries();
        },
        onError: (error) => {
            setOperationMessage({
                type: 'error',
                text: getErrorMessage(error),
            });
            invalidateApiManagerQueries();
        },
    });

    const syncMutation = useMutation({
        mutationFn: syncConnection,
        onSuccess: (response) => {
            const processed = response?.data?.sync?.database?.processed ?? 0;
            const fetched = response?.data?.sync?.fetch?.totalEntriesFetched ?? 0;

            setOperationMessage({
                type: 'success',
                text: `Sincronización completada. Registros obtenidos: ${fetched}. procesados: ${processed}.`,
            });
            invalidateApiManagerQueries();
        },
        onError: (error) => {
            setOperationMessage({
                type: 'error',
                text: getErrorMessage(error),
            });
            invalidateApiManagerQueries();
        },
    });

    function handleInputChange(event) {
        const { name, value, type } = event.target;

        setFormData((current) => ({
            ...current,
            [name]: type === 'number' ? Number(value) : value,
        }));
    }

    function handleSubmit(event) {
        event.preventDefault();

        const payload = {
            ...formData,
            form_ref: formData.form_ref.trim() || null,
            auth_token: formData.auth_type === 'none'
                ? undefined : formData.auth_token.trim(),
        };

        createMutation.mutate(payload);
    }

    const isMutating = 
        createMutation.isPending ||
        activateMutation.isPending ||
        deactivateMutation.isPending ||
        testMutation.isPending ||
        syncMutation.isPending
    ;

    return (

        <main className='min-h-screen bg-slate-100 p-6 text-slate-900'>
            <section className='mx-auto max-w-7xl space-y-6'>
                <header>
                    <p className='text-sm font-semibold uppercase tracking-wide text-slate-500'>
                        Sistema Dinámico de Gestión de Encuestas
                    </p>
                    <h1 className='mt-1 text-3xl font-bold'>API Manager</h1>
                    <p className='mt-2 max-w-3xl text-sm text-slate-600'>
                        Panel administrativo para registrar conexiones a Epicollect5,
                        validar Conectividad, ejecutar Sincronizaciones y revisar logs
                        operativos.
                    </p>
                </header>

                <section className='grid gap-4 md:grid-cols-3'>
                    <article className='rounded-xl bg-white p-4 shadow-sm'>
                        <p className='text-sm text-slate-500'>Conexiones registradas</p>
                        <p className='mt-2 text-3xl font-bold'>{connections.length}</p>
                    </article>

                    <article className='rounded-xl bg-white p-4 shadow-sm'>
                        <p className='text-sm text-slate-500'>Conexiones activas</p>
                        <p className='mt-2 text-3xl font-bold'>{activeConnectionsCount}</p>
                    </article>

                    <article className='rounded-xl bg-white p-4 shadow-sm'>
                        <p className='text-sm text-slate-500'>Últimos logs visibles</p>
                        <p className='mt-2 text-3xl font-bold'>{logs.length}</p>
                    </article>
                </section>

                {operationMessage && (
                    <div className={`rounded-lg border p-4 text-sm ${
                        operationMessage.type === 'success'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                        : 'border-red-200 bg-red-50 text-red-800'
                    }`}>
                        {operationMessage.text}
                    </div>
                )}

                <section className='grid gap-6 lg:grid-cols-[420px_1fr]'>
                    <form onSubmit={handleSubmit} className='space-y-4 rounded-xl bg-white p-5 shadow-sm'>
                        <div>
                            <h2 className='text-lg font-semibold'>Nueva conexión</h2>
                            <p className='text-sm text-slate-500'>
                                Registra una conexión para consumir datos desde Epicollect5.
                            </p>
                        </div>

                        <label className='block'>
                            <span className='text-sm font-medium'>Nombre</span>
                            <input
                                className='mt-1 w-full rounded-lg border border-slate-300 py-2'
                                name='name'
                                value={formData.name}
                                onChange={handleInputChange}
                                placeholder='Epicollect Public Test'
                            />
                        </label>

                        <label className='block'>
                            <span className='text-sm font-medium'>Project slug</span>
                            <input
                                className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2'
                                name='project_slug'
                                value={formData.project_slug}
                                onChange={handleInputChange}
                                placeholder='ec5-api-test'
                            />
                        </label>

                        <label className='block'>
                            <span className='text-sm font-medium'>Form ref opcional</span>
                            <input
                                className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2'
                                name='form_ref'
                                value={formData.form_ref}
                                onChange={handleInputChange}
                                placeholder='Dejar vacío si no aplica'
                            />
                        </label>

                        <label className='block'>
                            <span className='text-sm font-medium'>Base URL</span>
                            <input
                                className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2'
                                name='base_url'
                                value={formData.base_url}
                                onChange={handleInputChange}
                            />
                        </label>

                        <label className='block'>
                            <span className='text-sm font-medium'>Tipo de autenticación</span>
                            <select
                                className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2'
                                name='auth_type'
                                value={formData.auth_type}
                                onChange={handleInputChange}
                            >
                                <option value='none'>none</option>
                                <option value='bearer'>bearer</option>
                                <option value='custom'>custom</option>
                            </select>
                        </label>

                        {formData.auth_type !== 'none' && (
                            <label className='block'>
                                <span className='text-sm font-medium'>Token</span>
                                <input
                                    className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2'
                                    name='auth_token'
                                    type='password'
                                    value={formData.auth_token}
                                    onChange={handleInputChange}
                                    placeholder='Token de acceso'
                                />
                            </label>
                        )}

                        <div className='grid grid-cols-2 gap-3'>
                            <label className='block'>
                                <span className='text-sm font-medium'>Por página</span>
                                <input
                                    className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2'
                                    name='sync_per_page'
                                    type='number'
                                    value={formData.sync_per_page}
                                    onChange={handleInputChange}
                                />
                            </label>

                            <label className='block'>
                                <span className='text-sm font-medium'>Página máxima</span>
                                <input
                                    className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2'
                                    name='sync_max_pages'
                                    type='number'
                                    value={formData.sync_max_pages}
                                    onChange={handleInputChange}
                                />
                            </label>

                            <label className='block'>
                                <span className='text-sm font-medium'>Retraso ms</span>
                                <input
                                    className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2'
                                    name='sync_delay_ms'
                                    type='number'
                                    value={formData.sync_delay_ms}
                                    onChange={handleInputChange}
                                />
                            </label>

                            <label className='block'>
                                <span className='text-sm font-medium'>Overlap min</span>
                                <input
                                    className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2'
                                    name='sync_overlap_minutes'
                                    type='number'
                                    value={formData.sync_overlap_minutes}
                                    onChange={handleInputChange}
                                />
                            </label>
                        </div>

                        <button
                            className='w-full rounded-lg bg-slate-900 px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50'
                            disabled={createMutation.isPending}
                            type='submit'
                        >
                            {createMutation.isPending ? 'Guardando...' : 'Crear conexión'}
                        </button>
                    </form>

                    <section className='rounded-xl bg-white p-5 shadow-sm'>
                        <div className='mb-4'>
                            <h2>Conexiones registradas</h2>
                            <p className='text-sm text-slate-500'>
                                Administra conectividad y sincronización
                            </p>
                        </div>

                        {isLoading ? (
                            <p className='text-sm text-slate-500'>Cargando datos...</p>
                        ) : connections.length === 0 ? (
                            <p className='text-sm text-slate-500'>
                                No hay conexiones registradas
                            </p>
                        ) : (
                            <div className='space-y-4'>
                                {connections.map((connection) => (
                                    <article
                                    className='rounded-lg border border-slate-200 p-4'
                                    key={connection.id}
                                >
                                    <div className='flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between'>
                                        <div>
                                            <h3 className='font-semibold'>{connection.name}</h3>
                                            <p className='text-sm text-slate-500'>
                                                {connection.provider} / {connection.project_slug}
                                            </p>
                                            <p className='text-xs text-slate-400'>
                                                Auth: {connection.auth_type} . Activa:{' '}
                                                {connection.is_active ? 'sí' : 'no'}
                                            </p>
                                        </div>

                                        <div className='flex flex-wrap gap-2'>
                                            <button
                                                className='rounded-md border border-slate-300 px-3 py-1 text-sm'
                                                disabled={isMutating}
                                                onClick={() => testMutation.mutate(connection.id)}
                                                type='button'
                                            >
                                                Probar
                                            </button>

                                            <button
                                                className='rounded-md border border-slate-300 px-3 py-1 text-sm'
                                                disabled={isMutating}
                                                onClick={() => syncMutation.mutate(connection.id)}
                                                type='button'
                                            >
                                                Sincronizar
                                            </button>

                                            {connection.is_active ? (
                                                <button
                                                    className='rounded-md border border-red-300 px-3 py-1 text-sm text-red-700'
                                                    disabled={isMutating}
                                                    onClick={() => 
                                                        deactivateMutation.mutate(connection.id)
                                                    }
                                                    type='button'
                                                >
                                                    Desactivar
                                                </button>
                                            ) : (
                                                <button
                                                    className='rounded-md border border-emeral-300 px-3 py-1 text-sm text-emerald-700'
                                                    disabled={isMutating}
                                                    onClick={() =>
                                                        activateMutation.mutate(connection.id)
                                                    }
                                                    type='button'
                                                >
                                                    Activar
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    <dl className='mt-4 grid gap-3 text-sm md:grid-cols-3'>
                                        <div>
                                            <dt className='text-slate-500'>Test</dt>
                                            <dd className='font-medium'>
                                                {connection.last_test_status}
                                            </dd>
                                        </div>

                                        <div>
                                            <dt className='text-slate-500'>Última sync</dt>
                                            <dd className='font-medium'>
                                                {formatDate(connection.last_sync_at)}
                                            </dd>
                                        </div>

                                        <div>
                                            <dt className='text-slate-500'>Estado sync</dt>
                                            <dd className='font-medium'>
                                                {connection.last_test_status}
                                            </dd>
                                        </div>

                                        <div>
                                            <dt className='text-slate-500'>Cursor</dt>
                                            <dd className='break-all text-us'>
                                                {connection.sync_cursor || '-'}
                                            </dd>
                                        </div>

                                        <div>
                                            <dt className='text-slate-500'>Por página</dt>
                                            <dd>{connection.sync_per_page}</dd>
                                        </div>

                                        <div>
                                            <dt className='text-slate-500'>Página máxima</dt>
                                            <dd>{connection.sync_max_pages}</dd>
                                        </div>
                                    </dl>
                                </article>
                            ))}
                        </div>
                    )}
                </section>
            </section>

            <section className='rounded-xl bg-white p-5 shadow-sm'>
                <div className='mb-4'>
                    <h2 className='text-lg font-semibold'>
                        Últimos logs de sincronización
                        </h2>
                    <p className='text-sm text-slate-500'>
                        Historial operativo reciente del sincronizador
                    </p>
                </div>

                {logs.length === 0 ? (
                    <p className='text-sm text-slate-500'>
                        Todavía no hay logs registrados
                    </p>
                ) : (
                    <div className='overflow-x-auto'>
                        <table className='w-full min-w-[900px] border-collapse text-sm'>
                            <thead>
                                <tr className='border-b bg-slate-50 text-left'>
                                    <th className='p-2'>Proyecto</th>
                                    <th className='p-2'>Estado</th>
                                    <th className='p-2'>Modo</th>
                                    <th className='p-2'>Obtenidos</th>
                                    <th className='p-2'>Procesados</th>
                                    <th className='p-2'>Omitidos</th>
                                    <th className='p-2'>Duración</th>
                                    <th className='p-2'>Inicio</th>
                                </tr>
                            </thead>

                            <tbody>
                                {logs.map((log) => (
                                    <tr className='border-b' key={log.id}>
                                        <td className='p-2'>{log.project_slug}</td>
                                        <td className='p-2'>{log.status}</td>
                                        <td className='p-2'>{log.mode || '-'}</td>
                                        <td className='p-2'>{log.total_entries_fetched}</td>
                                        <td className='p-2'>{log.processed_count}</td>
                                        <td className='p-2'>{log.skipped_count}</td>
                                        <td className='p-2'>{log.duration_ms}</td>
                                        <td className='p-2'>{formatDate(log.started_at)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>
        </section>
    </main>
);
}


