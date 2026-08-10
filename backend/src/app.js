const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const healthRoutes = require('./routes/health.routes');
//Rutas de conexión
const apiConnectionRoutes = require('./routes/apiConnection.routes');
const syncLogRoutes = require('./routes/syncLog.routes');
//
//import stagingEntryRoutes from './routes/stagingEntry.routes.js';
const stagingEntryRoutes = require('./routes/stagingEntry.routes');

const app = express();

const {
    createCorsOptions,
    createHelmetOptions,
    permissionsPolicyMiddleware,
} = require('./config/security.config');

//app.use(cors());
//app.use(express.json());
//app.use(express.json({ limit: '1mb' }));

app.use(helmet(createHelmetOptions()));
app.use(permissionsPolicyMiddleware);
app.use(cors(createCorsOptions()));


//middleware
app.use((error, req, res, next) => {
    if (error.code === 'CORS_ORIGIN_DENIED') {
        return res.status(403).json({
            status: 'error',
            code: error.code,
            message: error.message,
        });
    }


    if (error.type === 'entity.too.large') {
        return res.status(413).json({
            status: 'error',
            code: 'PAYLOAD_TOO_LARGE',
            message: 'El cuerpo de la solicitud excede el tamaño permitido.',
        });
    }

    if (error instanceof SyntaxError && 'body' in error) {
        return res.status(400).json({
            status: 'error',
            code: 'INVALID_JSON',
            message: 'El cuerpo de la solicitud no contiene JSON válido.',
        });
    }
    return next(error);
});

app.use('/api', healthRoutes);
app.use('/api', apiConnectionRoutes);
app.use('/api', syncLogRoutes);
app.use('/api/staging', stagingEntryRoutes);

module.exports = app;
