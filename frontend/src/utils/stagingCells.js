const RECORD_TYPES = { form: 'Formulario principal', child: 'Formulario hijo', branch: 'Rama' };

export function getCellValue(row, column) {
    if (column.key === 'record_type') return RECORD_TYPES[row.record_type] || row.record_type;
    if (column.source === 'field_values') {
        if (row.project_id !== column.project_id || row.form_ref !== column.form_ref) return null;
        return row.field_values?.[column.input_ref];
    }
    if (column.source === 'payload') return column.path.split('.').reduce((value, part) => value?.[part], row.payload);
    return row[column.key];
}

export function formatCellValue(value, column) {
    if (value === null || value === undefined || value === '') return '-';
    const optionLabel = (item) => column.options?.find((option) => option.value === String(item))?.label ?? String(item);
    if (column.type === 'choice') return optionLabel(value);
    if (column.type === 'choices' && Array.isArray(value)) return value.map(optionLabel).join(', ') || '-';
    if (column.type === 'location' && typeof value === 'object') {
        if (value.latitude !== undefined && value.longitude !== undefined) {
            return `${value.latitude}, ${value.longitude}${value.accuracy !== undefined ? ` (±${value.accuracy} m)` : ''}`;
        }
    }
    if (column.type === 'datetime') {
        const date = new Date(value);
        if (!Number.isNaN(date.getTime())) return date.toLocaleString();
    }
    if (typeof value === 'boolean') return value ? 'Sí' : 'No';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}
