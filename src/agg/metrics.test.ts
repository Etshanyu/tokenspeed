import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  windowRange, applyFilters, sourceSummaries, buckets, modelStats, latestSessions,
} from './metrics.ts';
import type { TurnRecord } from '../sources/types.ts';

function rec(o: Partial<TurnRecord> & { src: string; sid: string; ts: number }): TurnRecord {
  return {
    proj: 'p', model: 'm', inTok: 10, cacheRead: 0, cacheWrite: 0,
    outTok: 100, reasonTok: 0, durMs: 1000,
    ...o,
  };
}

const NOW = new Date('2026-11-05T15:00:00').getTime();

test('windowRange: today starts at local midnight', () => {
  const { from, to } = windowRange('today', NOW);
  const midnight = new Date(NOW);
  midnight.setHours(0, 0, 0, 0);
  assert.equal(from, midnight.getTime());
  assert.equal(to, NOW);
});

test('windowRange: 7d/30d/all spans', () => {
  assert.equal(windowRange('7d', NOW).from, NOW - 7 * 86400_000);
  assert.equal(windowRange('30d', NOW).from, NOW - 30 * 86400_000);
  assert.deepEqual(windowRange('all', NOW), { from: 0, to: Number.POSITIVE_INFINITY });
});

test('applyFilters filters by source and time range', () => {
  const recs = [
    rec({ src: 'claude', sid: 'a', ts: NOW - 1000 }),
    rec({ src: 'codex', sid: 'b', ts: NOW - 2000 }),
    rec({ src: 'claude', sid: 'c', ts: 1000 }), // ancient
  ];
  const got = applyFilters(recs, 'claude', { from: NOW - 3600_000, to: NOW });
  assert.deepEqual(got.map((r) => r.sid), ['a']);
  const all = applyFilters(recs, 'all', { from: 0, to: Number.POSITIVE_INFINITY });
  assert.equal(all.length, 3);
});

test('sourceSummaries aggregates per source with honest avg tps', () => {
  const recs = [
    rec({ src: 'claude', sid: 'a', ts: 1, outTok: 100, durMs: 2000 }),
    rec({ src: 'claude', sid: 'a', ts: 2, outTok: 300, durMs: 4000 }),
    rec({ src: 'codex', sid: 'b', ts: 3, outTok: 50, durMs: 1000 }),
  ];
  const sums = sourceSummaries(recs);
  assert.equal(sums.length, 2);
  const claude = sums.find((s) => s.src === 'claude')!;
  assert.equal(claude.avgTps, 400000 / 6000 * 1); // (100+300)/(6000ms) => 66.7 tok/s
  assert.equal(claude.avgTps!, 400 / 6);
  assert.equal(claude.outTok, 400);
  assert.equal(claude.reqs, 2);
  assert.equal(claude.sessions, 1);
  assert.equal(claude.activeMs, 6000);
  assert.equal(claude.spark.length, 32);
  assert.equal(claude.spark.reduce((a, b) => a + b, 0), 400);
});

test('sourceSummaries returns null avgTps on zero duration', () => {
  const recs = [rec({ src: 'dsh', sid: 'x', ts: 1, durMs: 0 })];
  const sums = sourceSummaries(recs);
  assert.equal(sums[0].avgTps, null);
});

test('sourceSummaries on empty input returns empty array', () => {
  assert.deepEqual(sourceSummaries([]), []);
});

test('buckets distributes records into time buckets per source', () => {
  const t0 = 1_000_000;
  const recs = [
    rec({ src: 'claude', sid: 'a', ts: t0, outTok: 10, inTok: 5 }),
    rec({ src: 'claude', sid: 'a', ts: t0 + 100, outTok: 20 }), // bucket width 100 -> lands in bucket 1
    rec({ src: 'codex', sid: 'b', ts: t0 + 300, outTok: 7, inTok: 3 }),
  ];
  const bs = buckets(recs, { from: t0, to: t0 + 400 }, 4);
  assert.equal(bs.length, 4);
  assert.equal(bs[0].out['claude'], 10);
  assert.equal(bs[0].in['claude'], 5);
  assert.equal(bs[1].out['claude'], 20);
  assert.equal(bs[3].out['codex'], 7);
  assert.equal(bs[3].in['codex'], 3);
});

test('modelStats groups, p95 peak, share sums to 1', () => {
  const recs = [
    ...Array.from({ length: 10 }, (_, i) =>
      rec({ src: 'claude', sid: 'a', ts: i, model: 'glm', outTok: 10, durMs: 1000 })),
    rec({ src: 'codex', sid: 'b', ts: 20, model: 'gpt', outTok: 5, durMs: 1000 }),
  ];
  const rows = modelStats(recs);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].model, 'glm'); // outTok desc
  assert.equal(rows[0].reqs, 10);
  assert.equal(rows[0].peakTps, rows[0].avgTps); // uniform tps -> p95 == avg
  const shareSum = rows.reduce((s, r) => s + r.share, 0);
  assert.ok(Math.abs(shareSum - 1) < 1e-9);
  assert.deepEqual(rows[1].srcs, ['codex']);
});

test('modelStats p95 uses nearest rank on per-record tps', () => {
  const tps = (t: number, d: number) => rec({ src: 'x', sid: 'a', ts: 0, model: 'm', outTok: t, durMs: d });
  // tps values: 10, 20, ..., 100 (10 records)
  const recs = Array.from({ length: 10 }, (_, i) => tps((i + 1) * 10, 1000));
  const [row] = modelStats(recs);
  assert.equal(row.peakTps, 100); // ceil(0.95*10)=10th value
});

test('latestSessions sorts by last activity and totals tokens', () => {
  const recs = [
    rec({ src: 'claude', sid: 'old', ts: 10, proj: 'proj-old', outTok: 10, inTok: 5, cacheRead: 2 }),
    rec({ src: 'claude', sid: 'new', ts: 99, proj: 'proj-new', outTok: 8, inTok: 4, cacheRead: 1 }),
    rec({ src: 'claude', sid: 'new', ts: 50, outTok: 2, inTok: 0, durMs: 500 }),
  ];
  const rows = latestSessions(recs, 10);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].sid, 'new');
  assert.equal(rows[0].lastTs, 99);
  assert.equal(rows[0].reqs, 2);
  assert.equal(rows[0].totalTok, 8 + 4 + 1 + 2); // out+in+cacheRead+out2
  assert.equal(rows[0].avgTps, (8 + 2) / 1500 * 1000);
});

test('empty inputs degrade to empty outputs across all functions', () => {
  // buckets always yields n (possibly empty) buckets for a stable strip layout
  const bs = buckets([], { from: 0, to: 10 }, 5);
  assert.equal(bs.length, 5);
  assert.deepEqual(bs[0].out, {});
  assert.deepEqual(modelStats([]), []);
  assert.deepEqual(latestSessions([], 5), []);
  assert.deepEqual(sourceSummaries([]), []);
});
