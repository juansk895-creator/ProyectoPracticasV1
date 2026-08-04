const apiConnectionModel = require('../models/apiConnection.model');
const epicollectService = require('../services/epicollect.service');

const syncService = require('../services/sync.service');
const syncLogModel = require('../models/syncLog.model');

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
            detail: error.message,
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
                detail: error.message,
            });
        }

        return res.status(500).json({
            status: 'error',
            code: 'CONNECTION_CREATE_FAILED',
            message: 'Error al crear la conexión API',
            detail: error.message,
        });
    }



    /*try {
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
    }*/
}

async function updateConnection(req, res) {
    try {
        const { id } = req.params;
        const validation = validateUpdateConnection(req.body);

        if (!validation.isValid) {
            return sendValidationError(res, validation.errors);
        }

        const updatedConnection = await apiConnectionModel.updateConnection(
            id,
            //req.body,
            validation.data,
        );

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
                detail: error.message,
            });
        }

        return res.status(500).json({
            status: 'error',
            code: 'CONNECTION_UPDATE_FAILED',
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
            detail: error.message,
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
        const safeErrorMessage = 
            error.code === 'EPICOLLECT_TIMEOUT'
                ? 'La solicitud a Epicollect excedió el tiempo límite configurado'
                : error.statusCode
                ? `Error de conectividad con Epicollect. HTTP ${error.statusCode}.`
                : error.message;
            
        const updatedConnection = 
            await apiConnectionModel.updateConnectionTestStatus(
                id,
                'failed',
                safeErrorMessage,
            );
                
        return res.status(502).json({
            status: 'error',
            code: error.code || 'EPICOLLECT_TEST_FAILED',
            message: 'No fue posible validar la conexión API.',
            detail: safeErrorMessage,
            data: {
                //connection: updatedConnection,
                connection: filterConnection(updatedConnection),
            },
        });
    }
}

function calculateDurationMs(startedAt, finishedAt) {
    return finishedAt.getTime() - startedAt.getTime();
}

async function syncConnection(req, res) {

    /*console.error(
        'Error en syncConnection:',
        error.stack || error,
    );*/

    const { id } = req.params;

    let connection = null;
    const startedAt = new Date();

    try {
        connection = await apiConnectionModel.findConnectionWithTokenById(id);

        if (!connection) {
            return res.status(404).json({
                status: 'error',
                code: 'CONNECTION_NOT FOUND',
                message: 'Conexión API no encontrada',
            });
        }

        if (!connection.is_active) {
            return res.status(400).json({
                status: 'error',
                code: 'CONNECTION_INACTIVE',
                message: 'La conexión API está desactivada, no es posible sincronizar',
            });
        }

        const syncResult = await syncService.syncConnectionToStaging(connection);

        const nextCursor = syncResult.cursor.nextCursor || null;
        const syncStatus = syncResult.database.skipped > 0 ? 'partial' : 'success';


        const updatedConnection = await apiConnectionModel.updateConnectionSyncState(id, {
            status: syncStatus,
            cursor: nextCursor,
            errorMessage: null,
            summary: syncResult,
        });

        const finishedAt = new Date();

        const syncLog = await syncLogModel.createSyncLog({
            api_connection_id: connection.id,
            project_slug: connection.project_slug,
            form_ref: connection.form_ref,
            status: syncStatus,
            mode: syncResult.mode,
            started_at: startedAt,
            finished_at: finishedAt,
            duration_ms: calculateDurationMs(startedAt, finishedAt),
            filter_by: syncResult.filter.filterBy,
            filter_from: syncResult.filter.filterFrom,
            cursor_before: syncResult.cursor.previousCursor,
            cursor_after: syncResult.cursor.nextCursor,
            total_entries_fetched: syncResult.fetch.totalEntriesFetched,
            processed_count: syncResult.database.processed,
            skipped_count: syncResult.database.skipped,
            stopped_by_max_pages: syncResult.fetch.stoppedByMaxPages,
            error_message: null,
            summary: syncResult,
        });

        return res.json({
            status: 'ok',
            message: 'Sincronización ejecutada correctamente',
            data: {
                //connection: updatedConnection,
                connection: filterConnection(updatedConnection),
                sync: syncResult,
                log: syncLog,
            },
        });
    } catch (error) {

        console.error(
            'Error en syncConnection:',
            error.stack || error,
        );

        const safeErrorMessage = error.code === 'EPICOLLECT_TIMEOUT'
            ? 'La solicitud a Epicollect excedió el tiempo límite configurado.'
            : error.statusCode
            ? `Error al sincronizar desde Epicollect. HTTP ${error.statusCode},`
            : error.message;
        
        if (connection) {
            await apiConnectionModel.updateConnectionSyncState(id, {
                status: 'failed',
                cursor: null,
                errorMessage: safeErrorMessage,
                summary: {
                    error: safeErrorMessage,
                },
            });

            const finishedAt = new Date();

            await syncLogModel.createSyncLog({
                api_connection_id: connection.id,
                project_slug: connection.project_slug,
                form_ref: connection.form_ref,
                status: 'failed',
                mode: null,
                started_at: startedAt,
                finished_at: finishedAt,
                duration_ms: calculateDurationMs(startedAt, finishedAt),
                filter_by: connection.sync_filter_by,
                filter_from: null,
                cursor_before: connection.sync_cursor,
                cursor_after: connection.sync_cursor,
                total_entries_fetched: 0,
                processed_count: 0,
                skipped_count: 0,
                stopped_by_max_pages: false,
                error_message: safeErrorMessage,
                summary: {
                    error: safeErrorMessage,
                },
            });
        }
        
        return res.status(502).json({
            status: 'error',
            code: error.code || 'EPICOLLECT_SYNC_FAILED',
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

