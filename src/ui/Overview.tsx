import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import BigText from 'ink-big-text';
import { ADAPTERS } from '../sources/index.ts';
import type { SourceId, TurnRecord } from '../sources/types.ts';
import type { Theme } from '../theme.ts';
import {
  applyFilters, buckets, modelStats, sourceSummaries, windowRange,
} from '../agg/metrics.ts';
import type { SourceSummary, WindowKey } from '../agg/metrics.ts';
import { activityStrip, gradientBar, histogram, sparkline } from './comp/chart.ts';
import { fmtDur, fmtPct, fmtTok, truncateToWidth, displayWidth } from '../util/fmt.ts';

export interface OverviewProps {
  records: TurnRecord[];
  now: number;
  theme: Theme;
  srcFilter: SourceId | 'all';
  win?: WindowKey;
}

export function overviewLayout(width: number, nSources: number): {
  cardWidth: number;
  leftWidth: number;
  rightWidth: number;
  activityWidth: number;
  velocityWidth: number;
} {
  const count = Math.max(1, nSources);
  const lowerGap = 2;
  const leftWidth = Math.floor(((width - lowerGap) * 2) / 3);
  const rightWidth = Math.max(20, width - lowerGap - leftWidth);
  const leftContent = Math.max(12, leftWidth - 4);
  return {
    cardWidth: Math.max(12, Math.floor((width - Math.max(0, count - 1)) / count)),
    leftWidth,
    rightWidth,
    activityWidth: Math.max(4, leftContent - 8),
    velocityWidth: Math.max(12, rightWidth - 4),
  };
}

/** Two short steps keep live values readable without visible flicker. */
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

function fmtRate(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '—' : value.toFixed(1);
}

function fmtMetricTok(value: number): string {
  return fmtTok(value).replace(/k$/, 'K');
}

function fit(value: string, width: number, align: 'l' | 'r' = 'l'): string {
  const text = truncateToWidth(value, Math.max(1, width));
  const padding = ' '.repeat(Math.max(0, width - displayWidth(text)));
  return align === 'r' ? padding + text : text + padding;
}

function prettySource(src: string): string {
  return src.length <= 3 ? src.toUpperCase() : src[0].toUpperCase() + src.slice(1).toLowerCase();
}

const compactBigText = { spaceless: true };

function SourceCard(props: {
  summary: SourceSummary;
  label: string;
  color: string;
  theme: Theme;
  width: number;
}): React.ReactElement {
  const { summary, color, theme, width } = props;
  const tps = useTween(summary.avgTps);
  const chartWidth = Math.max(4, width - 4);
  const wide = width >= 42;
  const fullHeader = width >= 32;
  const usable = Math.round(summary.usablePct * 100);
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={color}
      borderDimColor
      paddingX={1}
      flexGrow={1}
      flexBasis={0}
      minWidth={0}
    >
      <Text bold color={color}>
        {props.label.toUpperCase()}{' '}
        <Text color={theme.dim}>{fullHeader ? 'weighted request throughput' : 'weighted throughput'}</Text>
      </Text>
      {tps === null ? (
        <Text bold color={color}>—</Text>
      ) : (
        <BigText
          text={fmtRate(tps)}
          font={width >= 48 ? 'block' : 'tiny'}
          colors={[color]}
          lineHeight={0}
          letterSpacing={1}
          {...compactBigText}
        />
      )}
      <Text color={theme.dim}>{wide ? 'estimated output tokens / second' : 'output tokens / second'}</Text>
      <Text color={theme.text}>Median {fmtRate(summary.medianTps)} <Text color={theme.dim}>· {summary.reqs} requests</Text></Text>
      <Text color={theme.dim}>
        {wide
          ? `${fmtMetricTok(summary.outTok)} output tokens · ${usable}% usable timing`
          : `${fmtMetricTok(summary.outTok)} output · ${usable}% usable`}
      </Text>
      <Box marginTop={1} flexDirection="column">
        {histogram([{ values: summary.spark, color }], chartWidth, 3).map((line, i) => (
          <Text key={i}>{line}</Text>
        ))}
      </Box>
    </Box>
  );
}

function fmtActivityDate(ts: number): string {
  const d = new Date(ts);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}h`;
}

function fmtRequestTime(ts: number, compact: boolean): string {
  const d = new Date(ts);
  const p = (x: number) => String(x).padStart(2, '0');
  const base = `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  return compact ? base : `${base}:${p(d.getSeconds())}`;
}

