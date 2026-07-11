function filterConnection(connection) {
    if (!connection) {
        return null;
    }
    const { auth_token, token_encrypted, ...safeConnection } = connection;
    return {
        ...safeConnection, has_auth_token: Boolean(auth_token || token_encrypted),
    };
}
function filterConnections(connections) {

    //return connections.map((connection) => filterConnection(connection));
    if (!Array.isArray(connections)) {
        return [];
    }
    return connections.map(filterConnection);
}
module.exports = {
    filterConnection,
    filterConnections,
};

