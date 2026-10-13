const path = require('node:path');

// La ubicación del .env no depende de la carpeta desde la que se ejecute Node.
require('dotenv').config({
    path: path.resolve(__dirname, '../../.env'),
    quiet: true,
});
