const DEFAULT_FETCH_TIMEOUT_MS = 15000;

function normalizeBaseUrl(baseUrl) {
    return baseUrl.replace(/\+$/, '');
}

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function buildAuthorizationHeader(authType, authToken) {
    if (authType === 'none') {
        return {};
    }

    if (authType === 'bearer') {
        return {
            Authorization: `Bearer ${authToken}`,
        };
    }

    if (authType === 'custom') {
        return {
            Authorization: authToken,
        };
    }

    return {};
}

function buildEntriesUrl(connection, options = {}) {
    const {
        page = 1,
        perPage = 500,
        filterBy = null,
        filterFrom = null,
        filterTo = null,
        sortBy = null,
        sortOrder = 'ASC',
    } = options;

    const baseUrl = normalizeBaseUrl(connection.base_url);

    const url = new URL (
        `${baseUrl}/export/entries/${connection.project_slug}`,
    );

    url.searchParams.set('per_page', String(perPage));
    url.searchParams.set('page', String(page));
    url.searchParams.set('format', 'json');

    //useLayoutEffect.searchParams.set('page', String(page));

    if (connection.form_ref) {
        url.searchParams.set('form_ref', connection.form_ref);
    }

    if (filterBy) {
        url.searchParams.set('filter_by', filterBy);
    }

    if (filterFrom) {
        url.searchParams.set('filter_from', filterFrom);
    }

    if (filterTo) {
        url.searchParams.set('filter_to', filterTo);
    }

    if (sortBy) {
        url.searchParams.set('sort_by', sortBy);
        url.searchParams.set('sort_order', sortOrder);
    }

    return url.toString();
}

function buildEntriesTestUrl(connection) {
    /*const baseUrl = normalizeBaseUrl(connection.base_url);
    const url = new URL(
        `${baseUrl}/export/entries/${connection.project_slug}`,
    );
    url.searchParams.set('per_page', '1');
    url.searchParams.set('page', '1');
    url.searchParams.set('format', 'json');
    if (connection.form_ref) {
        url.searchParams.set('form_ref', connection.form_ref);
    }
    return url.toString();
    */
   return buildEntriesUrl(connection, {
    page: 1,
    perPage: 1,
   });
}

function buildRequestHeaders(connection) {
    return {
        Accept: 'application/json',
        ...buildAuthorizationHeader(connection.auth_type, connection.auth_token),
    };
}

async function requestEpicollectJson(url, connection) {

    const timeoutMs = options.timeoutMs || DEFAULT_FETCH_TIMEOUT_MS;
    const controller = new AbortController();

    const timeoutId = setTimeout(() => {
        controller.abort();
    }, timeoutMs);

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: buildRequestHeaders(connection),
            signal: controller.signal,
        });

        let responseBody = null;

        try {
            responseBody = await response.json();
        } catch {
            responseBody = null;
        }

        if (!response.ok) {
            const error = new Error(
                `Epicollect respondió con estado HTTP ${response.status}.`,
            );

            error.code = 'EPICOLLECT_HTTP_ERROR';
            error.statusCode = response.status;
            error.responseBody = responseBody;
            error.requestUrl = url;

            throw error;
        }

        return {
            statusCode: response.status,
            body: responseBody,
        };
    } catch (error) {
        if (error.name === 'AbortError') {
            const timeoutError = new Error(
                `La solicitud a Epicollect excedióo el tiempo límite de ${timeoutMs} ms.`,
            );

            timeoutError.code = 'EPICOLLECT_TIMEOUT';
            timeoutError.statusCode = 504;
            timeoutError.requestUrl = url;

            throw timeoutError;
        }

        throw error;
    } finally {
        clearTimeout(timeoutId);
    }

    /*const response = await fetch(url, {
        method: 'GET',
        headers: buildRequestHeaders(connection),
    });

    let responseBody = null;

    try {
        responseBody = await response.json();
    } catch {
        responseBody = null;
    }

    if (!response.ok) {
        const error = new Error(
            `Epicollect respondió con estado HTTP ${response.status}.`,
        );

        error.statusCode = response.status;
        error.responseBody = responseBody;
        error.requestUrl = url;

        throw error;
    }

    return {
        statusCode: response.status,
        body: responseBody,
    };
    */
}

async function testEpicollectConnection(connection) {
    const testUrl = buildEntriesTestUrl(connection);

    const { statusCode, body } = await requestEpicollectJson(
        testUrl,
        connection,
    );

    return {
        ok: true,
        statusCode,
        testUrl,
        meta: body?.meta || null,
        entriesCount: body?.data?.entries?.length ?? null,
    };

    /*const headers = {
        Accept: 'application/json',
        ...buildAuthorizationHeader(connection.auth_type, connection.auth_token),
    };

    const response = await fetch(testUrl, {
        method: 'GET',
        headers,
    });

    let responseBody = null;

    try {
        responseBody = await response.json();
    } catch {
        responseBody = null;
    }

    if (!response.ok) {
        const error = new Error(
            `Epicollect respondió con estado HTTP ${response.status}.`,
        );

        error.statusCode = response.status;
        error.responseBody = responseBody;
        error.testUrl = testUrl;

        throw error;
    }

    return {
        ok: true,
        statusCode: response.status,
        testUrl,
        meta: responseBody?.meta || null,
        entriesCount: responseBody?.data?.entries?.length ?? null,
    };*/
}

async function fetchEpicollectEntriesPage(connection, options = {}) {
    const {
        page = 1,
        perPage = 500,
        filterBy = null,
        filterFrom = null,
        filterTo = null,
        sortBy = null,
        sortOrder = 'ASC',
    } = options;

    const url = buildEntriesUrl(connection, {
        page,
        perPage,
        filterBy,
        filterFrom,
        filterTo,
        sortBy,
        sortOrder,
    });

    const { statusCode, body } = await requestEpicollectJson(url, connection);

    return {
        statusCode,
        url,
        meta: body?.meta || null,
        links: body?.links || null,
        entries: body?.data?.entries || [],
    };
}

async function fetchAllEpicollectEntries(connection, options = {}) {
    const {
        perPage = 500, //límite
        maxPages = 10, //límite
        delayMs = 500,
        filterBy = null,
        filterFrom = null,
        filterTo = null,
        sortBy = null,
        sortOrder = 'ASC',
    } = options;

    const allEntries = [];
    const pages = [];

    let currentPage = 1;
    let lastPage = 1;

    do {
        const pageResult = await fetchEpicollectEntriesPage(connection, {
            page: currentPage,
            perPage,
            filterBy,
            filterFrom,
            filterTo,
            sortBy,
            sortOrder,
        });

        const meta = pageResult.meta || {};

        allEntries.push(...pageResult.entries);

        pages.push({
            page: currentPage,
            entriesCount: pageResult.entries.length,
            meta,
        });

        lastPage = Number(meta.last_page || currentPage);

        currentPage +=1;

        const shouldContinue = currentPate <= lastPage && currentPage <= maxPages;

        if (shouldContinue && delayMs > 0) {
            await sleep(delayMs);
        }
    } while (currentPage <= lastPage && currentPage <= maxPages);

    return {
        entries: allEntries,
        pages,
        totalEntriesFetched: allEntries.length,
        stoppedByMaxPages: currentPage <= lastPage,
    };
}

module.exports = {
    testEpicollectConnection,
    fetchAllEpicollectEntries,
};
