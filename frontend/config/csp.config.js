function getApiOrigin(apiBaseUrl) {
    if (!apiBaseUrl || apiBaseUrl.startsWith("/")) {
        return null;
    }

    let parsedUrl;

    try {
        parsedUrl = new URL(apiBaseUrl);
    } catch {
        throw new Error(
            "VITE_API_BASE_URL necesita una URL válida",
        );
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        throw new Error(
            "VITE_API_BASE_URL debe utilizar HTTP o HTTPS",
        );
    }
    return parsedUrl.origin;
}

function serializeDirectives(directives) {
    return Object.entries(directives).map(
        ([directive, sources]) => `${directive} ${sources.join(" ")}`,
    ).join("; ");
}

export function createContentSecurityPolicy({
    apiBaseUrl = "http://localhost:3001/api",
    isDevelopment = false,
} = {}) {
    const apiOrigin = getApiOrigin(apiBaseUrl);

    const scriptSources = ["'self'"];
    const styleElementSources = ["'self'"];
    const connectSources = ["'self'"];

    if (apiOrigin) {
        connectSources.push(apiOrigin);
    }

    if (isDevelopment) {
        //
        scriptSources.push("'unsafe-inline'");
        //
        styleElementSources.push("'unsafe-inline'");
        //
        connectSources.push(
            "ws://localhost:5173",
            "ws://127.0.0.1:5173",
            "ws://[::1]:5173",
        );
    }

    return serializeDirectives({
        "default-src": ["'self'"],
        "base-uri": ["'none'"],
        "object-src": ["'none'"],
        "frame-ancestors": ["'none'"],
        "frame-src": ["'none'"],
        "form-action": ["'self'"],

        "script-src": scriptSources,
        "script-src-attr": ["'none'"],

        // Los atributos style son necesarios para la tabla virtualizada.
        "style-src": ["'self'", "'unsafe-inline'"],
        "style-src-elem": styleElementSources,
        "style-src-attr": ["'unsafe-inline'"],

        "img-src": ["'self'", "data:"],
        "font-src": ["'self'", "data:"],
        "connect-src": connectSources,
        "worker-src": ["'none'"],
        "manifest-src": ["'self'"],
        "media-src": ["'none'"],
    });
}

