const { safeConnectionError, safeConnectionErrorCode } = require('../utils/connectionError');
const apiConnectionModel = require('../models/apiConnection.model');
const epicollectService = require('../services/epicollect.service');

const syncRunner = require('../services/syncRunner.service');

const { validateCreateConnection, validateUpdateConnection } = require('../validations/apiConnection.validator');
const { filterConnection, filterConnections } = require('../utils/filter');

function sendValidationError(res, errors) {
    return res.status(400).json({
        status: 'error',
        code: 'INVALID_CONNECTION_PAYLOAD',
        message: 'La configuración de la conexión API no es válida',
        errors,
    });
}

function isValidRequiredString(value) {
    return typeof value ==='string' && value.trim().length > 0;
}

async function getConnections(req, res) {
    try {
        const connections = await apiConnectionModel.findAllConnections();

        res.json({
            status: 'ok',
            count: connections.length,
            //data: connections,
            data: filterConnections(connections),
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            code: 'CONNECTION_LIST_FAILED',
            message: 'Error al consultar conexiones API',
            detail: safeConnectionError(error),
        });
    }
}

async function getConnectionById(req, res) {
    try {
        const { id } = req.params;
        const connection = await apiConnectionModel.findConnectionById(id);

        if (!connection) {
            return res.status(404).json({
                status: 'error',
                code: 'CONNECTION_NOT_FOUND',
                message: 'Conexión API no encontrada',
            });
        }

        return res.json({
            status: 'ok',
            //data: connection,
            data: filterConnection(connection),
        });
    } catch (error) {
        return res.status(500).json({
            status: 'error',
            code: 'CONNECTION_REAR_FAILED',
            message: 'Error al consultar la conexión API',
            detail: safeConnectionError(error),
        });
    }
}

async function createConnection(req, res) {
    
    try {
        const validation = validateCreateConnection(req.body);

        if (!validation.isValid) {
            return sendValidationError(res, validation.errors);
        }

        const createdConnection = await apiConnectionModel.createConnection(
            validation.data,
        );

        return res.status(201).json({
            status: 'ok',
            message: 'Conexión API creada correctamente.',
            data: filterConnection(createdConnection),
        });
    } catch (error) {
        if (error.code === '23505') {
            return res.status(409).json({
                status: 'error',
                code: 'CONNECTION_DUPLICATED',
                message: 'Ya existe una conexión registrada...',
            });
        }

        if (error.code === '23514') {
            return res.status(400).json({
                status: 'error',
                code: 'DATABASE_CONSTRAINT_FAILED',
                message: 'Uno de los valores enviados no pasó las restricciones.',
                detail: safeConnectionError(error),
            });
        }

        return res.status(500).json({
            status: 'error',
            code: 'CONNECTION_CREATE_FAILED',
            message: 'Error al crear la conexión API',
            detail: safeConnectionError(error),
        });
    }

}

async function updateConnection(req, res) {
    try {
        const { id } = req.params;
        const current = await apiConnectionModel.findConnectionById(id);
        if (!current) return res.status(404).json({ status: 'error', code: 'CONNECTION_NOT_FOUND', message: 'Conexión API no encontrada.' });
        const validation = validateUpdateConnection(req.body, current);

        if (!validation.isValid) {
            return sendValidationError(res, validation.errors);
        }

        const updatedConnection = await apiConnectionModel.updateConnection(
            id,
            //req.body,
            validation.data,
        );
        if (validation.data.is_active === false) syncRunner.cancelRun(id);
        else if (validation.data.sync_schedule_enabled === false) syncRunner.cancelRun(id, { scheduledOnly: true });

        if (!updatedConnection) {
            return res.status(404).json({
                status: 'error',
                code: 'CONNECTION_NOT_FOUND',
                message: 'Conexión API no encontrada',
            });
        }

        return res.json({
            status: 'ok',
            message: 'Conexión API actualizada correctamente',
            //data: updatedConnection,
            data: filterConnection(updatedConnection),
        });
    } catch (error) {
        if (error.code === 'INVALID_CONNECTION_PAYLOAD') return sendValidationError(res, error.errors);
        if (error.code === '23505') {
            return res.status(409).json({
                status:'error',
                code: 'CONNECTION_DUPLICATED',
                message: 'La actualización genera una conexión duplicada.',
            });
        }

        if (error.code === '23514') {
            return res.status(400).json ({
                status: 'error',
                code: 'DATABASE_CONSTRAINT_FAILED',
                message: 'Uno de los valores enviados no pasó las restricciones.',
                detail: safeConnectionError(error),
            });
        }

        return res.status(500).json({
            status: 'error',
            code: 'CONNECTION_UPDATE_FAILED',
            message: 'Error al actualizar la conexión API',
            detail: safeConnectionError(error),
        });
    }
}

