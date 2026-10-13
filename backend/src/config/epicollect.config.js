const DEFAULT_API = 'https://five.epicollect.net/api';

function normalizeApiBaseUrl(value) {
    try {
        if (typeof value !== 'string' || value.length > 2048) throw new Error();
        const url = new URL(value.trim());
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
            /%2f|%5c/i.test(url.pathname)) throw new Error();
        return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
    } catch {
        throw Object.assign(new Error('La URL debe usar HTTPS y no incluir credenciales, parámetros ni fragmentos.'),
            { code: 'EPICOLLECT_URL_INVALID' });
    }
}

function getAllowedApiBases() {
    const values = process.env.EPICOLLECT_API_BASE_URLS ?? DEFAULT_API;
    try {
        const result = values.split(',').map(normalizeApiBaseUrl);
        if (!result.length) throw new Error();
        return new Set(result);
    } catch {
        throw Object.assign(new Error('Revisa EPICOLLECT_API_BASE_URLS en la configuración del backend.'),
            { code: 'EPICOLLECT_CONFIG_INVALID' });
    }
}

function assertAllowedEpicollectBase(value) {
    const base = normalizeApiBaseUrl(value);
    if (!getAllowedApiBases().has(base)) {
        throw Object.assign(new Error('El servidor de Epicollect5 no está autorizado en la configuración del backend.'),
            { code: 'EPICOLLECT_BASE_DENIED' });
    }
    return base;
}

module.exports = { normalizeApiBaseUrl, getAllowedApiBases, assertAllowedEpicollectBase };