export function Overview(props: OverviewProps): React.ReactElement {
  const { records, now, theme, srcFilter, win = '7d' } = props;
  const { stdout } = useStdout();
  const width = stdout?.columns ?? 100;

  const filtered = applyFilters(records, srcFilter, windowRange(win, now));
  const summaries = sourceSummaries(filtered).sort((a, b) => {
    const ai = ADAPTERS.findIndex((adapter) => adapter.id === a.src);
    const bi = ADAPTERS.findIndex((adapter) => adapter.id === b.src);
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
  });
  const layout = overviewLayout(width, Math.max(1, summaries.length));

  let minTs = Infinity;
  let maxTs = -Infinity;
  for (const r of filtered) {
    minTs = Math.min(minTs, r.ts);
    maxTs = Math.max(maxTs, r.ts);
  }
  const selectedRange = windowRange(win, now);
  const range = win === 'all'
    ? Number.isFinite(minTs)
      ? { from: minTs, to: maxTs + 1 }
      : { from: now - 86400_000, to: now }
    : selectedRange;
  const activityBarWidth = Math.max(4, layout.activityWidth - 9);
  const histBs = buckets(filtered, range, activityBarWidth);
  const histSources = summaries.map((s) => s.src);
  const activityPeak = Math.max(
    1,
    ...histBs.flatMap((bucket) => histSources.map((src) => bucket.out[src] ?? 0)),
  );
  const bucketMs = Math.max(1, (range.to - range.from) / activityBarWidth);
  const bucketLabel = bucketMs >= 86400_000
    ? `${(bucketMs / 86400_000).toFixed(1)}d`
    : bucketMs >= 3600_000
      ? `${(bucketMs / 3600_000).toFixed(1)}h`
      : `${Math.max(1, Math.round(bucketMs / 60_000))}m`;

  const models = modelStats(filtered)
    .sort((a, b) => b.outTok - a.outTok)
    .slice(0, 3);
  let maxModelOutput = 1;
  for (const m of models) maxModelOutput = Math.max(maxModelOutput, m.outTok);

  const latest = [...filtered].sort((a, b) => b.ts - a.ts).slice(0, 4);
  const sessionCount = new Set(filtered.map((r) => `${r.src}:${r.sid}`)).size;
  const modelCount = new Set(filtered.map((r) => r.model)).size;
  const outputTotal = filtered.reduce((sum, r) => sum + r.outTok, 0);
  const leftContent = Math.max(12, layout.leftWidth - 4);
  const compactLatest = leftContent < 64;
  const timeWidth = compactLatest ? 11 : 14;
  const sourceWidth = compactLatest ? 5 : 6;
  const durationWidth = compactLatest ? 8 : 11;
  const outputWidth = compactLatest ? 8 : 11;
  const latestModelWidth = Math.max(4, leftContent - timeWidth - sourceWidth - durationWidth - outputWidth - 8);

  return (
    <Box flexDirection="column">
      {summaries.length > 0 ? (
        <Box columnGap={1} alignItems="stretch">
          {summaries.map((summary) => {
            const adapter = ADAPTERS.find((a) => a.id === summary.src);
            return (
              <SourceCard
                key={summary.src}
                summary={summary}
                label={adapter?.label ?? summary.src}
                color={theme.srcColors[summary.src] ?? theme.accent}
                theme={theme}
                width={layout.cardWidth}
              />
            );
          })}
        </Box>
      ) : (
        <Box borderStyle="round" borderColor={theme.border} paddingX={1}>
          <Text color={theme.dim}>no activity in window · — </Text>
        </Box>
      )}

      <Box columnGap={2} marginTop={1}>
        <Box width={layout.leftWidth} flexDirection="column" flexShrink={0}>
          <Box borderStyle="round" borderColor={theme.border} paddingX={1} flexDirection="column">
            <Text bold color={theme.text}>ACTIVITY MAP <Text color={theme.dim}> · output tokens / time bucket</Text></Text>
            <Text color={theme.dim}>{fmtActivityDate(range.from)} → {fmtActivityDate(range.to)} · {bucketLabel}/bucket</Text>
            <Box columnGap={1}>
              <Text color={theme.dim}>{fit('SOURCE', 7)}</Text>
              <Text color={theme.dim}>{fit('BUCKET ACTIVITY', activityBarWidth)}</Text>
              <Text color={theme.dim}>{fit('TOTAL', 8, 'r')}</Text>
            </Box>
            {summaries.map((s) => (
              <Box key={s.src} columnGap={1}>
                <Text color={theme.srcColors[s.src] ?? theme.accent}>{fit(prettySource(s.src), 7)}</Text>
                <Text>{activityStrip(
                  histBs.map((b) => b.out[s.src] ?? 0),
                  activityBarWidth,
                  theme.srcColors[s.src] ?? theme.accent,
                  theme.border,
                  activityPeak,
                )}</Text>
                <Text color={theme.text}>{fit(fmtMetricTok(s.outTok), 8, 'r')}</Text>
              </Box>
            ))}
            {summaries.length === 0 && <Text color={theme.dim}>—</Text>}
            <Box marginTop={1}>
              <Text color={theme.dim}>· no output  ▁▂█ low → high · shared scale · peak {fmtMetricTok(activityPeak)}</Text>
            </Box>
          </Box>

          <Box borderStyle="round" borderColor={theme.border} paddingX={1} flexDirection="column" marginTop={1}>
            <Text bold color={theme.text}>LATEST ACTIVITY</Text>
            <Text color={theme.dim} wrap="truncate">
              {sessionCount} sessions · {modelCount} models · {fmtMetricTok(outputTotal)} output tokens
            </Text>
            <Box marginTop={1} flexDirection="column">
              <Text color={theme.dim}>
                {fit('TIME', timeWidth)}{'  '}
                {fit('SOURCE', sourceWidth)}{'  '}
                {fit('DURATION', durationWidth)}{'  '}
                {fit('OUTPUT', outputWidth)}{'  '}
                {fit('MODEL', Math.max(1, latestModelWidth))}
              </Text>
              {latest.map((r) => {
                const color = theme.srcColors[r.src] ?? theme.accent;
                return (
                  <Text key={`${r.src}:${r.sid}:${r.ts}`}>
                    <Text color={theme.dim}>{fit(fmtRequestTime(r.ts, compactLatest), timeWidth)}</Text>{'  '}
                    <Text color={color}>{fit(r.src, sourceWidth)}</Text>{'  '}
                    <Text color={theme.text}>{fit(fmtDur(r.durMs), durationWidth)}</Text>{'  '}
                    <Text color={theme.text}>{fit(`${fmtMetricTok(r.outTok)} output`, outputWidth)}</Text>{'  '}
                    <Text color={theme.dim}>· {fit(r.model, Math.max(1, latestModelWidth - 2))}</Text>
                  </Text>
                );
              })}
              {latest.length === 0 && <Text color={theme.dim}>—</Text>}
            </Box>
          </Box>
        </Box>

        <Box width={layout.rightWidth} flexDirection="column" flexShrink={0}>
          <Box borderStyle="round" borderColor={theme.border} paddingX={1} flexDirection="column">
            <Text bold color={theme.text}>MODEL USAGE <Text color={theme.dim}>· output / share</Text></Text>
            {models.map((m) => {
              const src = m.srcs[0] ?? '';
              const color = theme.srcColors[src] ?? theme.accent;
              const gradient = theme.srcGradients?.[src] ?? [color, theme.accent];
              const usage = `${fmtMetricTok(m.outTok)} · ${fmtPct(m.share)}`;
              const labelWidth = Math.max(4, layout.velocityWidth - displayWidth(usage) - 1);
              return (
                <Box key={`${src}:${m.model}`} flexDirection="column">
                  <Text>
                    <Text color={color}>{fit(`${src.toUpperCase()} ${m.model}`, labelWidth)}</Text>{' '}
                    <Text bold color={color}>{usage}</Text>
                  </Text>
                  <Text>{gradientBar(m.outTok, maxModelOutput, layout.velocityWidth, gradient, theme.border)}</Text>
                </Box>
              );
            })}
            {models.length === 0 && <Text color={theme.dim}>—</Text>}
          </Box>

          <Box borderStyle="round" borderColor={theme.border} paddingX={1} flexDirection="column" marginTop={1}>
            <Text bold color={theme.text}>OUTPUT ACTIVITY</Text>
            {summaries.map((s) => {
              const color = theme.srcColors[s.src] ?? theme.accent;
              return (
                <Box key={s.src} flexDirection="column">
                  <Text color={color}>{prettySource(s.src)} <Text color={theme.text}>{fmtMetricTok(s.outTok)} tokens</Text></Text>
                  <Text>{sparkline(
                    histBs.map((b) => b.out[s.src] ?? 0),
                    layout.velocityWidth,
                    color,
                  )}</Text>
                </Box>
              );
            })}
            {histSources.length === 0 && <Text color={theme.dim}>—</Text>}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
