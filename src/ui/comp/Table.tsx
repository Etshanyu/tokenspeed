import React from 'react';
import { Text } from 'ink';
import { displayWidth, truncateToWidth } from '../../util/fmt.ts';

export interface Column<T> {
  key: string;
  header: string;
  width: number;
  align?: 'l' | 'r';
  render: (row: T, idx: number) => string;
  color?: (row: T) => string | undefined;
}

function fitCell(s: string, width: number, align: 'l' | 'r'): string {
  const t = truncateToWidth(s, width);
  const pad = Math.max(0, width - displayWidth(t));
  return align === 'r' ? ' '.repeat(pad) + t : t + ' '.repeat(pad);
}

export function Table<T>(props: {
  columns: Column<T>[];
  rows: T[];
  scroll?: number;
  visible?: number;
  headerColor?: string;
  dim?: string;
}): React.ReactElement {
  const { columns, rows, scroll = 0, visible, headerColor = 'gray', dim = 'gray' } = props;
  const start = Math.max(0, Math.min(scroll, Math.max(0, rows.length - 1)));
  const end = visible === undefined ? rows.length : Math.min(rows.length, start + visible);
  const windowRows = rows.slice(start, end);

  const headerCells = columns.map((c) => fitCell(c.header, c.width, c.align ?? 'l'));
  const sep = ' ';

  const body = windowRows.map((row, i) => {
    const globalIdx = start + i;
    const cells = columns.map((c) => {
      const txt = fitCell(c.render(row, globalIdx), c.width, c.align ?? 'l');
      const color = c.color?.(row);
      return color ? (
        <Text key={c.key} color={color}>{txt}</Text>
      ) : (
        <Text key={c.key}>{txt}</Text>
      );
    });
    return (
      <Text key={globalIdx}>
        {cells.flatMap((cell, ci) => (ci === 0 ? [cell] : [sep, cell]))}
      </Text>
    );
  });

  return (
    <>
      <Text color={headerColor} bold>{headerCells.join(sep)}</Text>
      {body.length === 0 ? <Text color={dim}>—</Text> : body}
    </>
  );
}
