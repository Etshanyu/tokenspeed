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
import { fmtDur, fmtTok, fmtTps, projShort, truncateToWidth, displayWidth } from '../util/fmt.ts';

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
  label: string; color: string; avgTps: number | null; outTok: number;
  activeMs: number; totalTok: number; reqs: number; spark: number[]; theme: Theme;
}): React.ReactElement {
  const tps = useTween(props.avgTps);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={props.color} paddingX={1} minWidth={26}>
      <Text bold color={props.color}>{props.label}</Text>
      <Text>
        <Text bold color={props.theme.text}>{fmtTps(tps)}</Text>
        <Text color={props.theme.dim}> tok/s</Text>
      </Text>
      <Text color={props.theme.dim}>Σ {fmtTok(props.outTok)} out · {fmtDur(props.activeMs)} active</Text>
      <Text color={props.theme.dim}>{fmtTok(props.totalTok)} tok · {props.reqs} reqs</Text>
      <Text>{sparkline(props.spark, 22, props.color)}</Text>
    </Box>
  );
}

interface SessionDisplayRow {
  time: string; src: string; proj: string; model: string; out: string; tps: string; reqs: number; recent: boolean;
}

const sessionColumns: Column<SessionDisplayRow>[] = [
  { key: 'time', header: 'TIME', width: 11, render: (r) => r.time },
  { key: 'src', header: 'SRC', width: 7, render: (r) => r.src.toUpperCase() },
  { key: 'proj', header: 'PROJECT', width: 14, render: (r) => projShort(r.proj) },
  { key: 'model', header: 'MODEL', width: 16, render: (r) => r.model },
  { key: 'out', header: 'OUT', width: 7, align: 'r', render: (r) => fmtTok(r.out === '—' ? 0 : Number(r.out)) },
  { key: 'tps', header: 'AVG TKS', width: 7, align: 'r', render: (r) => r.tps },
  { key: 'reqs', header: 'REQS', width: 4, align: 'r', render: (r) => String(r.reqs) },
];

function fmtTime(ts: number, now: number): string {
  const d = new Date(ts);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function Overview(props: OverviewProps): React.ReactElement {
  const { records, now, theme, srcFilter, win = '7d' } = props;
  const { stdout } = useStdout();
  const width = stdout?.columns ?? 100;

  const filtered = applyFilters(records, srcFilter, windowRange(win, now));
  const summaries = sourceSummaries(filtered);
  // aggregate ALL card manually
  const outTokAll = filtered.reduce((s, r) => s + r.outTok, 0);
  const activeAll = filtered.reduce((s, r) => s + Math.max(0, r.durMs), 0);
  const totalAll = filtered.reduce((s, r) => s + r.inTok + r.outTok + r.cacheRead + r.cacheWrite, 0);

  // one card per source (screenshot layout); the aggregate lives in the headline above
  const cards: React.ReactElement[] = [];
  for (const s of summaries) {
    const adapter = ADAPTERS.find((a) => a.id === s.src);
    cards.push(
      <SourceCard key={s.src} label={adapter?.label ?? s.src} color={theme.srcColors[s.src] ?? theme.accent}
        avgTps={s.avgTps} outTok={s.outTok} activeMs={s.activeMs}
        totalTok={s.inTok + s.outTok + s.cacheRead + s.cacheWrite}
        reqs={s.reqs} spark={s.spark} theme={theme} />,
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
    time: fmtTime(s.lastTs, now),
    src: s.src,
    proj: s.proj,
    model: s.model,
    out: String(s.outTok),
    tps: fmtTps(s.avgTps),
    reqs: s.reqs,
    recent: now - s.lastTs < 86400_000,
  }));

  return (
    <Box flexDirection="column">
      {cards.length > 0 && (
        <Text>
          <Text bold color={theme.accent}>ALL </Text>
          <Text bold color={theme.text}>{fmtTps(activeAll > 0 ? (outTokAll / activeAll) * 1000 : null)} tok/s</Text>
          <Text color={theme.dim}> · Σ {fmtTok(outTokAll)} out · {fmtTok(totalAll)} tok · {filtered.length} reqs</Text>
        </Text>
      )}
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
            c.key === 'time' ? { ...c, color: (r: SessionDisplayRow) => (r.recent ? theme.accent : undefined) } : c,
          )}
          rows={rows}
        />
      </Box>
    </Box>
  );
}
