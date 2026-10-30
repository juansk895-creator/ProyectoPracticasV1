import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getConnections } from '../services/apiManager.service';
import { getAudit, refreshAudit } from '../services/audit.service';
import VirtualizedDataTable from '../components/VirtualizedDataTable';

const INITIAL = { surveyor_id: '', date_from: '', date_to: '', date_field: 'created_at_epicollect', validation_status: '', audit_status: '' };
const AUDIT_LABELS = { identified: 'Identificado', anonymous: 'Anónimo en el origen', pending: 'Pendiente de consultar', stale: 'Requiere nueva consulta' };
const VALIDATION_LABELS = { unvalidated: 'Sin validar', validated: 'Validado', approved: 'Aprobado', rejected: 'Rechazado' };
const TECHNICAL = [
    { key: 'surveyor_id', label: 'ID del encuestador' },
    { key: 'surveyor_name', label: 'Nombre en directorio' },
    { key: 'audit_status_label', label: 'Estado de auditoría' },
    { key: 'created_at_epicollect', label: 'Fecha de captura', type: 'datetime' },
    { key: 'uploaded_at_epicollect', label: 'Fecha de carga', type: 'datetime' },
    { key: 'validation_status_label', label: 'Estado de validación' },
    { key: 'record_type', label: 'Tipo de registro' },
    { key: 'form_ref', label: 'Formulario' },
    { key: 'entry_uuid', label: 'Identificador del registro' },
    { key: 'audit_checked_at', label: 'Última consulta de identidad', type: 'datetime' },
];
const inputClass = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
const buttonClass = 'rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium disabled:opacity-40';

