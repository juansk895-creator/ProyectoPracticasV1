const { assertAllowedEpicollectBase, normalizeApiBaseUrl } = require('../config/epicollect.config');
const oauthService = require('./oauth.service');
const { parseProjectHierarchy, hierarchyError } = require('./projectHierarchy.service');
const DEFAULT_FETCH_TIMEOUT_MS = 15000;
const { pause: sleep, context, checkSyncSignal } = require('./syncContext.service');
const requestGate = require('./requestGate.service');

function buildEntriesUrl(connection, options = {}) {
    const base = connection.provider === 'epicollect5'
        ? assertAllowedEpicollectBase(connection.base_url) : normalizeApiBaseUrl(connection.base_url);
    const url = new URL(`${base}/${options.rawEntries ? 'entries' : 'export/entries'}/${connection.project_slug}`);
    url.searchParams.set('per_page', String(options.perPage ?? 500));
    url.searchParams.set('page', String(options.page ?? 1));
    url.searchParams.set('format', 'json');
    if (options.formRef || connection.form_ref) url.searchParams.set('form_ref', options.formRef || connection.form_ref);
    if (options.branchRef) url.searchParams.set('branch_ref', options.branchRef);
    if (options.mapIndex !== null && options.mapIndex !== undefined) url.searchParams.set('map_index', String(options.mapIndex));
    for (const [key, value] of Object.entries({ filter_by: options.filterBy, filter_from: options.filterFrom,
        filter_to: options.filterTo, sort_by: options.sortBy })) {
        if (value) url.searchParams.set(key, value);
    }
    if (options.sortBy) url.searchParams.set('sort_order', options.sortOrder || 'ASC');
    return url.toString();
}

async function requestOnce(url, connection, token, options) {
    await requestGate.waitForRequest(url);
    checkSyncSignal();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_FETCH_TIMEOUT_MS);
    const headers = { Accept: 'application/json' };
    if (connection.auth_type === 'oauth2' || connection.auth_type === 'bearer') headers.Authorization = `Bearer ${token}`;
    else if (connection.auth_type === 'custom') headers.Authorization = token;
    try {
        const outerSignal = context.getStore()?.signal;
        const response = await fetch(url, { method: 'GET', headers,
            signal: outerSignal ? AbortSignal.any([outerSignal, controller.signal]) : controller.signal, redirect: 'error' });
        if (!response.ok) {
            const retryAt = response.status === 429 ? oauthService.retryTimestamp(response.headers.get('retry-after')) : null;
            await response.body?.cancel();
            if (retryAt) await requestGate.deferRequests(url, retryAt);
            throw Object.assign(new Error(`Epicollect respondió con HTTP ${response.status}.`),
                { code: 'EPICOLLECT_HTTP_ERROR', statusCode: response.status, retryAt });
        }
        let body;
        try { body = await response.json(); }
        catch { throw Object.assign(new Error('Epicollect devolvió una respuesta no válida.'), { code: 'EPICOLLECT_RESPONSE_INVALID' }); }
        const lastPage = body?.meta?.last_page;
        if (options.responseType !== 'project' && (!body || !Array.isArray(body.data?.entries) || !body.meta ||
            !['number', 'string'].includes(typeof lastPage) || String(lastPage).trim() === '' ||
            !Number.isSafeInteger(Number(lastPage)) || Number(lastPage) < 0 ||
            (Number(lastPage) === 0 && body.data.entries.length > 0))) {
            throw Object.assign(new Error('Epicollect devolvió una respuesta incompleta.'), { code: 'EPICOLLECT_RESPONSE_INVALID' });
        }
        return { statusCode: response.status, body };
    } catch (error) {
        checkSyncSignal();
        if (controller.signal.aborted) throw Object.assign(new Error('La solicitud a Epicollect excedió el tiempo límite.'),
            { code: 'EPICOLLECT_TIMEOUT', statusCode: 504 });
        throw error;
    } finally { clearTimeout(timeout); }
}

async function requestEpicollectJson(url, connection, options = {}) {
    let token = connection.auth_type === 'oauth2' ? await oauthService.getAccessToken(connection) : connection.auth_token;
    try {
        return await requestOnce(url, connection, token, options);
    } catch (error) {
        if (connection.auth_type !== 'oauth2' || error.code !== 'EPICOLLECT_HTTP_ERROR' || error.statusCode !== 401) throw error;
        // Una sola renovación y una sola repetición de esta página. Un 403 no se renueva.
        token = await oauthService.getAccessToken(connection, { rejectedToken: token });
        try { return await requestOnce(url, connection, token, options); }
        catch (retryError) {
            if (retryError.code === 'EPICOLLECT_HTTP_ERROR' && retryError.statusCode === 401) {
                await oauthService.invalidateRejectedToken(connection, token);
            }
            throw retryError;
        }
    }
}

async function testEpicollectConnection(connection) {
    const graph = await fetchProjectHierarchy(connection);
    const stream = connection.form_ref ? graph.streams.find((item) => item.form_ref === connection.form_ref) : graph.streams[0];
    if (!stream) throw hierarchyError('EPICOLLECT_FORM_UNKNOWN', 'El formulario no aparece en el proyecto.');
    const testUrl = buildEntriesUrl(connection, { page: 1, perPage: 1, formRef: stream.native_form_ref, branchRef: stream.branch_ref });
    const { statusCode, body } = await requestEpicollectJson(testUrl, connection);
    return { ok: true, statusCode, testUrl, meta: body.meta, entriesCount: body.data.entries.length };
}

async function fetchProjectHierarchy(connection) {
    if (connection.provider === 'custom') {
        if (!connection.form_ref) throw hierarchyError('EPICOLLECT_FORM_UNKNOWN', 'Indica un formulario para la conexión personalizada.');
        return parseProjectHierarchy({ meta: { sedecollect_source: 'custom' }, data: { project: { slug: connection.project_slug,
            forms: [{ ref: connection.form_ref, inputs: [] }] } } }, connection.project_slug);
    }
    const base = assertAllowedEpicollectBase(connection.base_url);
    const { body } = await requestEpicollectJson(`${base}/export/project/${connection.project_slug}`, connection, { responseType: 'project' });
    return parseProjectHierarchy(body, connection.project_slug);
}

async function fetchAllEpicollectEntries(connection, options = {}) {
    const { perPage = 500, maxPages = 10, delayMs = 500 } = options;
    const allEntries = [];
    const pages = [];
    let page = 1;
    let lastPage = 1;
    do {
        const url = buildEntriesUrl(connection, { ...options, perPage, page });
        const { body } = await requestEpicollectJson(url, connection, options);
        const entries = body.data.entries;
        allEntries.push(...entries);
        pages.push({ page, entriesCount: entries.length, meta: body.meta });
        lastPage = Number(body.meta.last_page);
        page += 1;
        if (page <= lastPage && page <= maxPages && delayMs > 0) await sleep(delayMs);
    } while (page <= lastPage && page <= maxPages);
    return { entries: allEntries, pages, totalEntriesFetched: allEntries.length, stoppedByMaxPages: page <= lastPage };
}

module.exports = { testEpicollectConnection, fetchAllEpicollectEntries, fetchProjectHierarchy };
