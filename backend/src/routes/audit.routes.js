const router = require('express').Router();
const connections = require('../models/apiConnection.model');
const audit = require('../models/audit.model');
const { parseAuditQuery } = require('../services/auditQuery.service');
const { safeConnectionError, safeConnectionErrorCode } = require('../utils/connectionError');
const { connectionSyncRateLimiter } = require('../config/rateLimit.config');
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
function handler(refresh) {
    return async (req, res) => {
        res.set('Cache-Control', 'no-store');
        try {
            if (!UUID.test(req.params.id)) return res.status(400).json({ status: 'error', message: 'La conexión no es válida.' });
            const query = refresh ? null : parseAuditQuery(req.query);
            const connection = await connections.findConnectionById(req.params.id);
            if (!connection) return res.status(404).json({ status: 'error', message: 'Conexión no encontrada.' });
            if (refresh && !connection.is_active) return res.status(409).json({ status: 'error', message: 'Activa la conexión antes de actualizar la auditoría.' });
            const data = refresh ? await audit.refreshAudit(connection) : await audit.findAudit(connection, query);
            return res.json({ status: 'ok', data });
        } catch (error) {
            const status = error.code === 'AUDIT_QUERY_INVALID' ? 400
                : ['AUDIT_ALREADY_RUNNING','CONNECTION_CHANGED'].includes(error.code) ? 409
                : ['AUDIT_SOURCE_UNAVAILABLE','AUDIT_PROJECT_NOT_READY','AUDIT_MIGRATION_REQUIRED','AUDIT_CONFIG_INVALID'].includes(error.code) ? 503 : 502;
            return res.status(status).json({ status: 'error', code: safeConnectionErrorCode(error, 'AUDIT_FAILED'),
                message: safeConnectionError(error) });
        }
    };
}
router.get('/audit/connections/:id', handler(false));
router.post('/audit/connections/:id/refresh', connectionSyncRateLimiter, handler(true));
module.exports = router;
