const PUBLIC_FIELDS = [
    'id', 'name', 'provider', 'project_slug', 'form_ref', 'base_url', 'auth_type',
    'is_active', 'last_test_at', 'last_test_status', 'last_error_message',
    'last_sync_at', 'sync_filter_by', 'sync_cursor', 'sync_per_page',
    'sync_max_pages', 'sync_delay_ms', 'sync_overlap_minutes', 'last_sync_status',
    'last_sync_error_message', 'last_sync_summary', 'created_at', 'updated_at',
];

function filterConnection(connection) {
    if (!connection) return null;
    const result = {};
    for (const field of PUBLIC_FIELDS) {
        if (Object.hasOwn(connection, field)) result[field] = connection[field];
    }
    result.has_auth_token = connection.auth_type !== 'none' &&
        (connection.has_auth_token === true || Boolean(connection.auth_token || connection.token_encrypted));
    return result;
}

function filterConnections(connections) {
    return Array.isArray(connections) ? connections.map(filterConnection) : [];
}

module.exports = { filterConnection, filterConnections };
