import React from 'react';

/**
 * Placeholder rows shown while a table's data loads. Renders `rows` shimmering
 * `<tr>`s with `cols` cells each, so it must be placed inside a `<tbody>`.
 * The first cell is rendered wider (name/label column) unless disabled.
 */
export default function TableSkeleton({
  rows = 8,
  cols,
  firstColWide = true,
}: {
  rows?: number;
  cols: number;
  firstColWide?: boolean;
}) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={`sk-${i}`} className="animate-pulse">
          {Array.from({ length: cols }).map((__, j) => (
            <td key={j} className="px-5 py-4">
              <div className={`h-4 rounded bg-line/40 ${j === 0 && firstColWide ? 'w-40' : 'w-16'}`} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
