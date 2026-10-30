const SAFE_MESSAGES = {
    AUDIT_QUERY_INVALID: 'Revisa el identificador, las fechas y los filtros de auditoría.',
    AUDIT_SOURCE_UNAVAILABLE: 'El acceso a la identidad del capturista aún no está configurado para este proyecto.',
    AUDIT_CONFIG_INVALID: 'Revisa la configuración de acceso a auditoría en el servidor.',
    AUDIT_PROJECT_NOT_READY: 'Sincroniza primero los registros del proyecto para consultar su auditoría.',
    AUDIT_MIGRATION_REQUIRED: 'Es necesario preparar el almacenamiento de auditoría.',
    AUDIT_ALREADY_RUNNING: 'La auditoría de este proyecto ya se está actualizando. Espera a que termine.',
    AUDIT_PAGE_LIMIT: 'La consulta de auditoría superó el máximo de páginas. Ajusta el límite de la conexión y repite.',
    AUDIT_RESPONSE_INVALID: 'El origen devolvió información de auditoría incompleta o inconsistente. No se guardó el lote.',
    SYNC_ALREADY_RUNNING: 'Esta conexión ya tiene una sincronización en ejecución. Espera a que termine.',
    SYNC_CAPACITY_BUSY: 'El servidor está atendiendo otras sincronizaciones. Intenta nuevamente en unos momentos.',
    SYNC_INTERRUPTED: 'La sincronización se interrumpió. El próximo intento utilizará el avance que quedó guardado.',
    SYNC_SCHEDULER_CONFIG_INVALID: 'Revisa la configuración de sincronización programada del servidor.',
    SYNC_SCHEDULER_MIGRATION_REQUIRED: 'Es necesario preparar el almacenamiento de sincronización programada.',
    EPICOLLECT_SCHEMA_INVALID: 'La definición de preguntas o su mapeo de exportación no es válido. Revisa la estructura del proyecto.',
    EPICOLLECT_PROJECT_INVALID: 'La definición del proyecto de Epicollect5 no es válida.',
    EPICOLLECT_FORM_UNKNOWN: 'El formulario o rama no aparece en la definición del proyecto.',
    STAGING_ENTRY_INVALID: 'Un registro descargado contiene identificadores o fechas no válidos. El lote no se guardó.',
    STAGING_SOURCE_CONFLICT: 'La procedencia o estructura de este proyecto no coincide con los datos guardados.',
    STAGING_MIGRATION_REQUIRED: 'Es necesario aplicar la migración del modelo jerárquico antes de continuar.',
    SYNC_PAGE_LIMIT: 'Quedan páginas por descargar. Aumenta el máximo de páginas de la conexión y repite la sincronización.',
    EPICOLLECT_TIMEOUT: 'La solicitud a Epicollect excedió el tiempo límite configurado.',
    EPICOLLECT_RESPONSE_INVALID: 'Epicollect devolvió datos incompletos o un formato no válido.',
    CREDENTIAL_DECRYPT_FAILED: 'No se pudo utilizar la credencial. Revisa la clave de cifrado del servidor.',
    EPICOLLECT_BASE_DENIED: 'El servidor de Epicollect5 no está autorizado en la configuración del backend.',
    EPICOLLECT_CONFIG_INVALID: 'Revisa la configuración de servidores autorizados de Epicollect5.',
    OAUTH_CREDENTIALS_REJECTED: 'Epicollect rechazó Client ID o Client Secret. Revisa las credenciales y los permisos del proyecto.',
    OAUTH_RESPONSE_INVALID: 'El servidor OAuth devolvió una respuesta no válida.',
    OAUTH_TIMEOUT: 'El servidor OAuth no respondió dentro del tiempo permitido.',
    OAUTH_UNAVAILABLE: 'No fue posible contactar con el servidor OAuth. Revisa su disponibilidad y certificado HTTPS.',
    OAUTH_RATE_LIMITED: 'El servidor OAuth alcanzó su límite de peticiones. Espera hasta el próximo intento permitido.',
    OAUTH_RETRY_LATER: 'La autenticación está en espera tras un fallo. Revisa el próximo intento permitido.',
    CONNECTION_CHANGED: 'La conexión cambió o fue desactivada durante la operación. Revisa su configuración antes de repetirla.',
};
function safeConnectionError(error) {
    if (Object.hasOwn(SAFE_MESSAGES, error.code)) return SAFE_MESSAGES[error.code];
    if (error.code === 'EPICOLLECT_HTTP_ERROR' && Number.isInteger(error.statusCode) &&
        error.statusCode >= 400 && error.statusCode <= 599) return `Epicollect respondió con HTTP ${error.statusCode}.`;
    return 'No fue posible completar la operación. Revisa la configuración y la disponibilidad del servicio.';
}
function safeConnectionErrorCode(error, fallback) {
    return Object.hasOwn(SAFE_MESSAGES, error.code) || error.code === 'EPICOLLECT_HTTP_ERROR' ? error.code : fallback;
}
module.exports = { safeConnectionError, safeConnectionErrorCode };
