const apiConnectionModel = require('../models/apiConnection.model');
const epicollectService = require('../services/epicollect.service');

const syncService = require('../services/sync.service');


function isValidRequiredString(value) {
    return typeof value ==='string' && value.trim().length > 0;
}

async function getConnections(req, res) {
    try {
        const connections = await apiConnectionModel.findAllConnections();

        res.json({
            status: 'ok',
            count: connections.length,
            data: connections,
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Error al consultar conexiones API',
            detail: error.message,
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
                message: 'Conexión API no encontrada',
            });
        }

        return res.json({
            status: 'ok',
            data: connection,
        });
    } catch (error) {
        return res.status(500).json({
            status: 'error',
            message: 'Error al consultar la conexión API',
            detail: error.message,
        });
    }
}

async function createConnection(req, res) {
    try {
        const { //revisar orden
            name,
            project_slug,
            base_url,
            auth_token,
            provider,
            form_ref,
            auth_type,
            is_active,
        } = req.body;

        if (!isValidRequiredString(name)) {
            return res.status(400).json({
                status: 'error',
                message: 'El campo name es obligatorio',
            });
        }

        if (!isValidRequiredString(project_slug)) {
            return res.status(400).json({
                status: 'error',
                message: 'El campo project_slug es obligatorio',
            });
        }

        if (!isValidRequiredString(base_url)) {
            return res.status(400).json({
                status: 'error',
                message: 'El campo base_url es obligatorio',
            });
        }

        if (!isValidRequiredString(auth_token)) {
            return res.status(400).json({
                status: 'error',
                message: 'El campo auth_token es obligatorio',
            });
        }

        const createConnection = await apiConnectionModel.createConnection({
            name,
            provider,
            project_slug,
            form_ref,
            base_url,
            auth_type,
            auth_token,
            is_active,
        });

        return res.status(201).json({
            status: 'ok',
            message: 'Conexión API creada correctamente',
            data: createdConnection,
        });
    } catch (error) {
        if (error.code === '23505') {
            return res.status(409).json({
                status: 'error',
                message: 'Ya existe una conexión registrada para el provider, project_slug y form_ref',
            });
        }

         if (error.code === '23514') {
            return res.status(400).json({
                status: 'error',
                message: 'Uno de los valores enviados no cumple las restricciones permitidas',
                detail: error.message,
            });
         }

         return res.stauts(500).json({
            status: 'error',
            message: 'Error al crear la conexión API',
            detail: error.message,
         });
    }
}

async function updateConnection(req, res) {
    try {
        const { id } = req.params;

        const updatedConnection = await apiConnectionModel.updateConnection(
            id,
            req.body,
        );

        if (!updatedConnection) {
            return res.status(404).json({
                status: 'error',
                message: 'Conexión API no encontrada',
            });
        }

        return res.json({
            status: 'ok',
            message: 'Conexión API actualizada correctamente',
            data: updatedConnection,
        });
    } catch (error) {
        if (error.code === '23505') {
            return res.status(409).json({
                status:'error',
                message:
                    'La actualización genera una conexión duplicada para ese provider, project_slug y form ref',
            });
        }

        if (error.code === '23514') {
            return res.status(400).json ({
                status: 'error',
                message: 'Uno de los valores ennviados no cumple las restricciones medidas,',
                detail: error.message,
            });
        }

        return res.status(500).json({
            status: 'error',
            message: 'Error al actualizar la conexión API',
            detail: error.message,
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

        if (!connection) {
            return res.status(404).json({
                status: 'error',
                message: 'Conexión API no encontrada',
            });
        }

        return res.json({
            status: 'ok',
            message: 'Conexión API desactivada correctamente',
            data: connection,
        });
    } catch (error) {
        return res.status(500).json({
            status: 'error',
            message: 'Error al desactivar la conexión API',
            detail: error.message,
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
                message: 'Conexión API no encontrada',
            });
        }

        return res.json({
            status: 'ok',
            message: 'Conexión API activada correctamente',
            data: connection,
        });
    } catch (error) {
        return res.status(500).json({
            status: 'error',
            message: 'Error al activar la conexión API',
            detail: error.message,
        });
    }
}

async function testConnection(req, res) {
    const { id } = req.params;

    try {
        const connection = 
            await apiConnectionModel.findConnectionWithTokenById(id);

        if (!connection) {
            return res.status(404).json({
                status: 'error',
                message: 'Conexión API no encontrada',
            });
        }

        if (!connection.is_active) {
            return res.status(400).json({
                status: 'error',
                message:
                    'La conexión API está desactivada. Actívala antes de probar conectividad.',
            });
        }

        const testResult = 
            await epicollectService.testEpicollectConnection(connection);
        
        const updatedConnection = 
            await apiConnectionModel.updateConnectionTestStatus(
                id,
                'success',
                null,
            );
        
        return res.json({
            status: 'ok',
            message: 'Conexión API validada correctamente',
            data: {
                connection: updatedConnection,
                test: {
                    statusCode: testResult.statusCode,
                    entriesCount: testResult.entriesCount,
                    meta: testResult.meta,
                },
            },
        });
    } catch (error) {
        const safeErrorMessage = 
            error.statusCode
                ? `Error de conectividad con Epicollect. HTTP ${error.statusCode}.`
                : error.message;
            
        const updatedConnection = 
            await apiConnectionModel.updateConnectionTestStatus(
                id,
                'failed',
                safeErrorMessage,
            );
                
        return res,status(502).json({
            status: 'error',
            message: 'No fue posible validar la conexión API.',
            detail: safeErrorMessage,
            data: {
                connection: updatedConnection,
            },
        });
    }
}

async function syncConnection(req, res) {
    const { id } = req.params;

    try {
        const connection = 
        await apiConnectionModel.findConnectionWithTokenById(id);

        if (!connection) {
            return res.status(404).json({
                status: 'error',
                message: 'Conexión API no encontrada',
            });
        }

        if (!connection) {
            return res.status(404).json({
                status: 'error',
                message: 'Conexión API no encontrada',
            });
        }

        if (!connection.is_active) {
            return res.status(400).json({
                status: 'error',
                message: 'La conexión API está desactivada, no es posible sincronizar',
            });
        }

        const syncResult = await syncService.sincConnectionToStaging(connection, {
            perPage: 500,
            maxPages: 10,
        });

        const updatedConnection = await apiConnectionModel.updateConnectionLastSync(id);

        return res.json({
            status: 'ok',
            message: 'Sincronización ejecutada correctamente',
            data: {
                connection: updatedConnection,
                sync: syncResult,        
            },
        });
    } catch (error) {
        const safeErrorMessage = error.statusCode ?
            `Error al sincronizar desde Epicollect. HTTP ${error.statusCode}.` :
            error.message;
        
        return res.status(502).json({
            status: 'error',
            message: 'No fue posible ejecutar la sincronización',
            detail: safeErrorMessage,
        });
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

