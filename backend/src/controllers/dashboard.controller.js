const dashboardModel = require('../models/dashboard.model');

async function getDashboard(req, res, next) {
    const days = req.query.days === undefined ? '7' : req.query.days;
    if (Object.keys(req.query).some((key) => key !== 'days') ||
        typeof days !== 'string' || !['7', '30', '90'].includes(days)) {
        return res.status(400).json({ status: 'error', code: 'INVALID_DASHBOARD_PERIOD',
            message: 'Selecciona un período de 7, 30 o 90 días.' });
    }
    try {
        const data = await dashboardModel.getDashboard(Number(days));
        res.set('Cache-Control', 'no-store');
        return res.json({ status: 'ok', data });
    } catch (error) { return next(error); }
}

module.exports = { getDashboard };
