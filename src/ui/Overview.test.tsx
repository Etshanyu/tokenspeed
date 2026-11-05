import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import { Overview, overviewLayout } from './Overview.tsx';
import { THEMES } from '../theme.ts';
import { displayWidth } from '../util/fmt.ts';
import type { TurnRecord } from '../sources/types.ts';

const NOW = new Date('2026-11-05T15:00:00').getTime();

function rec(o: Partial<TurnRecord> & { src: string; ts: number }): TurnRecord {
  return {
    sid: 'sess-' + o.src, proj: 'C--proj--' + o.src, model: 'model-' + o.src,
    inTok: 10, cacheRead: 5, cacheWrite: 0, outTok: 100, reasonTok: 0, durMs: 2000, ...o,
  };
}

const records: TurnRecord[] = [
  rec({ src: 'claude', ts: NOW - 3600_000, outTok: 400, model: 'glm-5.3' }),
  rec({ src: 'claude', ts: NOW - 1800_000, outTok: 200, model: 'glm-5.3' }),
  rec({ src: 'codex', ts: NOW - 6 * 86400_000, outTok: 300, model: 'gpt-5.1-codex' }), // 10-30: in window, ticks show October
  rec({ src: 'dsh', ts: NOW - 600_000, outTok: 150, model: 'deepseek-flash', durMs: 1000 }),
];

test('renders source cards, charts and latest activity', () => {
  const inst = render(
    <Overview records={records} now={NOW} theme={THEMES[0]} srcFilter="all" />,
  );
  const frame = inst.lastFrame()!;
  inst.unmount();
  assert.ok(frame.includes('CLAUDE'));
  assert.ok(frame.includes('CODEX'));
  assert.ok(frame.includes('DSH'));
  assert.ok(frame.includes('tok/s'));
  assert.ok(frame.includes('ACTIVITY MAP'));
  assert.ok(frame.includes('MODEL VELOCITY'));
  assert.ok(frame.includes('LATEST ACTIVITY'));
  assert.ok(frame.includes('glm-5.3'));
  // screenshot-style session table columns
  assert.ok(frame.includes('SESSION'));
  assert.ok(frame.includes('STARTED'));
  assert.ok(frame.includes('LAST ACTIVE'));
  assert.ok(frame.includes('DURATION'));
  assert.ok(frame.includes('TOKENS'));
});

test('srcFilter restricts cards to that source', () => {
  const inst = render(
    <Overview records={records} now={NOW} theme={THEMES[0]} srcFilter="claude" />,
  );
  const frame = inst.lastFrame()!;
  inst.unmount();
  assert.ok(frame.includes('CLAUDE'));
  assert.ok(!frame.includes('CODEX'));
});

test('renders zeros with em-dash and no NaN on empty records', () => {
  const inst = render(
    <Overview records={[]} now={NOW} theme={THEMES[0]} srcFilter="all" />,
  );
  const frame = inst.lastFrame()!;
  inst.unmount();
  assert.ok(frame.includes('—'));
  assert.ok(!frame.includes('NaN'));
  assert.ok(!frame.includes('Infinity'));
  assert.ok(frame.includes('no activity'));
});

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

test('every frame line fits 100 columns with three sources (layout regression)', () => {
  const inst = render(
    <Overview records={records} now={NOW} theme={THEMES[0]} srcFilter="all" />,
  );
  const frame = stripAnsi(inst.lastFrame()!);
  inst.unmount();
  const offenders = frame.split('\n').filter((l) => displayWidth(l) > 100);
  assert.deepEqual(offenders, []);
});

test('no ALL row or card: exactly the screenshot card row', () => {
  const inst = render(
    <Overview records={records} now={NOW} theme={THEMES[0]} srcFilter="all" />,
  );
  const frame = stripAnsi(inst.lastFrame()!);
  inst.unmount();
  // no ALL headline, no standalone ALL card
  assert.ok(!/^ALL/m.test(frame));
  assert.ok(!/ALL\s+\S+\s*tok\/s/.test(frame));
  assert.ok(frame.includes('CODEX'));
  assert.ok(frame.includes('CLAUDE'));
  assert.ok(frame.includes('DSH'));
  // screenshot card summary format: Σ <dur> · <n> tok
  assert.ok(/Σ \S+ · \S+ tok/.test(frame));
  // activity map carries date ticks
  assert.ok(/10-\d\d/.test(frame));
});

test('overviewLayout sizes histogram to fit beside MODEL VELOCITY', () => {
  for (const width of [80, 100, 120, 160]) {
    for (const nSeries of [1, 2, 3, 4]) {
      const { histBuckets, velocityWidth } = overviewLayout(width, nSeries);
      assert.ok(histBuckets >= 4, `width=${width} series=${nSeries}`);
      assert.ok(
        histBuckets * nSeries + velocityWidth + 2 <= width - 4,
        `width=${width} series=${nSeries}: hist ${histBuckets * nSeries} + vel ${velocityWidth} must fit in ${width - 4}`,
      );
    }
  }
});
