import { apiRequest } from './api.service';

export function getDashboard(days = 7) {
    return apiRequest(`/dashboard?${new URLSearchParams({ days: String(days) })}`);
}
