function filterConnection(connection) {
    if (!connection) {
        return null;
    }
    const { auth_token, ...safeConnection } = connection;
    return {
        ...safeConnection, has_auth_token: Boolean(auth_token),
    };
}
function filterConnections(connection) {
    return connections.map((connection) => filterConnection(connection));
}
module.exports = {
    filterConnection,
    filterConnections,
};


