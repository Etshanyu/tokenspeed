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
import { t } from './i18n.ts';
import type { Language } from './i18n.ts';

export interface ModelsProps {
  records: TurnRecord[];
  now: number;
  theme: Theme;
  srcFilter: SourceId | 'all';
  win?: WindowKey;
  sort: { col: number; dir: 1 | -1 };
  onSort: (col: number) => void;
  lang?: Language;
}

interface DisplayRow {
  model: string; src: SourceId | undefined; srcs: string; reqs: number; inTok: number; outTok: number;
  cacheRead: number; avgTps: number | null; peakTps: number | null; share: number;
}

function fmtMetricTok(value: number): string {
  return fmtTok(value).replace(/k$/, 'K');
}

function modelColumns(lang: Language): Column<DisplayRow>[] {
  return [
    { key: 'model', header: t(lang, 'modelColumn'), width: 22, render: (r) => r.model },
    { key: 'srcs', header: t(lang, 'sourceColumn'), width: 8, render: (r) => r.srcs },
    { key: 'reqs', header: t(lang, 'reqs'), width: lang === 'zh' ? 6 : 5, align: 'r', render: (r) => String(r.reqs) },
    { key: 'inTok', header: t(lang, 'inputColumn'), width: 7, align: 'r', render: (r) => fmtMetricTok(r.inTok) },
    { key: 'outTok', header: t(lang, 'outputColumn'), width: 7, align: 'r', render: (r) => fmtMetricTok(r.outTok) },
    { key: 'cacheRead', header: t(lang, 'cache'), width: 7, align: 'r', render: (r) => fmtMetricTok(r.cacheRead) },
    { key: 'avgTps', header: t(lang, 'avgTps'), width: lang === 'zh' ? 8 : 7, align: 'r', render: (r) => fmtTps(r.avgTps) },
    { key: 'peakTps', header: t(lang, 'peakTps'), width: 8, align: 'r', render: (r) => fmtTps(r.peakTps) },
    {
      key: 'share', header: t(lang, 'share'), width: 14, render: (r) => {
        const bar = gaugeBar(r.share, 1, 7, '█', '░');
        return `${bar} ${fmtPct(r.share).padStart(6)}`;
      },
    },
  ];
}

export function Models(props: ModelsProps): React.ReactElement {
  const { records, now, theme, srcFilter, win = '7d', sort, lang = 'en' } = props;
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

  const columns = modelColumns(lang);
  const col = columns[Math.min(sort.col, columns.length - 1)];
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
  const coloredColumns = columns.map((c) => {
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
      <Text bold color={theme.text}>{t(lang, 'pageModels').toUpperCase()} <Text color={theme.dim}>· {t(lang, 'modelsSubtitle')}</Text></Text>
      {sorted.length === 0 ? (
        <Box marginY={1}>
          <Text color={theme.dim}>{t(lang, 'noModelsWindow')}</Text>
        </Box>
      ) : (
        <>
          <Text color={theme.dim}>{rows.length} {t(lang, 'models')} · {filtered.reduce((sum, r) => sum + (r.kind === 'session' ? (r.requestCount ?? 0) : 1), 0)} {t(lang, 'requests')} · {fmtMetricTok(totalOutput)} {t(lang, 'output')} · {srcFilter === 'all' ? t(lang, 'allSources') : srcFilter}</Text>
          <Text color={theme.dim}>{t(lang, 'sortLabel')} <Text color={theme.text}>{col.header} {direction}</Text> · {t(lang, sort.dir === -1 ? 'descending' : 'ascending')}</Text>
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
            <Text color={theme.dim}>{t(lang, 'modelTimingNote')}</Text>
            <Text color={theme.dim}>{t(lang, 'shareSortNote')}</Text>
          </Box>
        </>
      )}
    </Box>
  );
}
