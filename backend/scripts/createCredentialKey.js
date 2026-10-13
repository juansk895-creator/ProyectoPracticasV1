const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const dotenv = require('dotenv');

const envPath = path.resolve(__dirname, '../.env');
try {
    const contents = fs.readFileSync(envPath, 'utf8');
    const parsed = dotenv.parse(contents);
    const existing = process.env.CREDENTIAL_ENCRYPTION_KEY || parsed.CREDENTIAL_ENCRYPTION_KEY;
    if (existing) {
        if (!/^[a-fA-F0-9]{64}$/.test(existing)) throw new Error('invalid-key');
        console.log('La clave ya está configurada; se conserva sin cambios.');
    } else {
        // Se genera localmente y se escribe sin imprimirla en la terminal.
        const line = `CREDENTIAL_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}`;
        const pattern = /^\s*(?:export\s+)?CREDENTIAL_ENCRYPTION_KEY\s*=.*$/m;
        const updated = pattern.test(contents)
            ? contents.replace(pattern, line)
            : `${contents}${contents.endsWith('\n') ? '' : '\n'}${line}\n`;
        fs.writeFileSync(envPath, updated, { mode: 0o600 });
        console.log('Clave creada en backend/.env. Conserva una copia segura junto a tu procedimiento de recuperación.');
    }
} catch (error) {
    console.error(error.code === 'ENOENT'
        ? 'Falta backend/.env. Crea ese archivo a partir de .env.example antes de generar la clave.'
        : 'No se generó la clave. Revisa el acceso a backend/.env y la configuración existente.');
    process.exitCode = 1;
}
