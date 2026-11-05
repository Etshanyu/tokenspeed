import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import { Overview } from './Overview.tsx';
import { THEMES } from '../theme.ts';
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
  rec({ src: 'codex', ts: NOW - 5400_000, outTok: 300, model: 'gpt-5.1-codex' }),
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
