const express = require('express');

const { getStagingEntries } = require('../controllers/stagingEntry.controller');

const router = express.Router();

router.get('/entries', getStagingEntries);

module.exports = router;
