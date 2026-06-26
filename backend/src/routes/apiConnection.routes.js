const express = require('express');
const apiConnectionController = require('../controllers/apiConnection.controller');

const router = express.Router();

router.get('/connections', apiConnectionController.getConnections);
router.get('/connections/:id', apiConnectionController. getConnectionById);
router.post('/connections', apiConnectionController.createConnection);
router.put('/connections/:id', apiConnectionController.updateConnection);

router.patch(
    '/connection/:id/test',
    apiConnectionController.testConnection,
);

router.patch(
    '/connections/:id/sync',
    apiConnectionController.syncConnection,
);

router.patch(
    '/connections/:id/deactivate',
    apiConnectionController.deactivateConnection,
);
router.patch(
    '/connections/:id/activate',
    apiConnectionController.activateConnection,
);

module.exports = router;
