require('../src/config/env');
const { readFile } = require('node:fs/promises');
const pool = require('../src/config/db');
const connections = require('../src/models/apiConnection.model');
const { replaceSurveyors } = require('../src/services/surveyorDirectory.service');
(async () => {
    const [id, file] = process.argv.slice(2);
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id || '') || !file) throw new Error();
    const connection = await connections.findConnectionById(id);
    if (!connection) throw new Error();
    const raw = await readFile(file, 'utf8');
    if (raw.length > 30 * 1024 * 1024) throw new Error();
    const client = await pool.connect();
    try {
        const result = await replaceSurveyors(client, connection, JSON.parse(raw));
        console.log(`Directorio del proyecto actualizado: ${result.imported} nombres. No se modificó Epicollect5.`);
    } finally { client.release(); }
})().catch(() => {
    console.error('No se importó el directorio. Revisa la conexión, el archivo y la preparación de auditoría.');
    process.exitCode = 1;
}).finally(() => pool.end());
