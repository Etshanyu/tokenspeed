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
  model: string; srcs: string; reqs: number; inTok: number; outTok: number;
  cacheRead: number; avgTps: number | null; peakTps: number | null; share: number;
}

const COLUMNS: Column<DisplayRow>[] = [
  { key: 'model', header: 'MODEL', width: 24, render: (r) => r.model },
  { key: 'srcs', header: 'SRC', width: 8, render: (r) => r.srcs },
  { key: 'reqs', header: 'REQS', width: 5, align: 'r', render: (r) => String(r.reqs) },
  { key: 'inTok', header: 'IN', width: 7, align: 'r', render: (r) => fmtTok(r.inTok) },
  { key: 'outTok', header: 'OUT', width: 7, align: 'r', render: (r) => fmtTok(r.outTok) },
  { key: 'cacheRead', header: 'CACHE', width: 7, align: 'r', render: (r) => fmtTok(r.cacheRead) },
  { key: 'avgTps', header: 'AVG TKS', width: 7, align: 'r', render: (r) => fmtTps(r.avgTps) },
  { key: 'peakTps', header: 'PEAK', width: 6, align: 'r', render: (r) => fmtTps(r.peakTps) },
  {
    key: 'share', header: 'SHARE', width: 16, render: (r) => {
      const bar = gaugeBar(r.share, 1, 9, '█', '░');
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

  return (
    <Box flexDirection="column">
      <Text bold color={theme.text}>MODELS · ←/→ sort column · enter flip · {srcFilter !== 'all' ? srcFilter : 'all sources'}</Text>
      {sorted.length === 0 ? (
        <Box borderStyle="round" borderColor={theme.border} paddingX={1} marginY={1}>
          <Text color={theme.dim}>no models in window —</Text>
        </Box>
      ) : (
        <Table
          columns={COLUMNS.map((c, i) =>
            i === sort.col
              ? { ...c, header: (c.header.includes('▼') || c.header.includes('▲') ? c.header.slice(0, -2) : c.header) + (sort.dir === -1 ? ' ▼' : ' ▲'), width: c.width }
              : c,
          )}
          rows={sorted}
        />
      )}
    </Box>
  );
}
