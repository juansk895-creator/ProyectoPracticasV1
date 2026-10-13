function safeConnectionError(error) {
    if (error.code === 'EPICOLLECT_TIMEOUT') {
        return 'La solicitud a Epicollect excedió el tiempo límite configurado.';
    }
    if (error.code === 'EPICOLLECT_HTTP_ERROR' && Number.isInteger(error.statusCode) &&
        error.statusCode >= 400 && error.statusCode <= 599) {
        return `Epicollect respondió con HTTP ${error.statusCode}.`;
    }
    if (error.code === 'CREDENTIAL_DECRYPT_FAILED') {
        return 'No se pudo utilizar la credencial. Revisa la clave de cifrado del servidor.';
    }
    return 'No fue posible completar la operación. Revisa la configuración y la disponibilidad del servicio.';
}

function safeConnectionErrorCode(error, fallback) {
    return ['EPICOLLECT_TIMEOUT', 'EPICOLLECT_HTTP_ERROR', 'CREDENTIAL_DECRYPT_FAILED']
        .includes(error.code) ? error.code : fallback;
}

module.exports = { safeConnectionError, safeConnectionErrorCode };
