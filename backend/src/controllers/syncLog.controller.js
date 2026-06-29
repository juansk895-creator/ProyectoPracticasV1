const syncLogModel = require('../models/syncLog.model');

async function getAllSyncLogs(req, res) {
    try {
        const limit = Number(req.query.limit || 50);
        const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 50;

        const logs = await syncLogModel.findAllSyncLogs(safeLimit);

        return res.json({
            status: 'ok',
            count: logs.length,
            data: logs,
        });
    } catch (error) {
        return res.status(500).json({
            status: 'error',
            message: 'Error al consultar logs de sincronización',
            detail: error.message,
        });
    }
}

async function getSyncLogsByConnection(req, res) {
    try {
        const { id } = req.params;
        const limit = Number(req.query.limit || 20);
        const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 20;

        const logs = await syncLogModel.findSyncLogsByConnectionId(id, safeLimit);

        return res.json({
            status: 'ok',
            count: logs.length,
            data: logs,
        });
    } catch (error) {
        return res.status(500).json({
            status: 'error',
            message: 'Error al consultar logs de la conexión.',
            detail: error.message,
        });
    }
}

module.exports = {
    getAllSyncLogs,
    getSyncLogsByConnection,
};
