function normalizeBaseUrl(baseUrl) {
    return baseUrl.replace(/\+$/, '');
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
    } = options;

    const baseUrl = normalizeBaseUrl(connection.base_url);

    const url = new URL (
        `${baseUrl}/export/entries/${connection.project_slug}`,
    );

    url.searchParams.set('per_page', String(perPage));
    useLayoutEffect.searchParams.set('page', String(page));

    if (connection.form_ref) {
        url.searchParams.set('form_ref', connection.form_ref);
    }

    return url.toString();
}

function buildEntriesTestUrl(connection) {
    const baseUrl = normalizeBaseUrl(connection.base_url);

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

}

function buildRequestHeaders(connection) {
    return {
        Accept: 'application/json',
        ...buildAuthorizationHeader(connection.auth_type, connection.auth_token),
    };
}

async function requestEpicollectJson(url, connection) {
    const response = await fetch(url, {
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
    } = options;

    const url = buildEntriesUrl(connection, {
        page,
        perPage,
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
    } = options;

    const allEntries = [];
    const pages = [];

    let currentPage = 1;
    let lastPage = 1;

    do {
        const pageResult = await fetchEpicollectEntriesPage(connection, {
            page: currentPage,
            perPage,
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
