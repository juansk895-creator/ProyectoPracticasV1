const { test } = require('node:test');
const assert = require('node:assert/strict');
const { schedulerConfig } = require('../src/config/scheduler.config');
const { validateCreateConnection, validateUpdateConnection } = require('../src/validations/apiConnection.validator');

test('la programación requiere activación explícita y conserva límites de configuración', () => {
    assert.deepEqual(schedulerConfig({}), { enabled: false, pollMs: 30000, requestIntervalMs: 25000 });
    assert.equal(schedulerConfig({ SYNC_SCHEDULER_ENABLED: 'true' }).enabled, true);
    for (const environment of [
        { SYNC_SCHEDULER_ENABLED: 'yes' }, { SYNC_SCHEDULER_POLL_MS: '0' },
        { SYNC_SCHEDULER_POLL_MS: '1000.5' }, { SYNC_REQUEST_INTERVAL_MS: '0' },
        { SYNC_REQUEST_INTERVAL_MS: 'NaN' }, { SYNC_REQUEST_INTERVAL_MS: '60001' },
    ]) assert.throws(() => schedulerConfig(environment), { code: 'SYNC_SCHEDULER_CONFIG_INVALID' });
    assert.equal(schedulerConfig({ NODE_ENV: 'test' }).requestIntervalMs, 0);
});

test('valida la programación sin convertir texto en activación ni reiniciar otros parámetros', () => {
    const base = { name: 'Programada', project_slug: 'test', base_url: 'https://five.epicollect.net/api', auth_type: 'none' };
    assert.equal(validateCreateConnection({ ...base, sync_schedule_enabled: true, sync_interval_minutes: 5 }).isValid, true);
    for (const payload of [{ sync_schedule_enabled: 'true' }, { sync_interval_minutes: 4 },
        { sync_interval_minutes: 10081 }, { sync_interval_minutes: 5.5 }]) {
        assert.equal(validateCreateConnection({ ...base, ...payload }).isValid, false);
        assert.equal(validateUpdateConnection(payload).isValid, false);
    }
    assert.deepEqual(validateUpdateConnection({ sync_schedule_enabled: false }).data, { sync_schedule_enabled: false });
});
