import { performance } from 'node:perf_hooks';
import { applyFilters, buckets, modelStats, sourceSummaries, windowRange } from '../src/agg/metrics.ts';
import type { TurnRecord } from '../src/sources/types.ts';

const count = Number(process.env.TOKENSPEED_BENCH_RECORDS ?? 100_000);
const now = Date.now();
const sources = ['claude', 'codex'] as const;
const records: TurnRecord[] = Array.from({ length: count }, (_, i) => ({
  src: sources[i % sources.length],
  sid: `session-${i % 1000}`,
  proj: `synthetic-project-${i % 50}`,
  ts: now - (i % (30 * 24)) * 3_600_000,
  model: `synthetic-model-${i % 12}`,
  inTok: 100 + (i % 1000),
  cacheRead: i % 5000,
  cacheWrite: i % 100,
  outTok: 50 + (i % 2000),
  reasonTok: i % 200,
  durMs: 500 + (i % 20_000),
}));

const selected = applyFilters(records, 'all', windowRange('30d', now));
const measurements: [string, () => unknown][] = [
  ['sourceSummaries', () => sourceSummaries(selected)],
  ['modelStats', () => modelStats(selected)],
  ['buckets', () => buckets(selected, windowRange('30d', now), 30)],
];

console.log(`Token Speed synthetic benchmark: ${selected.length.toLocaleString()} records`);
for (const [name, run] of measurements) {
  const start = performance.now();
  run();
  console.log(`${name.padEnd(18)} ${(performance.now() - start).toFixed(1)} ms`);
}
