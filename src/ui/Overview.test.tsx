import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import { Overview, overviewLayout, solidNumberLines } from './Overview.tsx';
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

test('renders source speed cards with complementary usage and timing below', () => {
  const inst = render(
    <Overview records={records} now={NOW} theme={THEMES[0]} srcFilter="all" />,
  );
  const frame = inst.lastFrame()!;
  inst.unmount();
  assert.ok(frame.includes('CLAUDE'));
  assert.ok(frame.includes('CODEX'));
  assert.ok(frame.includes('DSH'));
  assert.ok(frame.includes('output tokens / second'));
  assert.ok(frame.includes('Median'));
  assert.ok(frame.includes('usable'));
  assert.ok(frame.includes('ACTIVITY MAP'));
  assert.ok(frame.includes('MODEL USAGE'));
  assert.ok(frame.includes('output / share'));
  assert.ok(frame.includes('OUTPUT ACTIVITY'));
  assert.ok(frame.includes('LATEST ACTIVITY'));
  assert.ok(frame.includes('DURATION'));
  assert.ok(!frame.includes('MODEL VELOCITY'));
  assert.ok(!frame.includes('SPEED'));
  assert.ok(frame.includes('glm-5.3'));
  assert.ok(frame.includes('3 sessions'));
  assert.ok(!frame.includes('SESSION'));
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

test('ACTIVITY MAP and MODEL USAGE bottom borders share one row', () => {
  const inst = render(
    <Overview records={records} now={NOW} theme={THEMES[0]} srcFilter="all" />,
  );
  const lines = stripAnsi(inst.lastFrame()!).split('\n');
  inst.unmount();
  const titleRow = lines.findIndex((line) => line.includes('ACTIVITY MAP'));
  const nextPanelRow = lines.findIndex((line) => line.includes('LATEST ACTIVITY'));
  const sharedBottom = lines.slice(titleRow + 1, nextPanelRow).some((line) => {
    const left = line.indexOf('╰');
    return left >= 0 && line.indexOf('╰', left + 1) > left;
  });
  assert.ok(titleRow >= 0 && nextPanelRow > titleRow);
  assert.ok(sharedBottom, 'upper panel bottoms must align');
});

test('LATEST ACTIVITY and OUTPUT ACTIVITY bottom borders share one row', () => {
  const inst = render(
    <Overview records={records} now={NOW} theme={THEMES[0]} srcFilter="all" />,
  );
  const lines = stripAnsi(inst.lastFrame()!).split('\n');
  inst.unmount();
  const titleRow = lines.findIndex((line) => line.includes('LATEST ACTIVITY'));
  const sharedBottom = lines.slice(titleRow + 1).some((line) => {
    const left = line.indexOf('╰');
    return left >= 0 && line.indexOf('╰', left + 1) > left;
  });
  assert.ok(titleRow >= 0);
  assert.ok(sharedBottom, 'lower panel bottoms must align');
});

test('no ALL row or card: exactly the screenshot card row', () => {
  const inst = render(
    <Overview records={records} now={NOW} theme={THEMES[0]} srcFilter="all" />,
  );
  const frame = stripAnsi(inst.lastFrame()!);
  inst.unmount();
  assert.ok(!/^ALL/m.test(frame));
  assert.ok(!/ALL\s+\S+\s*tok\/s/.test(frame));
  assert.ok(frame.includes('CODEX'));
  assert.ok(frame.includes('CLAUDE'));
  assert.ok(frame.includes('DSH'));
  assert.ok(/Median \S+ · \d+ requests/.test(frame));
  assert.ok(/10\/\d\d/.test(frame));
  assert.ok(frame.includes('output tokens / time bucket'));
  assert.ok(frame.includes('shared scale'));
  assert.ok(frame.includes('no output'));
  assert.ok(frame.includes('/bucket'));
  assert.ok(frame.includes('BUCKET ACTIVITY'));
  assert.ok(frame.includes('TOTAL'));
  assert.ok(frame.includes('TIME'));
  assert.ok(frame.includes('DURATION'));
  assert.ok(!frame.includes('SPEED'));
});

test('cumulative DSH output is visible without inventing windowed activity', () => {
  const total = rec({
    src: 'dsh', ts: NOW - 600_000, outTok: 600, durMs: 3000,
    kind: 'session', requestCount: 355,
  });
  const inst = render(
    <Overview records={[total]} now={NOW} theme={THEMES[0]} srcFilter="dsh" win="7d" />,
  );
  const frame = inst.lastFrame()!;
  inst.unmount();
  assert.ok(frame.includes('DSH'));
  assert.ok(frame.includes('cumulative session decode'));
  assert.ok(frame.includes('355 model calls'));
  assert.ok(frame.includes('All-time · 1 sessions'));
  assert.ok(frame.includes('DSH 600 tokens'));
  assert.ok(frame.includes('All-time · no time series'));
  assert.ok(frame.includes('0 sessions · 0 models · 0 output tokens'));
});

test('solid pixel numbers stay compact and keep the decimal point', () => {
  const lines = solidNumberLines('235.9');
  assert.equal(lines.length, 5);
  assert.ok(lines.every((line) => displayWidth(line) <= 24));
  assert.ok(lines[0].includes('████'));
  assert.ok(lines[4].includes('█ '));
});

test('overviewLayout keeps cards and the 2:1 lower split within the terminal', () => {
  for (const width of [80, 100, 120, 160]) {
    for (const nSources of [1, 2, 3, 4]) {
      const layout = overviewLayout(width, nSources);
      assert.ok(layout.cardWidth * nSources + Math.max(0, nSources - 1) <= width);
      assert.ok(layout.leftWidth + layout.rightWidth + 2 <= width);
      assert.ok(layout.activityWidth >= 4);
      assert.ok(layout.velocityWidth >= 12);
    }
  }
});
