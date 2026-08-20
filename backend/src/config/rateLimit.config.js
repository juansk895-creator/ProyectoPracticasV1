const {
    rateLimit,
} = require('express-rate-limit');

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;

function parsePositiveInteger(
    value,
    fallback,
    variableName,
) {
    if (value === undefined || value === '') {
        return fallback;
    }
    const parsedValue = Number(value);

    if (!Number.isInteger(parsedValue) || parsedValue  <= 0) {
        throw new Error(
            `${variableName} debe contener un número entero mayor que cero`,
        );
    }
    return parsedValue;
}

function createRateLimitHandler({
    code,
    message,
    windowMs,
}) {
    return (req, res, _next, options) => {
        const resetTime = req.rateLimit?.resetTime;

        const retryAfterSeconds = resetTime instanceof Date ? Math.max(
            1,
            Math.ceil(
                (resetTime.getTime() - Date.now()) / 1000,
            ),
        )
        : Math.ceil(windowMs / 1000);

        res.setHeader(
            'Retry-After',
            String(retryAfterSeconds),
        );

        return res.status(options.statusCode).json({
            status: 'error',
            code,
            message,
            retryAfterSeconds,
        });
    };
}

function createRateLimiter({
    environment = process.env,
    limitVariable,
    defaultLimit,
    identifier,
    code,
    message,
}) {
    const windowMs = parsePositiveInteger(
        environment.RATE_LIMIT_WINDOW_MS,
        environment.DEFAULT_WINDOWS_MS,
        'RATE_LIMIT_WINDOW_MS',
    );
    
    const limit = parsePositiveInteger(
        environment[limitVariable],
        defaultLimit,
        limitVariable,
    );

    return rateLimit({
        windowMs,
        limit,
        identifier,

        standardHeaders: 'draft-8',
        legacyHeaders: false,

        ipv6Subnet: 56,

        passOnStoreError: false,

        skip: (req) => req.method === 'OPTIONS',

        handler: createRateLimitHandler({
            code,
            message,
            windowMs,
        }),
    });
}

const apiRateLimiter = createRateLimiter({
    limitVariable: 'RATE_LIMIT_API_MAX',
    defaultLimit: 300,
    identifier: 'api',
    code: 'API_RATE_LIMIT_EXCEEDED',
    message: 'Se alcanzó temporalmente el límite general de solicitudes a la API',
});

const connectionWriteRateLimiter = createRateLimiter({
    limitVariable: 'RATE_LIMIT_WRITE_MAX',
    defaultLimit: 60,
    identifier: 'connection-write',
    code: 'CONNECTION_WRITE_RATE_LIMIT_EXCEEDED',
    message: 'Se alcanzó temporalmente el límite de modificaciones de conexiones',
});

const connectionTestRateLimiter = createRateLimiter({
    limitVariable: 'RATE_LIMIT_TEST_MAX',
    defaultLimit: 20,
    identifier: 'connection-test',
    code: 'CONNECTION_TEST_RATE_LIMIT_EXCEEDED',
    message: 'Se alcanzó temporalmente el límite de pruebas de conexión',
});

const connectionSyncRateLimiter = createRateLimiter({
    limitVariable: 'RATE_LIMIT_SYNC_MAX',
    defaultLimit: 10,
    identifier: 'connection-sync',
    code: 'CONNECTION_SYNC_RATE_LIMIT_EXCEEDED',
    message: 'Se alcanzó temporalmente el límite de sincronizaciones',
});

module.exports = {
    apiRateLimiter,
    connectionSyncRateLimiter,
    connectionTestRateLimiter,
    connectionWriteRateLimiter,
};
