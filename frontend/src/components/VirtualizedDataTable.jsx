import { useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

const ROW_HEIGHT = 49;
const OVERSCAN = 12;

function getNestedValue(source, path) {
    if (!source || !path) {
        return null;
    }

    return path.split('.').reduce(
        (current, segment) => current?.[segment],
        source,
    );
}

function getCellValue(row, column) {
    if (column.source === 'payload') {
          return getNestedValue(
            row.payload,
            column.path,
          );
    }
    return row[column.key];
}

function formatCellValue(value, column) {
    if (value === null || value === undefined) {
        return '-';
    }

    if (column.type === 'datetime') {
        const date = new Date(value);

        if (!Number.isNaN(date.getTime())) {
            return date.toLocaleString();
        }
    }

    if (typeof value === 'boolean') {
        return value ? 'Sí' : 'No';
    }

    if (typeof value === 'object') {
        return JSON.stringify(value);
    }

    return String(value);
}

export default function VirtualizedDataTable({
    columns,
    rows,
    resetKey,
}) {
    const scrollContainerRef = useRef(null);

    const rowVirtualizer = useVirtualizer({
        count: rows.length,
        getCrollElement: () =>
            scrollContainerRef.current,
        estimateSize: () => ROW_HEIGHT,
        getItemKey: (index) =>
            rows[index]?.ec5_uuid ?? index,
        overscan: OVERSCAN,
        useFlushSync: false,
    });

    const virtualRows = rowVirtualizer.getVirtualItems();

    const totalSize = rowVirtualizer.getTotalSize();

    const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;

    const paddingBottom = virtualRows.length > 0 ? totalSize - virtualRows[virtualRows.length - 1].end : 0;

    const columnSpan = Math.max(
        columns.length,
        1,
    );

    useEffect(() => {
        if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = 0;
        }
    }, [resetKey]);

    return (
        <div>
            <div className='mb-2 flex flex-wrap justify-between gap-2 text-xs text-slate-500'>
                <span>
                    {rows.length} Filas cargadas
                </span>

                <span>
                    {virtualRows.length} filas montadas en pantalla
                </span>
            </div>

            <div
                className='h-[65vh] min-h-[360px] max-h[720px] overflow-auto rounded-lg border border-slate-200'
                ref={scrollContainerRef}
            >
                <table className='min-w-max border-separate border-spacing-0 text-left text-sm'>
                    <thead className='sticky top-0 z-10 bg-slate-50 shadow-sm'>
                        <tr>
                            {columns.map((column) => (
                                <th
                                    className='min-w-40 border-b border-r border-slate-200 p-3 font-semibold'
                                    key={column.key}
                                >
                                    {column.label}
                                </th>
                            ))}
                        </tr>
                    </thead>

                    <tbody>
                        {paddingTop > 0 && (
                            <tr
                                aria-hidden='true'
                                style={{
                                    height: `${paddingTop}px`,
                                }}
                            >
                                <td
                                    className='border-0 p-0'
                                    colSpan={columnSpan}
                                />
                            </tr>
                        )}

                        {virtualRows.map(
                            (virtualRow) => {
                                const row = rows[virtualRow.index];

                                return (
                                    <tr
                                        className='hover:bg-slate-50'
                                        data-row-index={
                                            virtualRow.index
                                        }
                                        key={
                                            virtualRow.key
                                        }
                                        style={{
                                            height: `${virtualRow.size}px`,
                                        }}
                                    >
                                        {columns.map(
                                            (column) => {
                                                const formattedValue = formatCellValue(
                                                    getCellValue(row, column),
                                                    column,
                                                );

                                                return (
                                                    <td
                                                        className='h-12 max-h-80 border-b border-r border-slate-100 p-3'
                                                        key={
                                                            column.key
                                                        }
                                                        title={
                                                            formattedValue
                                                        }
                                                    >
                                                        <div className='max-w-72 truncate'>
                                                            { formattedValue }
                                                        </div>
                                                    </td>
                                                );
                                            },
                                        )}
                                    </tr>
                                );
                            },
                        )}

                        {paddingBottom > 0 && (
                            <tr
                                aria-hidden='true'
                                style={{
                                    height: `${paddingBottom}px`,
                                }}
                            >
                                <td
                                    className='border-0 p-0'
                                    colSpan={columnSpan}
                                />
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}


