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
import { t } from './i18n.ts';
import type { Language } from './i18n.ts';

export interface OverviewProps {
  records: TurnRecord[];
  now: number;
  theme: Theme;
  srcFilter: SourceId | 'all';
  win?: WindowKey;
  lang?: Language;
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

const SOLID_DIGITS: Record<string, string[]> = {
  '0': ['████', '█  █', '█  █', '█  █', '████'],
  '1': ['  █ ', ' ██ ', '  █ ', '  █ ', '████'],
  '2': ['████', '   █', '████', '█   ', '████'],
  '3': ['████', '   █', ' ███', '   █', '████'],
  '4': ['█  █', '█  █', '████', '   █', '   █'],
  '5': ['████', '█   ', '████', '   █', '████'],
  '6': ['████', '█   ', '████', '█  █', '████'],
  '7': ['████', '   █', '  █ ', ' █  ', ' █  '],
  '8': ['████', '█  █', '████', '█  █', '████'],
  '9': ['████', '█  █', '████', '   █', '████'],
  '.': ['  ', '  ', '  ', '  ', '█ '],
};

export function solidNumberLines(value: string): string[] {
  const glyphs = [...value].map((char) => SOLID_DIGITS[char] ?? ['    ', '    ', '    ', '    ', '    ']);
  return Array.from({ length: 5 }, (_, row) => glyphs.map((glyph) => glyph[row]).join(' ').trimEnd());
}

function SolidNumber(props: { value: string; color: string }): React.ReactElement {
  return (
    <Box flexDirection="column">
      {solidNumberLines(props.value).map((line, i) => <Text key={i} color={props.color}>{line}</Text>)}
    </Box>
  );
}

function SourceCard(props: {
  summary: SourceSummary;
  label: string;
  color: string;
  theme: Theme;
  width: number;
  lang: Language;
}): React.ReactElement {
  const { summary, color, theme, width, lang } = props;
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
        <Text color={theme.dim}>{summary.cumulative
          ? t(lang, fullHeader ? 'cumulativeSessionDecode' : 'sessionTotals')
          : t(lang, fullHeader ? 'weightedRequestThroughput' : 'weightedThroughput')}</Text>
      </Text>
      {tps === null ? (
        <Text bold color={color}>—</Text>
      ) : width >= 48 ? (
        <BigText
          text={fmtRate(tps)}
          font="block"
          colors={[color]}
          lineHeight={0}
          letterSpacing={1}
          {...compactBigText}
        />
      ) : (
        <SolidNumber value={fmtRate(tps)} color={color} />
      )}
      <Text color={theme.dim}>{summary.cumulative
        ? t(lang, 'measuredDecodeRate')
        : t(lang, wide ? 'estimatedOutputRate' : 'outputRate')}</Text>
      {summary.cumulative ? (
        <Text color={theme.text}>{summary.reqs} {t(lang, 'modelCalls')} <Text color={theme.dim}>· {t(lang, 'cumulativeTotal')}</Text></Text>
      ) : (
        <Text color={theme.text}>{t(lang, 'median')} {fmtRate(summary.medianTps)} <Text color={theme.dim}>· {summary.reqs} {t(lang, 'requests')}</Text></Text>
      )}
      <Text color={theme.dim}>
        {wide
          ? `${fmtMetricTok(summary.outTok)} ${t(lang, 'outputTokens')} · ${usable}% ${t(lang, 'usableTiming')}`
          : `${fmtMetricTok(summary.outTok)} ${t(lang, 'output')} · ${usable}% ${t(lang, 'usable')}`}
      </Text>
      <Box marginTop={1} flexDirection="column">
        {summary.cumulative ? (
          <Text color={theme.dim}>{t(lang, 'allTimeSessions')} · {summary.sessions} {t(lang, 'sessions')}</Text>
        ) : histogram([{ values: summary.spark, color }], chartWidth, 3).map((line, i) => (
          <Text key={i}>{line}</Text>
        ))}
      </Box>
    </Box>
  );
}

