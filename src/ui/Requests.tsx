import React from 'react';
import { Box, Text } from 'ink';
import type { SourceId, TurnRecord } from '../sources/types.ts';
import type { Theme } from '../theme.ts';
import { applyFilters, windowRange } from '../agg/metrics.ts';
import type { WindowKey } from '../agg/metrics.ts';
import { Table } from './comp/Table.tsx';
import type { Column } from './comp/Table.tsx';
import { fmtDur, fmtTok, fmtTps, sidShort } from '../util/fmt.ts';

export interface RequestsProps {
  records: TurnRecord[];
  now: number;
  theme: Theme;
  srcFilter: SourceId | 'all';
  win?: WindowKey;
  scroll: number;
}

const VISIBLE = 10;

interface DisplayRow {
  time: string; src: string; model: string; out: string; dur: string; tps: string; session: string;
  srcColor?: string;
}

const COLUMNS: Column<DisplayRow>[] = [
  { key: 'time', header: 'TIME', width: 14, render: (r) => r.time },
  { key: 'src', header: 'SRC', width: 7, render: (r) => r.src },
  { key: 'model', header: 'MODEL', width: 26, render: (r) => r.model },
  { key: 'out', header: 'OUT', width: 8, align: 'r', render: (r) => r.out },
  { key: 'dur', header: 'DUR', width: 8, align: 'r', render: (r) => r.dur },
  { key: 'tps', header: 'TOK·S', width: 8, align: 'r', render: (r) => r.tps },
  { key: 'session', header: 'SESSION', width: 10, render: (r) => r.session },
];

export function Requests(props: RequestsProps): React.ReactElement {
  const { records, now, theme, srcFilter, win = '7d', scroll } = props;
  const filtered = applyFilters(records, srcFilter, windowRange(win, now));
  const sorted = [...filtered].sort((a, b) => b.ts - a.ts);

  const rows: DisplayRow[] = sorted.map((r) => {
    const d = new Date(r.ts);
    const p = (x: number) => String(x).padStart(2, '0');
    return {
      time: `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`,
      src: r.src.toUpperCase(),
      model: r.model,
      out: fmtTok(r.outTok),
      dur: fmtDur(r.durMs),
      tps: fmtTps(r.durMs > 0 ? (r.outTok / r.durMs) * 1000 : null),
      session: sidShort(r.sid),
      srcColor: theme.srcColors[r.src],
    };
  });

  const maxStart = Math.max(0, rows.length - VISIBLE);
  const start = Math.max(0, Math.min(scroll, maxStart));
  const end = Math.min(rows.length, start + VISIBLE);

  return (
    <Box flexDirection="column">
      <Text bold color={theme.text}>REQUESTS · j/k scroll · g/G top/bottom{srcFilter !== 'all' ? ` · ${srcFilter}` : ''}</Text>
      {rows.length === 0 ? (
        <Box borderStyle="round" borderColor={theme.border} paddingX={1} marginY={1}>
          <Text color={theme.dim}>no requests in window —</Text>
        </Box>
      ) : (
        <>
          <Table
            columns={COLUMNS.map((c) =>
              c.key === 'src' ? { ...c, color: (r: DisplayRow) => r.srcColor } : c,
            )}
            rows={rows}
            scroll={start}
            visible={VISIBLE}
          />
          <Text color={theme.dim}>showing {start + 1}-{end} of {rows.length} · j/k scroll</Text>
        </>
      )}
    </Box>
  );
}
