import React from 'react';
import { Box, Text, useStdout } from 'ink';
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
  { key: 'src', header: 'SOURCE', width: 7, render: (r) => r.src },
  { key: 'model', header: 'MODEL', width: 26, render: (r) => r.model },
  { key: 'out', header: 'OUTPUT', width: 8, align: 'r', render: (r) => r.out },
  { key: 'dur', header: 'DURATION', width: 8, align: 'r', render: (r) => r.dur },
  { key: 'tps', header: 'TPS', width: 8, align: 'r', render: (r) => r.tps },
  { key: 'session', header: 'SESSION', width: 10, render: (r) => r.session },
];

function fmtMetricTok(value: number): string {
  return fmtTok(value).replace(/k$/, 'K');
}

export function Requests(props: RequestsProps): React.ReactElement {
  const { records, now, theme, srcFilter, win = '7d', scroll } = props;
  const { stdout } = useStdout();
  const compact = (stdout?.columns ?? 100) < 96;
  const filtered = applyFilters(records, srcFilter, windowRange(win, now));
  const sorted = [...filtered].sort((a, b) => b.ts - a.ts);

  const rows: DisplayRow[] = sorted.map((r) => {
    const d = new Date(r.ts);
    const p = (x: number) => String(x).padStart(2, '0');
    const clock = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    return {
      time: compact ? clock : `${p(d.getMonth() + 1)}-${p(d.getDate())} ${clock}`,
      src: r.src.toUpperCase(),
      model: r.model,
      out: fmtMetricTok(r.outTok),
      dur: fmtDur(r.durMs),
      tps: fmtTps(r.durMs > 0 ? (r.outTok / r.durMs) * 1000 : null),
      session: sidShort(r.sid),
      srcColor: theme.srcColors[r.src],
    };
  });

  const maxStart = Math.max(0, rows.length - VISIBLE);
  const start = Math.max(0, Math.min(scroll, maxStart));
  const end = Math.min(rows.length, start + VISIBLE);
  const sessionCount = new Set(filtered.map((r) => `${r.src}:${r.sid}`)).size;
  const outputTotal = filtered.reduce((sum, r) => sum + r.outTok, 0);
  const columns = COLUMNS
    .filter((c) => !compact || c.key !== 'session')
    .map((c) => {
      if (c.key === 'time') return { ...c, width: compact ? 8 : 14, color: () => theme.dim };
      if (c.key === 'model') return { ...c, width: compact ? 20 : 26 };
      if (c.key === 'src') return { ...c, color: (r: DisplayRow) => r.srcColor };
      if (c.key === 'tps') return { ...c, color: () => theme.accent };
      return c;
    });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.border} paddingX={1}>
      <Text bold color={theme.text}>REQUESTS <Text color={theme.dim}>· request output & timing</Text></Text>
      {rows.length === 0 ? (
        <Box marginY={1}>
          <Text color={theme.dim}>no requests in window —</Text>
        </Box>
      ) : (
        <>
          <Text color={theme.dim}>{rows.length} requests · {sessionCount} sessions · {fmtMetricTok(outputTotal)} output · {srcFilter === 'all' ? 'all sources' : srcFilter}</Text>
          <Box flexDirection="column" marginTop={1}>
            <Table
              columns={columns}
              rows={rows}
              scroll={start}
              visible={VISIBLE}
              headerColor={theme.dim}
              dim={theme.dim}
            />
          </Box>
          <Box flexDirection="column" marginTop={1}>
            <Text color={theme.dim}>SHOWING {start + 1}-{end} / {rows.length} · newest first</Text>
            <Text color={theme.dim}>TPS = output tokens / second · j/k or ↑/↓ scroll · g/G top/bottom</Text>
          </Box>
        </>
      )}
    </Box>
  );
}