function fmtActivityDate(ts: number, lang: Language): string {
  const d = new Date(ts);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}${lang === 'zh' ? '时' : 'h'}`;
}

function fmtRequestTime(ts: number, compact: boolean): string {
  const d = new Date(ts);
  const p = (x: number) => String(x).padStart(2, '0');
  const base = `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  return compact ? base : `${base}:${p(d.getSeconds())}`;
}

export function Overview(props: OverviewProps): React.ReactElement {
  const { records, now, theme, srcFilter, win = '7d', lang = 'en' } = props;
  const { stdout } = useStdout();
  const width = stdout?.columns ?? 100;

  const filtered = applyFilters(records, srcFilter, windowRange(win, now));
  const activity = filtered.filter((r) => r.kind !== 'session');
  const byAdapter = (a: { src: string }, b: { src: string }): number => {
    const ai = ADAPTERS.findIndex((adapter) => adapter.id === a.src);
    const bi = ADAPTERS.findIndex((adapter) => adapter.id === b.src);
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
  };
  // Session-total cards remain visible in bounded windows, but their values stay
  // explicitly All-time and never enter windowed charts or request statistics.
  const summaryRecords = win === 'all' ? filtered : [
    ...filtered,
    ...records.filter((r) => r.kind === 'session' && (srcFilter === 'all' || r.src === srcFilter)),
  ];
  const summaries = sourceSummaries(summaryRecords).sort(byAdapter);
  const activitySummaries = sourceSummaries(activity).sort(byAdapter);
  const layout = overviewLayout(width, Math.max(1, summaries.length));

  let minTs = Infinity;
  let maxTs = -Infinity;
  for (const r of activity) {
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
  const histBs = buckets(activity, range, activityBarWidth);
  const histSources = activitySummaries.map((s) => s.src);
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
  // Both upper panels start together; one shared height keeps their bottom borders aligned.
  const upperPanelHeight = Math.max(8, activitySummaries.length + 7, models.length * 2 + 3);

  const latest = [...activity].sort((a, b) => b.ts - a.ts).slice(0, 4);
  // Cumulative-only sources have no honest time series. Keep their totals visible
  // beside the windowed sparklines without inventing per-bucket activity.
  const cumulativeOnly = summaries.filter((s) =>
    s.cumulative && !activitySummaries.some((activitySummary) => activitySummary.src === s.src),
  );
  const lowerPanelHeight = Math.max(
    7,
    Math.max(1, latest.length) + 6,
    Math.max(1, (activitySummaries.length + cumulativeOnly.length) * 2) + 3,
  );
  const sessionCount = new Set(activity.map((r) => `${r.src}:${r.sid}`)).size;
  const modelCount = new Set(activity.map((r) => r.model)).size;
  const outputTotal = activity.reduce((sum, r) => sum + r.outTok, 0);
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
                lang={lang}
              />
            );
          })}
        </Box>
      ) : (
        <Box borderStyle="round" borderColor={theme.border} paddingX={1}>
          <Text color={theme.dim}>{t(lang, 'noActivityWindow')}</Text>
        </Box>
      )}

      <Box columnGap={2} marginTop={1}>
        <Box width={layout.leftWidth} flexDirection="column" flexShrink={0}>
          <Box height={upperPanelHeight} borderStyle="round" borderColor={theme.border} paddingX={1} flexDirection="column">
            <Text bold color={theme.text}>{t(lang, 'activityMap')} <Text color={theme.dim}> · {t(lang, 'outputPerBucket')}</Text></Text>
            <Text color={theme.dim}>{fmtActivityDate(range.from, lang)} → {fmtActivityDate(range.to, lang)} · {bucketLabel}{t(lang, 'bucketSuffix')}</Text>
            <Box columnGap={1}>
              <Text color={theme.dim}>{fit(t(lang, 'sourceColumn'), 7)}</Text>
              <Text color={theme.dim}>{fit(t(lang, 'bucketActivity'), activityBarWidth)}</Text>
              <Text color={theme.dim}>{fit(t(lang, 'total'), 8, 'r')}</Text>
            </Box>
            {activitySummaries.map((s) => (
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
            {activitySummaries.length === 0 && <Text color={theme.dim}>—</Text>}
            <Box marginTop={1}>
              <Text color={theme.dim}>· {t(lang, 'noOutput')}  ▁▂█ {t(lang, 'low')} → {t(lang, 'high')} · {t(lang, 'sharedScale')} · {t(lang, 'peak')} {fmtMetricTok(activityPeak)}</Text>
            </Box>
          </Box>

          <Box height={lowerPanelHeight} borderStyle="round" borderColor={theme.border} paddingX={1} flexDirection="column" marginTop={1}>
            <Text bold color={theme.text}>{t(lang, 'latestActivity')}</Text>
            <Text color={theme.dim} wrap="truncate">
              {sessionCount} {t(lang, 'sessions')} · {modelCount} {t(lang, 'models')} · {fmtMetricTok(outputTotal)} {t(lang, 'outputTokens')}
            </Text>
            <Box marginTop={1} flexDirection="column">
              <Text color={theme.dim}>
                {fit(t(lang, 'time'), timeWidth)}{'  '}
                {fit(t(lang, 'sourceColumn'), sourceWidth)}{'  '}
                {fit(t(lang, 'duration'), durationWidth)}{'  '}
                {fit(t(lang, 'outputColumn'), outputWidth)}{'  '}
                {fit(t(lang, 'model'), Math.max(1, latestModelWidth))}
              </Text>
              {latest.map((r) => {
                const color = theme.srcColors[r.src] ?? theme.accent;
                return (
                  <Text key={`${r.src}:${r.sid}:${r.ts}`}>
                    <Text color={theme.dim}>{fit(fmtRequestTime(r.ts, compactLatest), timeWidth)}</Text>{'  '}
                    <Text color={color}>{fit(r.src, sourceWidth)}</Text>{'  '}
                    <Text color={theme.text}>{fit(fmtDur(r.durMs, lang), durationWidth)}</Text>{'  '}
                    <Text color={theme.text}>{fit(`${fmtMetricTok(r.outTok)} ${t(lang, 'output')}`, outputWidth)}</Text>{'  '}
                    <Text color={theme.dim}>· {fit(r.model, Math.max(1, latestModelWidth - 2))}</Text>
                  </Text>
                );
              })}
              {latest.length === 0 && <Text color={theme.dim}>—</Text>}
            </Box>
          </Box>
        </Box>

        <Box width={layout.rightWidth} flexDirection="column" flexShrink={0}>
          <Box height={upperPanelHeight} borderStyle="round" borderColor={theme.border} paddingX={1} flexDirection="column">
            <Text bold color={theme.text}>{t(lang, 'modelUsage')} <Text color={theme.dim}>· {t(lang, 'outputShare')}</Text></Text>
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

          <Box height={lowerPanelHeight} borderStyle="round" borderColor={theme.border} paddingX={1} flexDirection="column" marginTop={1}>
            <Text bold color={theme.text}>{t(lang, 'outputActivity')}</Text>
            {activitySummaries.map((s) => {
              const color = theme.srcColors[s.src] ?? theme.accent;
              return (
                <Box key={s.src} flexDirection="column">
                  <Text color={color}>{prettySource(s.src)} <Text color={theme.text}>{fmtMetricTok(s.outTok)} {t(lang, 'tokens')}</Text></Text>
                  <Text>{sparkline(
                    histBs.map((b) => b.out[s.src] ?? 0),
                    layout.velocityWidth,
                    color,
                  )}</Text>
                </Box>
              );
            })}
            {cumulativeOnly.map((s) => {
              const color = theme.srcColors[s.src] ?? theme.accent;
              return (
                <Box key={s.src} flexDirection="column">
                  <Text color={color}>{prettySource(s.src)} <Text color={theme.text}>{fmtMetricTok(s.outTok)} {t(lang, 'tokens')}</Text></Text>
                  <Text color={theme.dim}>{t(lang, 'cumulativeNoTimeSeries')}</Text>
                </Box>
              );
            })}
            {histSources.length === 0 && cumulativeOnly.length === 0 && <Text color={theme.dim}>—</Text>}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
