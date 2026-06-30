const ALLOWED_PROVIDERS = new Set(['epicollect5', 'custom']);
const ALLOWED_AUTH_TYPES = new Set(['bearer', 'custom', 'none']);
const ALLOWED_SYNC_FILTERS = new Set(['created_at', 'uploaded_at']);

function normalizeOptionalString(value) {
    if (value === undefined) {
        return undefined;
    }

    if (value === null) {
        return null;
    }

    const normalized = String(value).trim();

    return normalized.length > 0 ? normalized : null;
}

function isLocalOrPrivateHost(hostname) {
    const host = hostname.toLowerCase();

    if ( host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' ||
        host === '::1' || host.endsWith('.local')) {
        return true;
    }

    const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);

    if (!ipv4Match) {
        return false;
    }

    const octets = ipv4Match.slice(1).map(Number);
    const [a, b] = octets;

    if (octets.some((octet) => octet < 0 || octet > 255)) {
        return true;
    }

    return (
        a === 10 || a === 127 ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 169 && b === 254)
    );
}

function normalizeBaseUrl(value, provider, errors) {
    const rawUrl = normalizeOptionalString(value);

    if (!rawUrl) {
        errors.push({
            fields: 'base_url',
            message: 'El campo base_url es obligatorio',
        });

        return null;
    }

    let parsedUrl;

    try {
        parsedUrl = new URL(rawUrl);
    } catch {
        errors.push({
            field: 'base_url',
            message: 'El campo base_url debe ser una URL válida',
        });

        return null;
    }

    if (parsedUrl.protocol !== 'https:') {
        errors.push({
            field: 'base_url',
            message: 'El campo base_url debe usar HTTPS',
        });
    }

    if (isLocalOrPrivateHost(parsedUrl.hostname)) {
        errors.push({
            field: 'base_url',
            message: 'No se permiten URLs locales o privadas como base_url.',
        });
    }

    const normalizedUrl = `${parsedUrl.origin}${parsedUrl.pathname}`.replace(/\/+$/,'',);

    if (provider === 'epicollect5' && normalizedUrl !== 'https://five.epicollect.net/api') {
        errors.push({
            field: 'base_url',
            message: 'Para provider epicollect5, base_url debe ser https://five.epicollect.net/api.',
        });
    }
    return normalizedUrl;
}

function validateEnum(value, allowedValues, field, errors) {
    if (!allowedValues.has(value)) {
        errors.push({
            field,
            message: `Valor no permitido para ${field}.`,
        });
    }
    return value;
}

function validateProjectSlug(value, errors, required = true) {
    const projectSlug = normalizeOptionalString(value);

    if (!projectSlug) {
        if (required) {
            errors.push({
                field: 'project_slug',
                message: 'El campo project_slug es obligatorio',
            });
        }
        return projectSlug;
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(projectSlug)) {
        errors.push({
            field: 'project_slug',
            message: 'El campo project_slug solo debe contener letras, números, guiones y guiones bajos.',
        });
    }
    return projectSlug;
}

function validateIntegerRange(payload, field, min, max, errors) {
    if (payload[field] === undefined) {
        return undefined;
    }

    const value = Number(payload[field]);

    if (!Number.isInteger(value) || value < min || value > max) {
        errors.push({
            field,
            message: `El campo ${field} debe ser un entero entre ${min} y ${max}.`,
        });
        return undefined;
    }
    return value;
}

function validateBoolean(payload, field, errors) {
    if (payload[field] === undefined) {
        return undefined;
    }

    if (typeof payload[field] !== 'boolean') {
        errors.push({
            field,
            message: `El campo ${field} debe ser boolean,`,
        });
        return undefined;
    }

    return payload[field];
}

