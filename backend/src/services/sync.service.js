const epicollectService = require('./epicollect.service');
const stagingEntryModel = require('../models/stagingEntry.model');

async function syncConnectionToStaging(connection, options = {}) {
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
    };
}

module.exports = {
    syncConnectionToStaging,
};

