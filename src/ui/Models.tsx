import React from 'react';
import { Box, Text } from 'ink';
import type { SourceId, TurnRecord } from '../sources/types.ts';
import type { Theme } from '../theme.ts';
import { applyFilters, modelStats, windowRange } from '../agg/metrics.ts';
import type { WindowKey } from '../agg/metrics.ts';
import { Table } from './comp/Table.tsx';
import type { Column } from './comp/Table.tsx';
import { gaugeBar } from './comp/chart.ts';
import { fmtPct, fmtTok, fmtTps } from '../util/fmt.ts';

export interface ModelsProps {
  records: TurnRecord[];
  now: number;
  theme: Theme;
  srcFilter: SourceId | 'all';
  win?: WindowKey;
  sort: { col: number; dir: 1 | -1 };
  onSort: (col: number) => void;
}

interface DisplayRow {
  model: string; src: SourceId | undefined; srcs: string; reqs: number; inTok: number; outTok: number;
  cacheRead: number; avgTps: number | null; peakTps: number | null; share: number;
}

function fmtMetricTok(value: number): string {
  return fmtTok(value).replace(/k$/, 'K');
}

const COLUMNS: Column<DisplayRow>[] = [
  { key: 'model', header: 'MODEL', width: 22, render: (r) => r.model },
  { key: 'srcs', header: 'SOURCE', width: 8, render: (r) => r.srcs },
  { key: 'reqs', header: 'REQS', width: 5, align: 'r', render: (r) => String(r.reqs) },
  { key: 'inTok', header: 'INPUT', width: 7, align: 'r', render: (r) => fmtMetricTok(r.inTok) },
  { key: 'outTok', header: 'OUTPUT', width: 7, align: 'r', render: (r) => fmtMetricTok(r.outTok) },
  { key: 'cacheRead', header: 'CACHE', width: 7, align: 'r', render: (r) => fmtMetricTok(r.cacheRead) },
  { key: 'avgTps', header: 'AVG TPS', width: 7, align: 'r', render: (r) => fmtTps(r.avgTps) },
  { key: 'peakTps', header: 'PEAK TPS', width: 8, align: 'r', render: (r) => fmtTps(r.peakTps) },
  {
    key: 'share', header: 'SHARE', width: 14, render: (r) => {
      const bar = gaugeBar(r.share, 1, 7, '█', '░');
      return `${bar} ${fmtPct(r.share).padStart(6)}`;
    },
  },
];

export function Models(props: ModelsProps): React.ReactElement {
  const { records, now, theme, srcFilter, win = '7d', sort } = props;
  const filtered = applyFilters(records, srcFilter, windowRange(win, now));
  const stats = modelStats(filtered);
  const rows: DisplayRow[] = stats.map((m) => ({
    model: m.model,
    src: m.srcs[0],
    srcs: m.srcs.map((s) => s.toUpperCase()).join('+'),
    reqs: m.reqs,
    inTok: m.inTok,
    outTok: m.outTok,
    cacheRead: m.cacheRead,
    avgTps: m.avgTps,
    peakTps: m.peakTps,
    share: m.share,
  }));

  const col = COLUMNS[Math.min(sort.col, COLUMNS.length - 1)];
  const key = col.key as keyof DisplayRow;
  const sorted = [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    const cmp =
      typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv));
    return cmp * sort.dir;
  });
  const direction = sort.dir === -1 ? '▼' : '▲';
  const totalOutput = rows.reduce((sum, row) => sum + row.outTok, 0);
  const coloredColumns = COLUMNS.map((c) => {
    if (c.key === 'srcs' || c.key === 'share') {
      return { ...c, color: (row: DisplayRow) => (row.src ? theme.srcColors[row.src] : theme.accent) };
    }
    if (c.key === 'avgTps' || c.key === 'peakTps') {
      return { ...c, color: () => theme.accent };
    }
    return c;
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.border} paddingX={1}>
      <Text bold color={theme.text}>MODELS <Text color={theme.dim}>· token usage & request throughput</Text></Text>
      {sorted.length === 0 ? (
        <Box marginY={1}>
          <Text color={theme.dim}>no models in window —</Text>
        </Box>
      ) : (
        <>
          <Text color={theme.dim}>{rows.length} models · {filtered.length} requests · {fmtMetricTok(totalOutput)} output · {srcFilter === 'all' ? 'all sources' : srcFilter}</Text>
          <Text color={theme.dim}>SORT <Text color={theme.text}>{col.header} {direction}</Text> · {sort.dir === -1 ? 'descending' : 'ascending'}</Text>
          <Box flexDirection="column" marginTop={1}>
            <Table
              columns={coloredColumns.map((c, i) =>
                // active sort column widens by 2 so the direction marker never truncates the header
                i === sort.col
                  ? { ...c, header: `${c.header} ${direction}`, width: c.width + 2 }
                  : c,
              )}
              rows={sorted}
              headerColor={theme.dim}
              dim={theme.dim}
            />
          </Box>
          <Box flexDirection="column" marginTop={1}>
            <Text color={theme.dim}>AVG TPS / PEAK TPS = output tokens / second · SHARE = output-token share</Text>
            <Text color={theme.dim}>←/→ sort column · Enter flip direction</Text>
          </Box>
        </>
      )}
    </Box>
  );
}
