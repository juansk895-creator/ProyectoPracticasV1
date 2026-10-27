function schedulerConfig(environment = process.env) {
    const enabled = environment.SYNC_SCHEDULER_ENABLED ?? 'false';
    if (!['true', 'false'].includes(enabled)) throw invalid();
    function integer(name, fallback, min, max) {
        const raw = environment[name] ?? String(fallback);
        if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < min || Number(raw) > max) throw invalid();
        return Number(raw);
    }
    return {
        enabled: enabled === 'true',
        pollMs: integer('SYNC_SCHEDULER_POLL_MS', 30000, 1000, 60000),
        requestIntervalMs: integer('SYNC_REQUEST_INTERVAL_MS', environment.NODE_ENV === 'test' ? 0 : 25000,
            environment.NODE_ENV === 'test' ? 0 : 1, 60000),
    };
}

function invalid() {
    return Object.assign(new Error('Revisa las variables de configuración de sincronización programada.'),
        { code: 'SYNC_SCHEDULER_CONFIG_INVALID' });
}

module.exports = { schedulerConfig };
