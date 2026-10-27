const router = require('express').Router();
const { schedulerConfig } = require('../config/scheduler.config');

router.get('/sync-scheduler', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ status: 'ok', data: schedulerConfig() });
});

module.exports = router;
