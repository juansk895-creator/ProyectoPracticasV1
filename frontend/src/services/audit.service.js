import { apiRequest } from './api.service';
export function getAudit(connectionId, filters) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
        if (value !== '' && value !== undefined) params.set(key, String(value));
    }
    return apiRequest(`/audit/connections/${connectionId}?${params}`);
}
export function refreshAudit(connectionId) {
    return apiRequest(`/audit/connections/${connectionId}/refresh`, { method: 'POST' });
}
