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
                        <p className='mt-2 text-3xl font-bold'>{}</p>
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


                    </form>

                    
                </section>
            </section>
        </main>
    );
}






