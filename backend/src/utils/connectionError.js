const SAFE_MESSAGES = {
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
