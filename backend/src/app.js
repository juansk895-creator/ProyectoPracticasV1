const express = require('express');
const cors = require('cors');
const healthRoutes = require('./routes/health.routes');
//Rutas de conexión
const apiConnectionRoutes = require('./routes/apiConnection.routes');

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api', healthRoutes);
app.use('/api', apiConnectionRoutes);

module.exports = app;
