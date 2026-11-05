import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import { ADAPTERS } from '../sources/index.ts';
import type { SourceId, TurnRecord } from '../sources/types.ts';
import type { Theme } from '../theme.ts';
import {
  applyFilters, buckets, latestSessions, modelStats, sourceSummaries, windowRange,
} from '../agg/metrics.ts';
import type { WindowKey } from '../agg/metrics.ts';
import { Table } from './comp/Table.tsx';
import type { Column } from './comp/Table.tsx';
import { gaugeBar, heatStrip, histogram, sparkline } from './comp/chart.ts';
import { fmtDur, fmtTok, fmtTps, sidShort, truncateToWidth, displayWidth } from '../util/fmt.ts';

export interface OverviewProps {
  records: TurnRecord[];
  now: number;
  theme: Theme;
  srcFilter: SourceId | 'all';
  win?: WindowKey;
}

/** Width planner: histogram buckets must fit beside MODEL VELOCITY inside the bordered panel. */
export function overviewLayout(width: number, nSeries: number): { histBuckets: number; velocityWidth: number } {
  const velocityWidth = 54; // 22 model + 1 + 24 gauge + 1 + 6 tps
  const content = width - 6; // box border (2) + padding (2) + safety (2)
  const avail = Math.max(6, content - velocityWidth - 2);
  return {
    velocityWidth,
    histBuckets: Math.max(4, Math.floor(avail / Math.max(1, nSeries))),
  };
}

/** 2-step value tween: enough motion to notice, not enough to flicker */
function useTween(target: number | null): number | null {
  const [display, setDisplay] = useState<number | null>(target);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (display === null || target === null || display === target) {
      setDisplay(target);
      return;
    }
    const steps = 2;
    let i = 1;
    const from = display;
    const tick = (): void => {
      setDisplay(from + ((target - from) * i) / steps);
      if (i++ < steps) timer.current = setTimeout(tick, 80);
    };
    timer.current = setTimeout(tick, 80);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  return display;
}

function SourceCard(props: {
  label: string; color: string; avgTps: number | null;
  activeMs: number; totalTok: number; spark: number[]; theme: Theme;
}): React.ReactElement {
  const tps = useTween(props.avgTps);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={props.color} paddingX={1} minWidth={26}>
      <Box justifyContent="space-between">
        <Text bold color={props.color}>{props.label}</Text>
        <Text>
          <Text bold color={props.theme.text}>{fmtTps(tps)}</Text>
          <Text color={props.theme.dim}> tok/s</Text>
        </Text>
      </Box>
      <Text color={props.theme.dim}>Σ {fmtDur(props.activeMs)} · {fmtTok(props.totalTok)} tok</Text>
      {histogram([{ values: props.spark, color: props.color }], 22, 2).map((line, i) => (
        <Text key={i}>{line}</Text>
      ))}
    </Box>
  );
}

interface SessionDisplayRow {
  sid: string; started: string; lastActive: string; dur: string;
  tps: string; tokens: string; src: string; recent: boolean;
}

