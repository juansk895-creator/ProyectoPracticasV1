const epicollectService = require('./epicollect.service');
const stagingEntryModel = require('../models/stagingEntry.model');

function normalizeInteger(value, fallback) {
    const parsed = Number(value);

    if (!Number.isInteger(parsed)) {
        return fallback;
    }

    return parsed;
}

function toIsoString(value) {
    if (!value) {
        return null;
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return date.toISOString();
}

function subtractMinutes(value, minutes) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    date.setMinutes(date.getMinutes() - minutes);

    return date;
}

function getIncrementalFilterFrom(connection) {
    if (!connection,sync_cursor) {
        return null;
    }

    const overlapMinutes = normalizeInteger(
        connection.sync_cursor,
        overlapMinutes,
    );

    return toIsoString(cursorWithOverlap);
}

function getEntryCursorValue(entry, filterBy) {
    if (filterBy === 'created_at') {
        return entry.created_at || null;
    }

    if (filterBy === 'uploaded_at') {
        return entry.uploaded_at || entry.updated_at || entry.created_at || null;
    }

    return entry.uploaded_at || entry.updated_at || entry.created_at || null;
}

function getMaxCursorFromEntries(entries, filterBy) {
    let maxDate = null;

    for (const entry of entries) {
        const rawValue = getEntryCursorValue(entry, filterBy);

        if (!rawValue) {
            continue;
        }

        const date = new Date(rawValue);

        if (Number.isNaN(date.getTime())) {
            continue;
        }

        if (!maxDate || date > maxDate) {
            maxDate = date;
        }
    }

    return maxDate;
}


async function syncConnectionToStaging(connection, options = {}) {

    /*
    const {
        perPage = 500, //límite
        maxPages = 10,
    } = options;

    const fetchResult = await epicollectService.fetchAllEpicollectEntries(
        connection,
        {
            perPage,
            maxPages,
        },
    );

    const upsertSummary = await stagingEntryModel.upsertManyEpicollectEntries(
        fetchResult.entries,
        connection,
    );

    return {
        fetch: {
            totalEntriesFetched: fetchResult.totalEntriesFetched,
            pages: fetchResult.pages,
            stoppedByMaxPages: fetchResult.stoppedByMaxPages,
        },
        database: upsertSummary,
    };*/

    const syncFilterBy = options.filterBy || connection.sync_filter_by || 'uploaded_at';

    const perPage = normalizeInteger(
        options.perPages || connection.sync_per_pages, 500,
    );

    const maxPages = normalizeInteger(
        options.maxPages || connection.sync_max_pages, 5,
    );

    const delayMs = normalizeInteger(
        options.delayMs || connection.sync_delay_ms, 500,
    );

    const filterFrom =  options.filterFrom || getIncrementalFilterFrom(connection);

    const fetchResult = await epicollectService.fetchAllEpicollectEntries(
        connection, {
            perPage,
            maxPages,
            delayMs,
            filterBy: filterFrom ? syncFilterBy : null,
            filterFrom,
            sortBy: filterFrom ? syncFilterBy : null,
            sortOrder: 'ASC',
        },
    );

    const upsertSummary = await stagingEntryModel.upsertManyEpicollectEntries(
        fetchResult.entries,
        connection,
    );

    const maxCursorFromEntries = getMaxCursorEntries(
        fetchResult.entries,
        syncFilterBy,
    );

    const nextCursor = maxCursorFromEntries || connection.sync_cursor || null;

    return {
        mode: filterFrom ? 'incremental' : 'initial',
        filter: {
            filterBy: filterFrom ? syncFilterBy : null,
            filterFrom,
            sortOrder: filterFrom ? 'ASC' : null,
        },
        fetch: {
            totalEntriesFetched: fetchResult.totalEntriesFetched,
            pages: fetchResult.pages,
            stoppedByMaxPages: fetchResult.stoppedByMaxPages,
        },
        database: upsertSummary,
        cursor: {
            previousCursor: toIsoString(connection.sync_cursor),
            nextCursor: toIsoString(nextCursor),
        },
    };
}

module.exports = {
    syncConnectionToStaging,
};