async function deactivateConnection(req, res){
    try {
        const { id } = req.params;

        const connection = await apiConnectionModel.setConnectionActiveStatus(
            id,
            false,
        );
        syncRunner.cancelRun(id);

        if (!connection) {
            return res.status(404).json({
                status: 'error',
                code: 'CONNECTION_NOT_FOUND',
                message: 'Conexión API no encontrada',
            });
        }

        return res.json({
            status: 'ok',
            message: 'Conexión API desactivada correctamente',
            //data: connection,
            data: filterConnection(connection),
        });
    } catch (error) {
        return res.status(500).json({
            status: 'error',
            code: 'CONNECTION_DEACTIVATE_FAILED',
            message: 'Error al desactivar la conexión API',
            detail: safeConnectionError(error),
        });
    }
}

async function activateConnection(req, res) {
    try {
        const { id } = req.params;

        const connection = await apiConnectionModel.setConnectionActiveStatus(
            id,
            true,
        );

        if (!connection) {
            return res.status(404).json({
                status: 'error',
                code: 'CONNECTION_NOT_FOUND',
                message: 'Conexión API no encontrada',
            });
        }

        return res.json({
            status: 'ok',
            message: 'Conexión API activada correctamente',
            //data: connection,
            data: filterConnection(connection),
        });
    } catch (error) {
        return res.status(500).json({
            status: 'error',
            code: 'CONNECTION_ACTIVATE_FAILED',
            message: 'Error al activar la conexión API',
            detail: safeConnectionError(error),
        });
    }
}

async function testConnection(req, res) {
    const { id } = req.params;

    try {
        const connection = await apiConnectionModel.findConnectionWithTokenById(id);

        if (!connection) {
            return res.status(404).json({
                status: 'error',
                code: 'CONNECTION_NOT_FOUND',
                message: 'Conexión API no encontrada',
            });
        }

        if (!connection.is_active) {
            return res.status(400).json({
                status: 'error',
                code: 'CONNECTION_INACTIVE',
                message: 'La conexión API está desactivada. Actívala antes de probar conectividad.',
            });
        }

        const testResult = await epicollectService.testEpicollectConnection(connection);
        
        const updatedConnection = await apiConnectionModel.updateConnectionTestStatus(
            id,
            'success',
            null,
        );
        
        return res.json({
            status: 'ok',
            message: 'Conexión API validada correctamente',
            data: {
                //connection: updatedConnection,
                connection: filterConnection(updatedConnection),
                test: {
                    statusCode: testResult.statusCode,
                    entriesCount: testResult.entriesCount,
                    meta: testResult.meta,
                },
            },
        });
    } catch (error) {
        const safeErrorMessage = safeConnectionError(error);

        const updatedConnection = 
            await apiConnectionModel.updateConnectionTestStatus(
                id,
                'failed',
                safeErrorMessage,
            );
                
        return res.status(502).json({
            status: 'error',
            code: safeConnectionErrorCode(error, 'EPICOLLECT_TEST_FAILED'),
            message: 'No fue posible validar la conexión API.',
            detail: safeErrorMessage,
            data: {
                //connection: updatedConnection,
                connection: filterConnection(updatedConnection),
            },
        });
    }
}

async function syncConnection(req, res, next) {
    try {
        const result = await syncRunner.runConnection(req.params.id);
        return res.json({ status: 'ok', message: 'Sincronización ejecutada correctamente',
            data: { ...result, connection: filterConnection(result.connection) } });
    } catch (error) {
        if (error.code === 'SYNC_STATE_WRITE_FAILED') return next(error);
        const status = error.code === 'CONNECTION_NOT_FOUND' ? 404
            : error.code === 'CONNECTION_INACTIVE' ? 400
                : error.code === 'SYNC_ALREADY_RUNNING' ? 409
                    : error.code === 'SYNC_CAPACITY_BUSY' ? 429 : 502;
        return res.status(status).json({ status: 'error',
            code: safeConnectionErrorCode(error, error.code === 'CONNECTION_NOT_FOUND' || error.code === 'CONNECTION_INACTIVE'
                ? error.code : 'EPICOLLECT_SYNC_FAILED'),
            message: error.code === 'CONNECTION_NOT_FOUND' ? 'Conexión API no encontrada.'
                : error.code === 'CONNECTION_INACTIVE' ? 'La conexión está desactivada.'
                    : 'No fue posible ejecutar la sincronización.',
            detail: safeConnectionError(error) });
    }
}

module.exports = {
    getConnections,
    getConnectionById,
    createConnection,
    updateConnection,
    deactivateConnection,
    activateConnection,
    testConnection,
    syncConnection,
};

