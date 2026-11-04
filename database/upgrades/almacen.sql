-- Almacén final (Módulo 4), fase 1: catálogo de la ficha, proyección y datos.
-- Aplicado por almacen:migrate dentro de una transacción. Las tablas usan el prefijo almacen_
-- en el esquema actual, como el resto del sistema; el acceso de análisis se concede sólo
-- sobre las vistas almacen_v_*.

-- Catálogo: lo que declara la ficha de correspondencia.
CREATE TABLE IF NOT EXISTS almacen_encuestas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clave VARCHAR(40) NOT NULL UNIQUE CHECK (clave ~ '^[a-z][a-z0-9_]{0,39}$'),
    nombre TEXT NOT NULL CHECK (length(nombre) BETWEEN 1 AND 200),
    actualizada_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS almacen_secciones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    encuesta_id UUID NOT NULL REFERENCES almacen_encuestas(id) ON DELETE CASCADE,
    clave VARCHAR(40) NOT NULL CHECK (clave ~ '^[a-z][a-z0-9_]{0,39}$'),
    etiqueta TEXT NOT NULL,
    UNIQUE (encuesta_id, clave)
);

CREATE TABLE IF NOT EXISTS almacen_variables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- NULL = núcleo común, compartido por todas las encuestas.
    encuesta_id UUID REFERENCES almacen_encuestas(id) ON DELETE CASCADE,
    seccion_id UUID REFERENCES almacen_secciones(id) ON DELETE CASCADE,
    clave VARCHAR(48) NOT NULL CHECK (clave ~ '^[a-z][a-z0-9_]{0,47}$'),
    etiqueta TEXT NOT NULL,
    tipo VARCHAR(10) NOT NULL CHECK (tipo IN ('texto', 'entero', 'decimal', 'fecha', 'categoria')),
    si_falta VARCHAR(12) NOT NULL CHECK (si_falta IN ('invalida', 'recuperable', 'opcional')),
    categorias JSONB,
    rango_min NUMERIC,
    rango_max NUMERIC,
    orden INTEGER NOT NULL,
    CHECK ((tipo = 'categoria') = (categorias IS NOT NULL)),
    CHECK (rango_min IS NULL OR rango_max IS NULL OR rango_min <= rango_max),
    CHECK (encuesta_id IS NOT NULL OR seccion_id IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_almacen_variables_nucleo ON almacen_variables (clave) WHERE encuesta_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_almacen_variables_encuesta ON almacen_variables (encuesta_id, clave) WHERE encuesta_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS almacen_levantamientos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    encuesta_id UUID NOT NULL REFERENCES almacen_encuestas(id) ON DELETE CASCADE,
    anio INTEGER NOT NULL CHECK (anio BETWEEN 1990 AND 2200),
    staging_project_id UUID NOT NULL UNIQUE REFERENCES staging_projects(id),
    principal_form_ref VARCHAR(150) NOT NULL,
    UNIQUE (encuesta_id, anio),
    FOREIGN KEY (staging_project_id, principal_form_ref) REFERENCES staging_streams(project_id, form_ref)
);

CREATE TABLE IF NOT EXISTS almacen_levantamiento_secciones (
    levantamiento_id UUID NOT NULL REFERENCES almacen_levantamientos(id) ON DELETE CASCADE,
    seccion_id UUID NOT NULL REFERENCES almacen_secciones(id) ON DELETE CASCADE,
    staging_project_id UUID NOT NULL,
    form_ref VARCHAR(150) NOT NULL,
    PRIMARY KEY (levantamiento_id, seccion_id),
    UNIQUE (levantamiento_id, form_ref),
    FOREIGN KEY (staging_project_id, form_ref) REFERENCES staging_streams(project_id, form_ref)
);

