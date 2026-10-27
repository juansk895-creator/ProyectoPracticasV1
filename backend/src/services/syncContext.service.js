const { AsyncLocalStorage } = require('node:async_hooks');
const { setTimeout: delay } = require('node:timers/promises');
const context = new AsyncLocalStorage();

function checkSyncSignal() { context.getStore()?.signal.throwIfAborted(); }
async function pause(ms) {
    checkSyncSignal();
    try { if (ms > 0) await delay(ms, undefined, { signal: context.getStore()?.signal }); }
    catch (error) { checkSyncSignal(); throw error; }
}

module.exports = { context, pause, checkSyncSignal };
