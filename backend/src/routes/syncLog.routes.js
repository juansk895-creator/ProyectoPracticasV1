const express = require('express');
const syncLogController = require('../controllers/syncLog.controller');

const router = express.Router();

router.get('/sync-logs', syncLogController.getAllSyncLogs);
router.get('/connections/:id/sync-logs',
    syncLogController.getSyncLogsByConnection,
);

module.exports = router;

