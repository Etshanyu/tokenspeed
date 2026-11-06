import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import { Timeline, timelineChart } from './Timeline.tsx';
import { THEMES } from '../theme.ts';
import type { TurnRecord } from '../sources/types.ts';

const NOW = new Date('2026-11-05T15:00:00').getTime();

function rec(o: Partial<TurnRecord> & { src: string; ts: number }): TurnRecord {
  return {
    sid: 's', proj: 'p', model: 'm', inTok: 10, cacheRead: 5, cacheWrite: 0,
    outTok: 100, reasonTok: 0, durMs: 1000, ...o,
  };
}

const week: TurnRecord[] = Array.from({ length: 7 }, (_, d) =>
  rec({ src: 'claude', ts: NOW - (6 - d) * 86400_000 - 3600_000, outTok: 50 + d * 25 }),
);

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

test('timeline renders title, bucket labels and peak summary', () => {
  const inst = render(
    <Timeline records={week} now={NOW} theme={THEMES[0]} srcFilter="all" win="7d" />,
  );
  const frame = inst.lastFrame()!;
  inst.unmount();
  assert.ok(frame.includes('TIMELINE'));
  assert.ok(frame.includes('10-29')); // selected 7d window starts here, not at the first record
  assert.ok(frame.includes('11-05')); // last bucket date label
  assert.ok(frame.includes('PEAK'));
  assert.ok(frame.includes('OUTPUT'));
  assert.ok(frame.includes('CACHE READ'));
  assert.ok(frame.includes('SOURCES'));
  assert.ok(frame.includes('5-bucket trend'));
});

test('timeline empty window renders no-activity state', () => {
  const inst = render(
    <Timeline records={[]} now={NOW} theme={THEMES[0]} srcFilter="all" win="7d" />,
  );
  const frame = inst.lastFrame()!;
  inst.unmount();
  assert.ok(frame.includes('no activity'));
});

test('timeline translates labels and summaries into Chinese', () => {
  const inst = render(
    <Timeline records={week} now={NOW} theme={THEMES[0]} srcFilter="all" win="7d" lang="zh" />,
  );
  const frame = inst.lastFrame()!;
  inst.unmount();
  assert.ok(frame.includes('时间线'));
  assert.ok(frame.includes('每 6 小时分桶'));
  assert.ok(frame.includes('缓存读取'));
  assert.ok(frame.includes('峰值'));
  assert.ok(frame.includes('5 桶移动趋势'));
});

test('timeline uses plan bucket counts (7d -> 28 buckets) regardless of width', () => {
  const inst = render(
    <Timeline records={week} now={NOW} theme={THEMES[0]} srcFilter="all" win="7d" />,
  );
  const frame = inst.lastFrame()!;
  inst.unmount();
  assert.ok(frame.includes('6h buckets'));
  // chart rows must be exactly 28 cells wide inside the panel
  const rows = frame.split('\n').map(stripAnsi).flatMap((line) => {
    const match = line.match(/│ ([█▀▄· ]{28}) *│/);
    return match && /[█▀▄·]/.test(match[1]) ? [match[1]] : [];
  });
  assert.equal(rows.length, 8);
  for (const r of rows) assert.equal(r.length, 28);
});

test('timelineChart rises left to right with trend dots', () => {
  const rows = timelineChart(
    [{ values: Array.from({ length: 10 }, (_, i) => (i + 1) * 10), color: '#22d3ee' }],
    6,
    '#f472b6',
  );
  assert.equal(rows.length, 6);
  const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');
  const plain = rows.map(stripAnsi);
  // leftmost column empty at top, rightmost filled
  assert.equal(plain[0][0], ' ');
  assert.ok('█▀·'.includes(plain[0][9]));
  // rising MA: a dot appears somewhere in the upper half at later buckets
  const upper = plain.slice(0, 3).join('');
  assert.ok(upper.includes('·'));
});
