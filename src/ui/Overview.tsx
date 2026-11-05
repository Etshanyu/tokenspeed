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
import { fmtDur, fmtTok, fmtTps, projShort } from '../util/fmt.ts';

export interface OverviewProps {
  records: TurnRecord[];
  now: number;
  theme: Theme;
  srcFilter: SourceId | 'all';
  win?: WindowKey;
}

/** smooth 300ms tween on big numbers; static in tests (no changes) */
function useTween(target: number | null): number | null {
  const [display, setDisplay] = useState<number | null>(target);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (display === null || target === null || display === target) {
      setDisplay(target);
      return;
    }
    const steps = 10;
    let i = 1;
    const from = display;
    const tick = (): void => {
      setDisplay(from + ((target - from) * i) / steps);
      if (i++ < steps) timer.current = setTimeout(tick, 30);
    };
    timer.current = setTimeout(tick, 30);
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
  { key: 'time', header: 'TIME', width: 10, render: (r) => r.time },
  { key: 'src', header: 'SRC', width: 7, render: (r) => r.src.toUpperCase() },
  { key: 'proj', header: 'PROJECT', width: 22, render: (r) => projShort(r.proj) },
  { key: 'model', header: 'MODEL', width: 20, render: (r) => r.model },
  { key: 'out', header: 'OUT', width: 8, align: 'r', render: (r) => fmtTok(r.out === '—' ? 0 : Number(r.out)) },
  { key: 'tps', header: 'AVG TKS', width: 8, align: 'r', render: (r) => r.tps },
  { key: 'reqs', header: 'REQS', width: 5, align: 'r', render: (r) => String(r.reqs) },
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
  const allSpark = new Array(32).fill(0);
  {
    const tss = filtered.map((r) => r.ts);
    if (tss.length) {
      const min = Math.min(...tss), max = Math.max(...tss), span = Math.max(1, max - min);
      for (const r of filtered) {
        allSpark[Math.min(31, Math.floor(((r.ts - min) / span) * 32))] += r.outTok;
      }
    }
  }

  const cards: React.ReactElement[] = [];
  if (filtered.length > 0) {
    cards.push(
      <SourceCard key="all" label="ALL" color={theme.accent}
        avgTps={activeAll > 0 ? (outTokAll / activeAll) * 1000 : null}
        outTok={outTokAll} activeMs={activeAll} totalTok={totalAll}
        reqs={filtered.length} spark={allSpark} theme={theme} />,
    );
  }
  for (const s of summaries) {
    const adapter = ADAPTERS.find((a) => a.id === s.src);
    cards.push(
      <SourceCard key={s.src} label={adapter?.label ?? s.src} color={theme.srcColors[s.src] ?? theme.accent}
        avgTps={s.avgTps} outTok={s.outTok} activeMs={s.activeMs}
        totalTok={s.inTok + s.outTok + s.cacheRead}
        reqs={s.reqs} spark={s.spark} theme={theme} />,
    );
  }

  const stripWidth = Math.max(20, Math.min(60, width - 22));
  const models = modelStats(filtered).slice(0, 5);
  const maxTps = Math.max(1, ...models.map((m) => m.avgTps ?? 0));

  const histSources = [...new Set(filtered.map((r) => r.src))];
  const tss = filtered.map((r) => r.ts);
  const range = tss.length
    ? { from: Math.min(...tss), to: Math.max(...tss) + 1 }
    : { from: now - 86400_000, to: now };
  const histBuckets = buckets(filtered, range, Math.max(10, Math.floor((width - 30) / 2)));

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
          {models.map((m) => (
            <Box key={m.model} columnGap={1}>
              <Text color={theme.dim}>{m.model.slice(0, 24).padEnd(24)}</Text>
              <Text>{gaugeBar(m.avgTps ?? 0, maxTps, 24, '█', '░')}</Text>
              <Text color={theme.text}>{fmtTps(m.avgTps)}</Text>
            </Box>
          ))}
          {models.length === 0 && <Text color={theme.dim}>—</Text>}
        </Box>

        <Box flexDirection="column">
          <Text bold color={theme.text}>OUTPUT ACTIVITY</Text>
          {histSources.length > 0 ? (
            histogram(
              histSources.map((src) => ({
                values: histBuckets.map((b) => b.out[src] ?? 0),
                color: theme.srcColors[src] ?? theme.accent,
              })),
              Math.max(10, Math.floor((width - 30) / 2)),
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