CREATE TABLE IF NOT EXISTS almacen_correspondencias (
    levantamiento_id UUID NOT NULL REFERENCES almacen_levantamientos(id) ON DELETE CASCADE,
    variable_id UUID NOT NULL REFERENCES almacen_variables(id) ON DELETE CASCADE,
    form_ref VARCHAR(150) NOT NULL,
    input_ref VARCHAR(150) NOT NULL,
    -- answer_ref de Epicollect5 -> código de la categoría. NULL salvo en variables de tipo categoria.
    opciones JSONB,
    -- Formato con que Epicollect5 entrega la fecha (datetime_format de la pregunta), p. ej. dd/MM/YYYY.
    formato_fecha VARCHAR(20),
    PRIMARY KEY (levantamiento_id, variable_id),
    UNIQUE (levantamiento_id, input_ref)
);
ALTER TABLE almacen_correspondencias ADD COLUMN IF NOT EXISTS formato_fecha VARCHAR(20);

-- Se guardan desde la fase 1 para no perderlas al cargar la ficha; se ejecutan en la fase 2.
CREATE TABLE IF NOT EXISTS almacen_reglas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    encuesta_id UUID REFERENCES almacen_encuestas(id) ON DELETE CASCADE,
    clave VARCHAR(60) NOT NULL CHECK (clave ~ '^[a-z][a-z0-9_]{0,59}$'),
    efecto VARCHAR(10) NOT NULL CHECK (efecto IN ('rechaza', 'observa')),
    definicion JSONB NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_almacen_reglas_clave ON almacen_reglas (COALESCE(encuesta_id::text, ''), clave);

-- Datos: lo que produce la proyección desde staging.
CREATE TABLE IF NOT EXISTS almacen_cuestionarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    levantamiento_id UUID NOT NULL REFERENCES almacen_levantamientos(id),
    origen_project_id UUID NOT NULL,
    origen_form_ref VARCHAR(150) NOT NULL,
    origen_entry_uuid UUID NOT NULL,
    origen_version TIMESTAMPTZ,
    estado VARCHAR(10) NOT NULL DEFAULT 'pendiente'
        CHECK (estado IN ('pendiente', 'aceptado', 'observado', 'rechazado', 'retirado')),
    desactualizado BOOLEAN NOT NULL DEFAULT false,
    proyectado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (origen_project_id, origen_form_ref, origen_entry_uuid),
    FOREIGN KEY (origen_project_id, origen_form_ref, origen_entry_uuid)
        REFERENCES entradas_staging(project_id, form_ref, entry_uuid)
);
CREATE INDEX IF NOT EXISTS idx_almacen_cuestionarios_levantamiento ON almacen_cuestionarios (levantamiento_id, estado);

CREATE TABLE IF NOT EXISTS almacen_registros (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cuestionario_id UUID NOT NULL REFERENCES almacen_cuestionarios(id) ON DELETE CASCADE,
    -- NULL = el registro principal del cuestionario.
    seccion_id UUID REFERENCES almacen_secciones(id),
    padre_id UUID REFERENCES almacen_registros(id) ON DELETE CASCADE,
    origen_form_ref VARCHAR(150) NOT NULL,
    origen_entry_uuid UUID NOT NULL,
    UNIQUE (cuestionario_id, origen_form_ref, origen_entry_uuid),
    CHECK ((seccion_id IS NULL) = (padre_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_almacen_registros_principal ON almacen_registros (cuestionario_id) WHERE seccion_id IS NULL;

CREATE TABLE IF NOT EXISTS almacen_respuestas (
    registro_id UUID NOT NULL REFERENCES almacen_registros(id) ON DELETE CASCADE,
    variable_id UUID NOT NULL REFERENCES almacen_variables(id),
    valor_texto TEXT,
    valor_numero NUMERIC,
    valor_fecha DATE,
    condicion VARCHAR(16) NOT NULL
        CHECK (condicion IN ('respondida', 'no_contesto', 'no_se_pregunto', 'no_interpretable')),
    valor_origen JSONB,
    PRIMARY KEY (registro_id, variable_id),
    CHECK (condicion = 'respondida' OR (valor_texto IS NULL AND valor_numero IS NULL AND valor_fecha IS NULL)),
    CHECK (num_nonnulls(valor_texto, valor_numero, valor_fecha) <= 1)
);
CREATE INDEX IF NOT EXISTS idx_almacen_respuestas_variable ON almacen_respuestas (variable_id);
