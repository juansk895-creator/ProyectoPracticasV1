const DEVELOPMENT_ORIGINS = Object.freeze([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
]);

const PERMISSIONS_POLICY = [
    'accelerometer=()',
    'camera=()',
    'display-capture=()',
    'geolocation=()',
    'gyroscope=()',
    'magnetometer=()',
    'microphone=()',
    'payment=()',
    'usb=()',
].join(', ');

function parseAllowedOrigins(value = '') {
    return [
        ...new Set(
            value.split(',').map((origin) => origin.trim().replace(/\/$/, '')).filter(Boolean),
        ),
    ];
}

function getAllowedOrigins(environment = process.env) {
    const configuredOrigins = parseAllowedOrigins(
        environment.CORS_ALLOWED_ORIGINS,
    );

    if (configuredOrigins.length > 0) {
        return configuredOrigins;
    }

    if (environment.NODE_ENV === 'production') {
        throw new Error(
            'CORS_ALLOWED_ORIGINS es obligatorio en el entorno de producción.',
        );
    }

    return [...DEVELOPMENT_ORIGINS];
}

function createCorsOptions(environment = process.env) {
    
    //Comprobar
    const allowedOrigins = new Set(getAllowedOrigins(environment));
    
    return {
        allowedHeaders: ['Content-Type'],

        exposedHeaders: [
            'RateLimit',
            'RateLimit-Policy',
            'Retry-After',
        ],
        credentials: false,
        optionsSuccessStatus: 204,
    }

}

function createHelmetOptions(environment = process.env) {
    const hstsEnabled = environment.ENABLE_HSTS === 'true';
    //const isDevelopment = environment.NODE_ENV !== 'production';

    return {
        contentSecurityPolicy: {
            useDefault: false,
            directives: {
                defaultSrc: ["'none'"],
                baseUri: ["'none'"],
                formAction: ["'none'"],
                frameAncestors: ["'none'"],
                //upgradeInsecureRequests: isDevelopment ? null : [],
            },
        },

        // Solo deberá activarse cuando el dominio ya funcione mediante HTTPS.
        strictTransportSecurity: hstsEnabled
            ? {
                  maxAge: 31536000,
                  includeSubDomains: false,
                  preload: false,
              }
            : false,

        xFrameOptions: {
            action: 'deny',
        },

        referrerPolicy: {
            policy: 'strict-origin-when-cross-origin',
        },
    };
}

function permissionsPolicyMiddleware(req, res, next) {
    res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
    next();
}

module.exports = {
    createCorsOptions,
    createHelmetOptions,
    getAllowedOrigins,
    parseAllowedOrigins,
    permissionsPolicyMiddleware,
};