function AuditPanel({ connection }) {
    const client = useQueryClient();
    const [draft, setDraft] = useState(INITIAL);
    const [filters, setFilters] = useState(INITIAL);
    const [page, setPage] = useState(1);
    const [showHidden, setShowHidden] = useState(false);
    const query = useQuery({ queryKey: ['audit', connection.id, filters, page],
        queryFn: () => getAudit(connection.id, { ...filters, page, page_size: 50 }) });
    const refresh = useMutation({ mutationFn: () => refreshAudit(connection.id),
        onSuccess: () => client.invalidateQueries({ queryKey: ['audit', connection.id] }) });
    const data = query.data?.data;
    const summary = data?.summary;
    const rows = (data?.rows || []).map((row) => ({ ...row, audit_status_label: AUDIT_LABELS[row.audit_status],
        validation_status_label: VALIDATION_LABELS[row.validation_status] || row.validation_status }));
    const setField = (field) => (event) => setDraft((old) => ({ ...old, [field]: event.target.value }));
    const errorMessage = query.error?.message || refresh.error?.message;
    return <>
        <section className='flex flex-wrap items-center justify-between gap-4 rounded-xl bg-white p-5 shadow-sm'>
            <div><h2 className='font-semibold'>Identidad de los registros</h2>
                <p className='mt-1 max-w-3xl text-sm text-slate-600'>Consulta quién capturó cada registro. Las identidades se comprueban por separado de las respuestas; los nombres requieren un directorio autorizado del proyecto.</p>
            </div>
            <button className={buttonClass} type='button' disabled={refresh.isPending || !connection.is_active}
                onClick={() => refresh.mutate()}>{refresh.isPending ? 'Consultando identidad…' : 'Actualizar identidades'}</button>
        </section>
        <div aria-live='polite'>
            {errorMessage && <p role='alert' className='rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950'>{errorMessage}</p>}
            {refresh.isSuccess && <p className='rounded-lg bg-emerald-50 p-4 text-sm text-emerald-900'>Consulta terminada: {refresh.data.data.matched} registros vinculados; {refresh.data.data.unmatched} sin coincidencia de registro y versión. Los registros sin coincidencia requieren sincronizar las respuestas y volver a consultar.</p>}
        </div>
        <form className='grid gap-4 rounded-xl bg-white p-5 shadow-sm sm:grid-cols-2 lg:grid-cols-3' onSubmit={(event) => { event.preventDefault(); setFilters({ ...draft }); setPage(1); }}>
            <label className='text-sm'>ID del encuestador<input className={inputClass} inputMode='numeric' pattern='[0-9]{1,20}' placeholder='Todos' value={draft.surveyor_id} onChange={setField('surveyor_id')} /></label>
            <label className='text-sm'>Fecha que se consulta<select className={inputClass} value={draft.date_field} onChange={setField('date_field')}><option value='created_at_epicollect'>Captura en campo</option><option value='uploaded_at_epicollect'>Carga al servidor</option></select></label>
            <label className='text-sm'>Desde (UTC)<input className={inputClass} type='date' value={draft.date_from} onChange={setField('date_from')} /></label>
            <label className='text-sm'>Hasta, inclusive (UTC)<input className={inputClass} type='date' min={draft.date_from || undefined} value={draft.date_to} onChange={setField('date_to')} /></label>
            <label className='text-sm'>Estado de validación<select className={inputClass} value={draft.validation_status} onChange={setField('validation_status')}><option value=''>Todos</option>{(data?.validation_statuses || []).map((s) => <option value={s} key={s}>{VALIDATION_LABELS[s] || s}</option>)}</select></label>
            <label className='text-sm'>Estado de auditoría<select className={inputClass} value={draft.audit_status} onChange={setField('audit_status')}><option value=''>Todos</option>{Object.entries(AUDIT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <div className='flex flex-wrap gap-2 sm:col-span-2 lg:col-span-3'><button className='rounded-lg bg-slate-900 px-4 py-2 text-sm text-white' type='submit'>Aplicar filtros</button><button className={buttonClass} type='button' onClick={() => { setDraft(INITIAL); setFilters(INITIAL); setPage(1); }}>Limpiar filtros</button><button className={buttonClass} type='button' onClick={() => query.refetch()}>Actualizar vista</button></div>
        </form>
        {query.isPending && <p role='status'>Cargando auditoría…</p>}
        {summary && <>
            <section className='grid gap-3 sm:grid-cols-3 lg:grid-cols-6' aria-label='Resumen de los filtros aplicados'>
                {[['Registros', summary.total], ['Encuestadores identificados', summary.surveyors], ['Con identidad', summary.identified], ['Anónimos en el origen', summary.anonymous], ['Pendientes', summary.pending], ['Requieren nueva consulta', summary.stale]].map(([label, value]) => <div key={label} className='rounded-xl bg-white p-4 shadow-sm'><p className='text-sm text-slate-600'>{label}</p><p className='mt-2 text-2xl font-semibold'>{value}</p></div>)}
            </section>
            <section className='rounded-xl bg-white p-5 shadow-sm'>
                <h2 className='text-lg font-semibold'>Capturas por encuestador</h2><p className='mb-4 text-sm text-slate-600'>Conteos de filas almacenadas según los filtros aplicados. Formularios hijos y ramas se cuentan por separado; estos conteos no miden calidad ni productividad.</p>
                {data.surveyors.length === 0 ? <p className='text-sm text-slate-500'>No hay identidades verificadas que coincidan con esta consulta.</p> : <div className='overflow-auto'><table className='w-full text-left text-sm'><thead><tr>{['Encuestador', 'Principal', 'Hijos', 'Ramas', 'Total'].map((label) => <th className='border-b p-3' scope='col' key={label}>{label}</th>)}</tr></thead><tbody>{data.surveyors.map((s) => <tr key={s.surveyor_id}><td className='border-b p-3'><button type='button' className='text-left font-medium text-blue-700 underline' onClick={() => { const next = { ...filters, surveyor_id: s.surveyor_id }; setDraft(next); setFilters(next); setPage(1); }}>{s.surveyor_name || `Encuestador ${s.surveyor_id}`} <span className='font-normal text-slate-500'>(ID {s.surveyor_id})</span></button></td>{[s.main_records,s.child_records,s.branch_records,s.records].map((n,i) => <td className='border-b p-3' key={i}>{n}</td>)}</tr>)}</tbody></table></div>}
                {summary.surveyors > data.surveyor_limit && <p className='mt-3 text-sm'>Se muestran los {data.surveyor_limit} encuestadores con más filas. Consulta cualquier otro mediante su ID.</p>}
            </section>
            <section className='rounded-xl bg-white p-5 shadow-sm'><div className='mb-4 flex flex-wrap justify-between gap-3'><div><h2 className='text-lg font-semibold'>Registros auditados</h2><p className='text-sm text-slate-500'>Las fechas de la tabla se muestran en la hora local del navegador.</p></div><label className='text-sm'><input type='checkbox' checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Mostrar preguntas ocultas</label></div>
                {rows.length ? <VirtualizedDataTable columns={[...TECHNICAL, ...data.columns.filter((c) => showHidden || !c.hidden)]} rows={rows} resetKey={JSON.stringify([connection.id, filters, page])} /> : <p>No hay registros que coincidan con los filtros.</p>}
                <footer className='mt-4 flex flex-wrap items-center justify-between gap-3'><p className='text-sm'>Página {page} de {data.pagination.total_pages || 1} · {summary.total} registros</p><div className='flex gap-2'><button className={buttonClass} type='button' disabled={page <= 1 || query.isFetching} onClick={() => setPage((p) => p - 1)}>Anterior</button><button className={buttonClass} type='button' disabled={page >= data.pagination.total_pages || query.isFetching} onClick={() => setPage((p) => p + 1)}>Siguiente</button></div></footer>
            </section>
        </>}
    </>;
}
export default function SurveyAudit() {
    const [selected, setSelected] = useState('');
    const connections = useQuery({ queryKey: ['api-connections'], queryFn: getConnections });
    const items = connections.data?.data || [];
    const connection = items.find((c) => c.id === selected) || items[0];
    return <main className='mx-auto max-w-7xl space-y-5 px-6 py-8'>
        <header><h1 className='text-2xl font-semibold text-slate-900'>Auditoría por encuestador</h1><p className='mt-1 text-slate-600'>Trazabilidad de capturas y seguimiento de su validación.</p></header>
        {connections.isError && <p role='alert'>{connections.error.message}</p>}
        {connections.isPending ? <p>Cargando conexiones…</p> : !connection ? <p>Registra y sincroniza una conexión para comenzar.</p> : <>
            <label className='block rounded-xl bg-white p-5 text-sm shadow-sm'>Conexión<select className={inputClass} value={connection.id} onChange={(e) => setSelected(e.target.value)}>{items.map((c) => <option value={c.id} key={c.id}>{c.name} · {c.project_slug}</option>)}</select></label>
            <AuditPanel key={connection.id} connection={connection} />
        </>}
    </main>;
}
