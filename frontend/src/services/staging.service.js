import { apiRequest } from './api.service';

export function getStagingEntries({
    projectSlug,
    formRef = null,
    page = 1,
    pageSize = 25,
    search = null,
    filters = [],
    sortBy = 'received_at',
    sortOrder = 'desc',
}) {
    const params = new URLSearchParams({
        project_slug: projectSlug,
        page: String(page),
        page_size: String(pageSize),
        sort_by: sortBy,
        sort_order: sortOrder,
    });

    if (formRef) {
        params.set('form_ref', formRef);
    }

    if (search) {
        params.set('search', search);
    }

    if (filters.length > 0) {
        params.set(
            'filters',
            JSON.stringify(filters),
        );
    }
    return apiRequest(
        `/staging/entries?${params.toString()}`,
    );
}