const sessionColumns: Column<SessionDisplayRow>[] = [
  { key: 'sid', header: 'SESSION', width: 10, render: (r) => r.sid },
  { key: 'started', header: 'STARTED', width: 13, render: (r) => r.started },
  { key: 'lastActive', header: 'LAST ACTIVE', width: 13, render: (r) => r.lastActive },
  { key: 'dur', header: 'DURATION', width: 8, align: 'r', render: (r) => r.dur },
  { key: 'tps', header: 'TOK·S', width: 8, align: 'r', render: (r) => r.tps },
  { key: 'tokens', header: 'TOKENS', width: 9, align: 'r', render: (r) => r.tokens },
  { key: 'src', header: 'SRC', width: 7, render: (r) => r.src.toUpperCase() },
];

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtDate(ts: number): string {
  const d = new Date(ts);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function Overview(props: OverviewProps): React.ReactElement {
  const { records, now, theme, srcFilter, win = '7d' } = props;
  const { stdout } = useStdout();
  const width = stdout?.columns ?? 100;

  const filtered = applyFilters(records, srcFilter, windowRange(win, now));
  const summaries = sourceSummaries(filtered);

  // one card per source (screenshot layout), no aggregate headline
  const cards: React.ReactElement[] = [];
  for (const s of summaries) {
    const adapter = ADAPTERS.find((a) => a.id === s.src);
    cards.push(
      <SourceCard key={s.src} label={adapter?.label ?? s.src} color={theme.srcColors[s.src] ?? theme.accent}
        avgTps={s.avgTps} activeMs={s.activeMs}
        totalTok={s.inTok + s.outTok + s.cacheRead + s.cacheWrite}
        spark={s.spark} theme={theme} />,
    );
  }

  const stripWidth = Math.max(20, Math.min(60, width - 22));
  const models = modelStats(filtered).slice(0, 5);
  let maxTps = 1;
  for (const m of models) maxTps = Math.max(maxTps, m.avgTps ?? 0);

  const histSources = [...new Set(filtered.map((r) => r.src))];
  let minTs = Infinity, maxTs = -Infinity;
  for (const r of filtered) {
    if (r.ts < minTs) minTs = r.ts;
    if (r.ts > maxTs) maxTs = r.ts;
  }
  const range = Number.isFinite(minTs)
    ? { from: minTs, to: maxTs + 1 }
    : { from: now - 86400_000, to: now };
  const { histBuckets } = overviewLayout(width, Math.max(1, histSources.length));
  const histBs = buckets(filtered, range, histBuckets);

  const sessions = latestSessions(filtered, 8);
  const rows: SessionDisplayRow[] = sessions.map((s) => ({
    sid: sidShort(s.sid),
    started: fmtTime(s.firstTs),
    lastActive: fmtTime(s.lastTs),
    dur: fmtDur(s.lastTs - s.firstTs),
    tps: fmtTps(s.avgTps),
    tokens: fmtTok(s.totalTok),
    src: s.src,
    recent: now - s.lastTs < 86400_000,
  }));

  // time ticks under the activity strips (screenshot: start / mid / end dates)
  const tickFrom = Number.isFinite(minTs) ? minTs : now - 7 * 86400_000;
  const tickTo = Number.isFinite(maxTs) ? maxTs : now;

  return (
    <Box flexDirection="column">
      {cards.length > 0 ? (
        <Box columnGap={1}>{cards}</Box>
      ) : (
        <Box borderStyle="round" borderColor={theme.border} paddingX={1}>
          <Text color={theme.dim}>no activity in window · — </Text>
        </Box>
      )}

      <Box flexDirection="column" marginTop={1}>
        <Text bold color={theme.text}>ACTIVITY MAP</Text>
        {summaries.map((s) => (
          <Box key={s.src} columnGap={1}>
            <Text color={theme.srcColors[s.src] ?? theme.accent}>{(ADAPTERS.find((a) => a.id === s.src)?.label ?? s.src).padEnd(7)}</Text>
            <Text>{heatStrip(s.spark, stripWidth, theme.heat)}</Text>
          </Box>
        ))}
        {summaries.length === 0 && <Text color={theme.dim}>—</Text>}
        {summaries.length > 0 && (
          <Box>
            <Text color={theme.dim}>{' '.repeat(8)}{fmtDate(tickFrom)}</Text>
            <Text color={theme.dim}>{' '.repeat(Math.max(1, Math.floor(stripWidth / 2) - 5))}{fmtDate((tickFrom + tickTo) / 2)}</Text>
            <Text color={theme.dim}>{' '.repeat(Math.max(1, stripWidth - 11))}{fmtDate(tickTo)}</Text>
          </Box>
        )}
      </Box>

      <Box columnGap={2} marginTop={1}>
        <Box flexDirection="column">
          <Text bold color={theme.text}>MODEL VELOCITY</Text>
          {models.map((m) => {
            const name = truncateToWidth(m.model, 22);
            const pad = ' '.repeat(Math.max(0, 22 - displayWidth(name)));
            return (
              <Box key={m.model} columnGap={1}>
                <Text color={theme.dim}>{name}{pad}</Text>
                <Text>{gaugeBar(m.avgTps ?? 0, maxTps, 24, '█', '░')}</Text>
                <Text color={theme.text}>{fmtTps(m.avgTps)}</Text>
              </Box>
            );
          })}
          {models.length === 0 && <Text color={theme.dim}>—</Text>}
        </Box>

        <Box flexDirection="column">
          <Text bold color={theme.text}>OUTPUT ACTIVITY</Text>
          {histSources.length > 0 ? (
            histogram(
              histSources.map((src) => ({
                values: histBs.map((b) => b.out[src] ?? 0),
                color: theme.srcColors[src] ?? theme.accent,
              })),
              histBuckets,
              6,
            ).map((line, i) => <Text key={i}>{line}</Text>)
          ) : (
            <Text color={theme.dim}>—</Text>
          )}
        </Box>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text bold color={theme.text}>LATEST ACTIVITY</Text>
        <Table
          columns={sessionColumns.map((c) =>
            c.key === 'lastActive' ? { ...c, color: (r: SessionDisplayRow) => (r.recent ? theme.accent : undefined) } : c,
          )}
          rows={rows}
        />
      </Box>
    </Box>
  );
}
