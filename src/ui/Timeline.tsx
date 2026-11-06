import React from 'react';
import { Box, Text, useStdout } from 'ink';
import type { SourceId, TurnRecord } from '../sources/types.ts';
import type { Theme } from '../theme.ts';
import { applyFilters, buckets, windowRange } from '../agg/metrics.ts';
import type { WindowKey } from '../agg/metrics.ts';
import { hexToAnsi } from './comp/chart.ts';
import { fmtTok } from '../util/fmt.ts';

export interface TimelineProps {
  records: TurnRecord[];
  now: number;
  theme: Theme;
  srcFilter: SourceId | 'all';
  win: WindowKey;
}

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');

/**
 * Bars per source (dominant source colors the bucket) with a 5-bucket moving-average
 * trend dotted in the accent color. Returns `height` strings, top row first.
 */
export function timelineChart(
  series: { values: number[]; color: string }[],
  height: number,
  accent: string,
): string[] {
  const n = series[0]?.values.length ?? 0;
  if (n === 0 || height <= 0) return [];
  const totals = series[0].values.map((_, b) => series.reduce((s, ss) => s + ss.values[b], 0));
  const ma = totals.map((_, i) => {
    const from = Math.max(0, i - 4);
    const slice = totals.slice(from, i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
  const maxBar = Math.max(1, ...totals);
  const maxMa = Math.max(1, ...ma);
  const pixels = height * 2;
  const rows: string[] = [];
  for (let r = 0; r < height; r++) {
    const pft = (height - 1 - r) * 2; // pixel band of this text row, from the top
    let line = '';
    for (let b = 0; b < n; b++) {
      let dom = series[0];
      let best = -1;
      for (const s of series) {
        if (s.values[b] > best) {
          best = s.values[b];
          dom = s;
        }
      }
      const f = Math.round((totals[b] / maxBar) * pixels);
      const topOn = f > pft + 1;
      const botOn = f > pft;
      const mp = Math.round((ma[b] / maxMa) * pixels); // MA height in pixels
      const maInBand = mp >= pft + 1 && mp <= pft + 2;
      if (maInBand && !topOn) {
        line += hexToAnsi(accent) + '·' + '\x1b[0m';
      } else if (topOn && botOn) {
        line += hexToAnsi(dom.color) + '█' + '\x1b[0m';
      } else if (topOn) {
        line += hexToAnsi(dom.color) + '▀' + '\x1b[0m';
      } else if (botOn) {
        line += hexToAnsi(dom.color) + '▄' + '\x1b[0m';
      } else {
        line += ' ';
      }
    }
    rows.push(line);
  }
  return rows;
}

function bucketCount(win: WindowKey, spanMs: number): number {
  switch (win) {
    case 'today': return 24;
    case '7d': return 28;
    case '30d': return 30;
    case 'all': return Math.max(1, Math.min(40, Math.ceil(spanMs / 86400_000)));
  }
}

function fmtLabel(ts: number, withHour: boolean): string {
  const d = new Date(ts);
  const p = (x: number) => String(x).padStart(2, '0');
  return withHour
    ? `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}h`
    : `${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function timelineAxis(start: string, end: string, width: number): string {
  if (width <= 0) return '';
  if (start.length + end.length + 1 > width) return `${start} ${end}`.slice(0, width);
  return start + ' '.repeat(width - start.length - end.length) + end;
}

function fmtMetricTok(value: number): string {
  return fmtTok(value).replace(/k$/, 'K');
}

export function Timeline(props: TimelineProps): React.ReactElement {
  const { records, now, theme, srcFilter, win } = props;
  const { stdout } = useStdout();
  const width = stdout?.columns ?? 100;

  const selectedRange = windowRange(win, now);
  const filtered = applyFilters(records, srcFilter, selectedRange);
  let minTs = Infinity, maxTs = -Infinity;
  for (const r of filtered) {
    if (r.ts < minTs) minTs = r.ts;
    if (r.ts > maxTs) maxTs = r.ts;
  }
  const range = win === 'all'
    ? Number.isFinite(minTs)
      ? { from: minTs, to: maxTs + 1 }
      : { from: now - 86400_000, to: now }
    : selectedRange;
  // plan bucket counts: today 24 / 7d 28 / 30d 30 / all ≤40 — chart width follows, not vice versa
  const n = Math.max(4, Math.min(bucketCount(win, range.to - range.from), Math.max(10, width - 24)));
  const bs = buckets(filtered, range, n);
  const bucketMs = (range.to - range.from) / n;

  const srcs = [...new Set(filtered.map((r) => r.src))];
  const series = srcs.map((src) => ({
    src,
    values: bs.map((b) => b.out[src] ?? 0),
    color: theme.srcColors[src] ?? theme.accent,
  }));
  const rows = timelineChart(series, 8, theme.accent);

  const outTotal = filtered.reduce((s, r) => s + r.outTok, 0);
  const inTotal = filtered.reduce((s, r) => s + r.inTok, 0);
  const cacheTotal = filtered.reduce((s, r) => s + r.cacheRead, 0);
  let peakIdx = 0;
  let peakVal = -1;
  const totals = bs.map((b) => Object.values(b.out).reduce((a, c) => a + c, 0));
  totals.forEach((v, i) => {
    if (v > peakVal) {
      peakVal = v;
      peakIdx = i;
    }
  });
  const withHour = bucketMs < 86400_000;
  const bucketText = win === 'today' ? 'hourly buckets' : win === '7d' ? '6h buckets' : win === '30d' ? 'daily buckets' : 'automatic buckets';
  const startLabel = fmtLabel(bs[0].t0, withHour);
  const endLabel = fmtLabel(bs[bs.length - 1].t0 + bucketMs, withHour);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.border} paddingX={1}>
      <Text bold color={theme.text}>TIMELINE <Text color={theme.dim}>· output tokens / time bucket</Text></Text>
      {filtered.length === 0 ? (
        <Box marginY={1}>
          <Text color={theme.dim}>no activity in window —</Text>
        </Box>
      ) : (
        <>
          <Text color={theme.dim}>{bucketText} · {srcFilter === 'all' ? 'all sources' : srcFilter} · {filtered.length} requests</Text>
          <Box flexDirection="column" marginTop={1}>
            {rows.map((line, i) => <Text key={i}>{line}</Text>)}
          </Box>
          <Text color={theme.dim}>{timelineAxis(startLabel, endLabel, n)}</Text>
          <Box columnGap={3} marginTop={1}>
            <Text color={theme.dim}>OUTPUT <Text bold color={theme.text}>{fmtMetricTok(outTotal)}</Text></Text>
            <Text color={theme.dim}>INPUT <Text color={theme.text}>{fmtMetricTok(inTotal)}</Text></Text>
            <Text color={theme.dim}>CACHE READ <Text color={theme.text}>{fmtMetricTok(cacheTotal)}</Text></Text>
          </Box>
          <Text color={theme.dim}>PEAK <Text bold color={theme.accent}>{fmtMetricTok(peakVal)}</Text> / bucket @ {fmtLabel(bs[peakIdx].t0, withHour)}</Text>
          <Box columnGap={2} marginTop={1}>
            <Text color={theme.dim}>SOURCES</Text>
            {series.map((s) => (
              <Text key={s.src} color={s.color}>● {s.src} <Text color={theme.dim}>{fmtMetricTok(s.values.reduce((a, b) => a + b, 0))}</Text></Text>
            ))}
            <Text color={theme.dim}><Text color={theme.accent}>·</Text> 5-bucket trend</Text>
          </Box>
        </>
      )}
    </Box>
  );
}
