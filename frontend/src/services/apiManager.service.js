//import { apiRequest } from "./api.service";

//const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';
import { apiRequest } from './api.service';


/*
async function apiRequest(endpoint, options = {}) {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {}),
        },
        ...options,
    });

    let payload = null;

    try {
        payload = await response.json();
    } catch {
        payload = null;
    }

    if (!response.ok) {
        const error = new Error(
            payload.message || 'La solicitud al backend falló.',
        );

        error.status = response.status;
        error.payload = payload;

        throw error;
    }
    return payload;
}
*/

export function getConnections() {
    return apiRequest('/connections');
}

export function createConnection(connectionData) {
    return apiRequest('/connections', {
        method: 'POST',
        body: JSON.stringify(connectionData),
    });
}

export function activateConnection(id) {
    return apiRequest(`/connections/${id}/activate`, {
        method: 'PATCH',
    });
}

export function deactivateConnection(id) {
    return apiRequest(`/connections/${id}/deactivate`, {
        method: 'PATCH',
    });
}

export function testConnection(id) {
    return apiRequest(`/connections/${id}/test`, {
        method: 'PATCH',
    });
}

export function syncConnection(id) {
    return apiRequest(`/connections/${id}/sync`, {
        method: 'PATCH',
    });
}

export function getSyncLogs(limit = 20) {
    return apiRequest(`/sync-logs?limit=${limit}`);
}

export function getConnectionSyncLogs(id, limit = 20) {
    return apiRequest(`/connections/${id}/sync-logs?limit=${limit}`);
}

export function updateConnection(id, connectionData) {
    return apiRequest(`/connections/${id}`, {
        method: 'PUT',
        body: JSON.stringify(connectionData),
    });
}

