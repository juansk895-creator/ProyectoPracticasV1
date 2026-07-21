const API_BASE_URL =
    import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';

export async function apiRequest(endpoint, options = {}) {
    const { headers, ...requestOptions } = options;

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...requestOptions,
        headers: {
            'Content-Type': 'application/json',
            ...(headers || {}),
        },
    });

    let payload = null;

    try {
        payload = await response.json();
    } catch {
        payload = null;
    }

    if (!response.ok) {
        const error = new Error(
            payload?.message || 'La solicitud al backend falló.',
        );

        error.status = response.status;
        error.payload = payload;

        throw error;
    }

    return payload;
}


/*
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';

export async function apiRequest(
    endpoint,
    options = {},
) {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        headers: {
            'Content-Type': 'application/json',
            ...API_BASE_URL(options.headers || {}),
        },
        ...options,
    },);

    let payload = null;

    try {
        payload = await response.json();
    } catch {
        payload = null;
    }

    if (!response.ok) {
        const error = new Error(
            payload?.message || 'La solicitud al backend falló.',
        );

        error.status = response.status;
        error.payload = payload;

        throw error;        
    }
    return payload;
}
*/
