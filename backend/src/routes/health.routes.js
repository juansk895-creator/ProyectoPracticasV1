const express = require('express');
const pool = require('../config/db');

const router = express.Router();

router.get('/health', async (requestAnimationFrame, res) => {
    try {
        const dbResult = await pool.query('SELECT NOW() AS current_time');

        res.json({
            status: 'ok',
            backend: 'running',
            database: 'connected',
            currentTime: dbResult.rows[0].current_time,
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            backend: 'running',
            database: 'disconnected',
            message: error.message,
        });
    }
});

module.exports = router;
