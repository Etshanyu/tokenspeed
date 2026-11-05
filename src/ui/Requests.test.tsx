import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import { Requests } from './Requests.tsx';
import { THEMES } from '../theme.ts';
import type { TurnRecord } from '../sources/types.ts';

const NOW = new Date('2026-11-05T15:00:00').getTime();

function rec(i: number): TurnRecord {
  const d = new Date(NOW - (12 - i) * 60_000); // one per minute, newest last index
  return {
    src: i % 2 === 0 ? 'claude' : 'codex', sid: `sess-${String(i).padStart(2, '0')}-aaaa-bbbb-cccc-dddddddddddd`,
    proj: 'p', ts: d.getTime(), model: 'glm-5.3', inTok: 10, cacheRead: 0, cacheWrite: 0,
    outTok: 100 + i, reasonTok: 0, durMs: 2000,
  };
}

const records = Array.from({ length: 12 }, (_, i) => rec(i));
const timeOf = (i: number): string => {
  const d = new Date(NOW - (12 - i) * 60_000);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

test('requests renders newest first with headers', () => {
  const inst = render(
    <Requests records={records} now={NOW} theme={THEMES[0]} srcFilter="all" scroll={0} />,
  );
  const frame = inst.lastFrame()!;
  inst.unmount();
  assert.ok(frame.includes('REQUESTS'));
  assert.ok(frame.includes('SESSION'));
  assert.ok(frame.includes('showing 1-'));
  assert.ok(frame.includes('of 12'));
  // newest (index 11) on top; the 10th newest (index 2) is the last visible row;
  // the two oldest are scrolled out of the 10-row window
  assert.ok(frame.indexOf(timeOf(11)) < frame.indexOf(timeOf(2)));
  assert.equal(frame.indexOf(timeOf(1)), -1);
});

test('scroll window slices rows and updates the range line', () => {
  const inst = render(
    <Requests records={records} now={NOW} theme={THEMES[0]} srcFilter="all" scroll={2} />,
  );
  const frame = inst.lastFrame()!;
  inst.unmount();
  assert.ok(frame.includes(timeOf(9)));  // third newest now on top
  assert.ok(!frame.includes(timeOf(11)));
  assert.ok(frame.includes('showing 3-12 of 12'));
});

test('bottom sentinel scroll clamps to last page', () => {
  const inst = render(
    <Requests records={records} now={NOW} theme={THEMES[0]} srcFilter="all" scroll={Number.MAX_SAFE_INTEGER} />,
  );
  const frame = inst.lastFrame()!;
  inst.unmount();
  assert.ok(frame.includes('showing 3-12 of 12'));
  assert.ok(frame.includes(timeOf(0)));
});

test('empty state', () => {
  const inst = render(
    <Requests records={[]} now={NOW} theme={THEMES[0]} srcFilter="all" scroll={0} />,
  );
  const frame = inst.lastFrame()!;
  inst.unmount();
  assert.ok(frame.includes('no requests'));
});

test('srcFilter hides other sources', () => {
  const inst = render(
    <Requests records={records} now={NOW} theme={THEMES[0]} srcFilter="codex" scroll={0} />,
  );
  const frame = inst.lastFrame()!;
  inst.unmount();
  assert.ok(frame.includes('CODEX'));
  assert.ok(!frame.includes('CLAUDE'));
  assert.ok(frame.includes('of 6'));
});
