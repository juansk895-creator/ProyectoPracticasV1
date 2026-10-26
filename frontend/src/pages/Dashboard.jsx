import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getDashboard } from '../services/dashboard.service';

const STATUS = { success: 'Correcta', failed: 'Fallida', partial: 'Parcial' };
const VALIDATION = { unvalidated: 'Sin validar', validated: 'Validado', rejected: 'Rechazado' };
const number = (value) => new Intl.NumberFormat('es-MX').format(value);
const day = (value) => value.split('-').reverse().join('/');

function Metric({ label, value, description }) {
    return <div className='rounded-xl border border-slate-200 bg-white p-5'>
        <p className='text-sm text-slate-600'>{label}</p>
        <p className='mt-2 text-3xl font-semibold text-slate-900'>{value}</p>
        <p className='mt-2 text-sm text-slate-500'>{description}</p>
    </div>;
}

export default function Dashboard() {
    const [days, setDays] = useState(7);
    const query = useQuery({ queryKey: ['dashboard', days], queryFn: () => getDashboard(days) });
    const data = query.data?.data;

    return <main className='mx-auto max-w-7xl space-y-6 px-6 py-8'>
        <div className='flex flex-wrap items-end justify-between gap-4'>
            <div>
                <h1 className='text-2xl font-semibold text-slate-900'>Cuadro de mando</h1>
                <p className='mt-1 text-sm text-slate-600'>Estado general de los datos y de las sincronizaciones.</p>
            </div>
            <div className='flex flex-wrap items-end gap-3'>
                <label className='text-sm text-slate-700'>Período del historial
                    <select className='ml-2 rounded-lg border border-slate-300 bg-white px-3 py-2'
                        value={days} onChange={(event) => setDays(Number(event.target.value))}>
                        {[7, 30, 90].map((value) => <option key={value} value={value}>Últimos {value} días</option>)}
                    </select>
                </label>
                <button type='button' disabled={query.isFetching} onClick={() => query.refetch()}
                    className='rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50'>
                    {query.isFetching ? 'Actualizando…' : 'Actualizar'}
                </button>
            </div>
        </div>

        {query.isPending && <p role='status'>Consultando el estado de la operación…</p>}
        {query.isError && <p role='alert' className='rounded-lg border border-red-200 bg-red-50 p-4 text-red-800'>
            No fue posible actualizar el cuadro de mando. Intenta nuevamente.
            {data && ' Se muestran los últimos datos consultados.'}
        </p>}

        {data && <>
            <p className='text-sm text-slate-500'>Última consulta: {new Date(data.generatedAt).toLocaleString('es-MX')}.
                {' '}Los totales de almacenamiento incluyen todos los proyectos y todo el histórico.</p>
            <section aria-label='Estado del almacenamiento' className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
                <Metric label='Registros almacenados' value={number(data.staging.total)}
                    description={`Principales: ${number(data.staging.forms)} · Hijos: ${number(data.staging.children)} · Ramas: ${number(data.staging.branches)}`} />
                <Metric label='Registros sin validar' value={number(data.staging.unvalidated)} description='Pendientes de revisión.' />
                <Metric label='Conexiones activas' value={number(data.connections.active)} description={`Total de conexiones: ${number(data.connections.total)}.`} />
                <Metric label='Registros consolidados' value='Pendiente' description='La consolidación al almacén final aún no está habilitada.' />
            </section>
            {data.staging.pendingParents > 0 && <p role='status' className='rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900'>
                {number(data.staging.pendingParents)} {data.staging.pendingParents === 1 ? 'registro tiene' : 'registros tienen'} un padre pendiente de recuperar. Revisa las sincronizaciones de los formularios correspondientes.
            </p>}
            <section className='rounded-xl border border-slate-200 bg-white p-5' aria-labelledby='validation-title'>
                <h2 id='validation-title' className='font-semibold text-slate-900'>Estados de validación registrados</h2>
                {data.validation.length === 0 ? <p className='mt-3 text-sm text-slate-600'>Todavía no hay registros almacenados.</p>
                    : <dl className='mt-3 flex flex-wrap gap-6'>{data.validation.map((item) => <div key={item.status}>
                        <dt className='text-sm text-slate-600'>{VALIDATION[item.status] || item.status}</dt>
                        <dd className='text-xl font-semibold'>{number(item.total)}</dd>
                    </div>)}</dl>}
            </section>

            <section aria-labelledby='sync-title' className='space-y-4'>
                <div>
                    <h2 id='sync-title' className='text-xl font-semibold text-slate-900'>Sincronizaciones del período</h2>
                    <p className='mt-1 text-sm text-slate-600'>Del {day(data.period.from)} al {day(data.period.through)}, incluido hoy, según el calendario del historial del servidor.</p>
                </div>
                <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
                    <Metric label='Corridas registradas' value={number(data.sync.runs)}
                        description={`Correctas: ${number(data.sync.successful)} · Fallidas: ${number(data.sync.failed)} · Parciales: ${number(data.sync.partial)}`} />
                    <Metric label='Registros procesados' value={number(data.sync.processed)} description='Incluye registros reprocesados en distintas corridas.' />
                    <Metric label='Registros omitidos' value={number(data.sync.skipped)} description={`De ${number(data.sync.fetched)} registros descargados.`} />
                    <Metric label='Ritmo de procesamiento' value={data.sync.recordsPerSecond === null ? '—' : `${number(data.sync.recordsPerSecond)} reg/s`}
                        description='Procesados ÷ duración total de las corridas registradas. Incluye descargas y esperas.' />
                </div>
                <div className='max-h-96 overflow-auto rounded-xl border border-slate-200 bg-white' tabIndex={0} aria-label='Tabla de actividad diaria con desplazamiento'>
                    <table className='w-full text-left text-sm'>
                        <caption className='p-4 text-left font-semibold'>Actividad diaria</caption>
                        <thead className='sticky top-0 bg-slate-50'><tr>{['Fecha', 'Corridas', 'Correctas', 'Fallidas', 'Parciales', 'Procesados'].map((label) => <th key={label} scope='col' className='px-4 py-3'>{label}</th>)}</tr></thead>
                        <tbody>{data.daily.map((item) => <tr key={item.day} className='border-t border-slate-100'>
                            <th scope='row' className='whitespace-nowrap px-4 py-3 font-normal'>{day(item.day)}</th>
                            {[item.runs, item.successful, item.failed, item.partial, item.processed].map((value, index) => <td key={index} className='px-4 py-3'>{number(value)}</td>)}
                        </tr>)}</tbody>
                    </table>
                </div>
            </section>

            <section className='rounded-xl border border-slate-200 bg-white p-5' aria-labelledby='recent-title'>
                <h2 id='recent-title' className='text-xl font-semibold text-slate-900'>Últimas 20 corridas del período</h2>
                <p className='mt-1 text-sm text-slate-600'>Las fechas de las corridas conservan la hora registrada en el servidor.</p>
                {data.recent.length === 0 && <p className='mt-4 text-sm text-slate-600'>No hay sincronizaciones registradas en este período.</p>}
                <ul className='mt-4 divide-y divide-slate-200'>{data.recent.map((run) => <li key={run.id} className='py-4'>
                    <div className='flex flex-wrap justify-between gap-2'>
                        <p className='font-medium text-slate-900'>{run.connection_name} · {run.project_slug}</p>
                        <p className={run.status === 'failed' ? 'font-medium text-red-700' : 'font-medium text-slate-700'}>{STATUS[run.status] || run.status}</p>
                    </div>
                    <p className='mt-1 text-sm text-slate-600'>{run.started_at} · {number(run.duration_ms / 1000)} s · {number(run.processed_count)} procesados · {number(run.skipped_count)} omitidos</p>
                    {run.error_message && <p className='mt-2 text-sm text-red-700'>{run.error_message}</p>}
                    <details className='mt-2 text-sm text-slate-600'>
                        <summary className='cursor-pointer'>Ver detalles de la corrida</summary>
                        <dl className='mt-2 space-y-1 break-all'>
                            <div><dt className='inline font-medium'>Identificador: </dt><dd className='inline'>{run.id}</dd></div>
                            <div><dt className='inline font-medium'>Modo: </dt><dd className='inline'>{run.mode === 'initial' ? 'Inicial' : run.mode === 'incremental' ? 'Incremental' : 'No determinado'}</dd></div>
                            <div><dt className='inline font-medium'>Fin: </dt><dd className='inline'>{run.finished_at}</dd></div>
                            <div><dt className='inline font-medium'>Marcador anterior: </dt><dd className='inline'>{run.cursor_before || 'Sin marcador'}</dd></div>
                            <div><dt className='inline font-medium'>Marcador posterior: </dt><dd className='inline'>{run.cursor_after || 'Sin marcador'}</dd></div>
                            {run.error_code && <div><dt className='inline font-medium'>Código de incidencia: </dt><dd className='inline'>{run.error_code}</dd></div>}
                        </dl>
                    </details>
                </li>)}</ul>
            </section>
        </>}
    </main>;
}