function validateCreateConnection(payload = {}) {
    const errors = [];
    const data = {};

    const name = normalizeOptionalString(payload.name);

    if (!name) {
        errors.push({
            field: 'name',
            message: 'El campo name es obligatorio',
        });
    } else {
        data.name = name;
    }

    const provider = payload.provider || 'epicollect5';
    data.provider = validateEnum(provider, ALLOWED_PROVIDERS, 'provider', errors);

    const projectSlug = validateProjectSlug(payload.project_slug, errors, true);

    if (projectSlug) {
        data.project_slug = projectSlug;
    }

    const formRef = normalizeOptionalString(payload.form_ref);
    data.form_ref = formRef || null;

    const baseUrl = normalizeBaseUrl(payload.base_url, provider, errors);

    if (baseUrl) {
        data.base_url = baseUrl;
    }

    const authType = payload.auth_type || 'bearer';
    data.auth_type = validateEnum(authType, ALLOWED_AUTH_TYPES, 'auth_type', errors);

    const authToken = normalizeOptionalString(payload.auth_token);

    if (authType !== 'none' && !authToken) {
        errors.push({
            field: 'auth_token',
            message: 'El campo auth_token es obligatorio para bearer o custom.',
        });
    }

    data.auth_token = authToken || 'NO_AUTH_REQUIRED';

    const isActive = validateBoolean(payload, 'is_active', errors);
    data.is_active = isActive === undefined ? true : isActive;

    const syncFilterBy = payload.sync_filter_by || 'uploaded_at';
    data.sync_filter_by = validateEnum(
        syncFilterBy,
        ALLOWED_SYNC_FILTERS,
        'sync_filter_by',
        errors,
    );

    const syncPerPage = validateIntegerRange(
        payload,
        'sync_per_page',
        1,
        1000,
        errors,
    );

    if (syncPerPage !== undefined) {
        data.sync_per_page = syncPerPage;
    }

    const syncMaxPages = validateIntegerRange(
        payload,
        'sync_max_pages',
        1,
        100,
        errors,
    );

    if (syncMaxPages !== undefined) {
        data.sync_max_pages = syncMaxPages;
    }

    const syncDelayMs = validateIntegerRange(
        payload,
        'sync_delay_ms',
        0,
        60000,
        errors,
    );

    if (syncDelayMs !== undefined) {
        data.sync_delay_ms = syncDelayMs;
    }

    const syncOverlapMinutes = validateIntegerRange(
        payload,
        'sync_overlap_minutes',
        0,
        1440,
        errors,
    );

    if (syncOverlapMinutes !== undefined) {
        data.sync_overlap_minutes = syncOverlapMinutes;
    }

    return {
        isValid: errors.length === 0,
        errors,
        data,
    };
}

function validateUpdateConnection(payload = {}) {
    const errors = [];
    const data = {};

    if (payload.name !== undefined) {
        const name = normalizeOptionalString(payload.name);

        if (!name) {
            errors.push({
                field: 'name',
                message: 'El campo name no puede estar vacío',
            });
        } else {
            data.name = name;
        }
    }

    if (payload.provider !== undefined) {
        data.provider = validateEnum(
            payload.provider,
            ALLOWED_PROVIDERS,
            'provider',
            errors,
        );
    }

    if (payload.project_slug !== undefined) {
        const projectSlug = validateProjectSlug(payload.project_slug, errors, false);

        if (projectSlug) {
            data.project_slug = projectSlug;
        }
    }

    if (payload.form_ref !== undefined) {
        data.form_ref = normalizeOptionalString(payload.form_ref);
    }

    const providerForUrl = data.provider || payload.provider || 'epicollect5';

    if (payload.base_url !== undefined) {
        const baseUrl = normalizeBaseUrl(payload.base_url, providerForUrl, errors);

        if (baseUrl) {
            data.base_url = baseUrl;
        }
    }

    if (payload.auth_type !== undefined) {
        data.auth_type =validateEnum(
            payload.auth_type,
            ALLOWED_AUTH_TYPES,
            'auth_type',
            errors,
        );
    }

    if (payload. auth_token !== undefined) {
        const authToken = normalizeOptionalString(payload.auth_token);

        if (!authToken) {
            errors.push({
                field: 'auth_token',
                message: 'El campo auth_token no puede estar vacío si se envía.',
            });
        } else {
            data.auth_token = authToken;
        }
    }

    const isActive = validateBoolean(payload, 'is_active', errors);

    if (isActive !== undefined) {
        data.is_active = isActive;
    }

    if (payload.sync_filter_by !== undefined) {
        data.sync_filter_by = validateEnum(
            payload.sync_filter_by,
            ALLOWED_SYNC_FILTERS,
            'sync_filter_by',
            errors,
        );
    }

    const syncPerPage = validateIntegerRange(
        payload,
        'sync_per_page',
        1,
        1000,
        errors,
    );

    if (syncParPage !== undefined) {
        data.sync_per_page = syncPerPage;
    }

    const syncMaxPages = validateIntegerRange(
        payload,
        'sync_max_pages',
        1,
        100,
        errors,
    );

    if (syncMaxPages !== undefined) {
        data.sync_max_pages = syncMaxPages;
    }

    const syncDelayMs = validateIntegerRange(
        payload,
        'sync_delay_ms',
        0,
        60000,
        errors,
    );

    if (syncDelayMs !== undefined) {
        data.sync_delay_ms = syncDelayMs;
    }

    const syncOverlapMinutes = validateIntegerRange(
        payload,
        'sync_overlap_minutes',
        0,
        1440,
        errors,
    );

    if (syncOverlapMinutes !== undefined) {
        data.sync_overlap_minutes = syncOverlapMinutes;
    }

    if (Object.keys(data).length === 0 && errors.length === 0) {
        errors.push({
            field: 'body',
            message: 'No se enviaron campos válidos para actualizar',
        });
    }

    return {
        isValid: errors.length === 0,
        errors,
        data,
    };
}

module.exports = {
    validateCreateConnection,
    validateUpdateConnection,
};

