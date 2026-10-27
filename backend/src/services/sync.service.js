const pool = require('../config/db');
const epicollect = require('./epicollect.service');
const staging = require('../models/stagingEntry.model');
const { hierarchyError } = require('./projectHierarchy.service');
const { compileProjectFields } = require('./projectSchema.service');
const { pause, checkSyncSignal } = require('./syncContext.service');

function maxCursor(entries, field, previous) {
    let latest = previous ? new Date(previous) : null;
    for (const entry of entries) {
        const raw = entry[field] || (field === 'uploaded_at' ? entry.updated_at || entry.created_at : null);
        if (!raw) continue;
        const date = new Date(raw);
        if (!Number.isFinite(date.getTime())) throw hierarchyError('STAGING_ENTRY_INVALID', 'Una fecha de sincronización no es válida.');
        if (!latest || date > latest) latest = date;
    }
    return latest?.toISOString() || null;
}

async function syncConnectionToStaging(connection, options = {}) {
    const graph = await epicollect.fetchProjectHierarchy(connection);
    const { mapIndex } = compileProjectFields(graph.definition);
    const streams = connection.form_ref ? graph.streams.filter((item) => item.form_ref === connection.form_ref) : graph.streams;
    if (!streams.length) throw hierarchyError('EPICOLLECT_FORM_UNKNOWN', 'El formulario no aparece en el proyecto.');
    const saved = await pool.query('SELECT form_ref, sync_cursor FROM connection_streams WHERE connection_id = $1', [connection.id]);
    const filterBy = options.filterBy ?? connection.sync_filter_by ?? 'uploaded_at';
    const perPage = options.perPage ?? connection.sync_per_page ?? 500;
    const maxPages = options.maxPages ?? connection.sync_max_pages ?? 5;
    const delayMs = options.delayMs ?? connection.sync_delay_ms ?? 500;
    const overlapMs = (connection.sync_overlap_minutes ?? 5) * 60000;
    const downloads = [];
    for (const stream of streams) {
        const previousCursor = saved.rows.find((item) => item.form_ref === stream.form_ref)?.sync_cursor || null;
        const filterFrom = options.filterFrom ?? (previousCursor ? new Date(new Date(previousCursor).getTime() - overlapMs).toISOString() : null);
        await pause(delayMs);
        const fetched = await epicollect.fetchAllEpicollectEntries(connection, {
            perPage, maxPages, delayMs, formRef: stream.native_form_ref, branchRef: stream.branch_ref, mapIndex,
            filterBy: filterFrom ? filterBy : null, filterFrom, sortBy: filterBy, sortOrder: 'ASC',
        });
        if (fetched.stoppedByMaxPages) throw hierarchyError('SYNC_PAGE_LIMIT', 'Quedan páginas por descargar. Aumenta el máximo de páginas de la conexión.');
        downloads.push({ stream, ...fetched, previousCursor, filterFrom,
            nextCursor: maxCursor(fetched.entries, filterBy, previousCursor) });
    }
    checkSyncSignal();
    const database = await staging.persistHierarchy(connection, graph, downloads);
    const cursors = downloads.map((item) => item.nextCursor).filter(Boolean).sort();
    return {
        mode: downloads.some((item) => item.previousCursor) ? 'incremental' : 'initial',
        filter: { filterBy: downloads.some((item) => item.filterFrom) ? filterBy : null,
            filterFrom: downloads[0].filterFrom, sortOrder: 'ASC' },
        fetch: { totalEntriesFetched: database.received, stoppedByMaxPages: false,
            pages: downloads.flatMap((item) => item.pages.map((page) => ({ ...page, form_ref: item.stream.form_ref }))),
            streams: downloads.map((item) => ({ form_ref: item.stream.form_ref, record_type: item.stream.record_type,
                entries: item.totalEntriesFetched, previousCursor: item.previousCursor,
                nextCursor: item.nextCursor, filterFrom: item.filterFrom })) },
        database,
        cursor: { previousCursor: connection.sync_cursor ? new Date(connection.sync_cursor).toISOString() : null,
            nextCursor: cursors[0] || null },
    };
}

module.exports = { syncConnectionToStaging };
