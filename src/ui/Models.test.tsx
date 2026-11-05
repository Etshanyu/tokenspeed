import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import { Models } from './Models.tsx';
import { THEMES } from '../theme.ts';
import type { TurnRecord } from '../sources/types.ts';

const NOW = new Date('2026-11-05T15:00:00').getTime();

function rec(o: Partial<TurnRecord> & { src: string; model: string }): TurnRecord {
  return { sid: 's', proj: 'p', ts: NOW - 1000, inTok: 10, cacheRead: 5, cacheWrite: 0, outTok: 100, reasonTok: 0, durMs: 1000, ...o };
}

const records: TurnRecord[] = [
  rec({ src: 'claude', model: 'glm-5.3', outTok: 900 }),
  rec({ src: 'claude', model: 'glm-5.3', outTok: 600 }),
  rec({ src: 'codex', model: 'gpt-5.1-codex', outTok: 80 }),
  rec({ src: 'dsh', model: 'deepseek-flash', outTok: 20 }),
];

test('models table renders rows with share and gauge', () => {
  const inst = render(
    <Models records={records} now={NOW} theme={THEMES[0]} srcFilter="all" sort={{ col: 4, dir: -1 }} onSort={() => {}} />,
  );
  const frame = inst.lastFrame()!;
  inst.unmount();
  assert.ok(frame.includes('MODELS'));
  assert.ok(frame.includes('MODEL'));
  assert.ok(frame.includes('glm-5.3'));
  assert.ok(frame.includes('gpt-5.1-codex'));
  assert.ok(frame.includes('deepseek-flash'));
  assert.ok(frame.includes('%')); // share percentages
  assert.ok(frame.includes('█')); // share gauge bars
});

test('default OUT desc puts glm-5.3 first', () => {
  const inst = render(
    <Models records={records} now={NOW} theme={THEMES[0]} srcFilter="all" sort={{ col: 4, dir: -1 }} onSort={() => {}} />,
  );
  const frame = inst.lastFrame()!;
  inst.unmount();
  const iGlm = frame.indexOf('glm-5.3');
  const iGpt = frame.indexOf('gpt-5.1-codex');
  assert.ok(iGlm > -1 && iGpt > -1 && iGlm < iGpt);
});

test('sorting by model asc flips order', () => {
  const inst = render(
    <Models records={records} now={NOW} theme={THEMES[0]} srcFilter="all" sort={{ col: 0, dir: 1 }} onSort={() => {}} />,
  );
  const frame = inst.lastFrame()!;
  inst.unmount();
  // alphabetical asc: deepseek-flash < glm-5.3 < gpt-5.1-codex
  const iGlm = frame.indexOf('glm-5.3');
  const iGpt = frame.indexOf('gpt-5.1-codex');
  const iDsh = frame.indexOf('deepseek-flash');
  assert.ok(iDsh > -1 && iGlm > -1 && iGpt > -1);
  assert.ok(iDsh < iGlm && iGlm < iGpt);
});

test('empty records render no-models state', () => {
  const inst = render(
    <Models records={[]} now={NOW} theme={THEMES[0]} srcFilter="all" sort={{ col: 4, dir: -1 }} onSort={() => {}} />,
  );
  const frame = inst.lastFrame()!;
  inst.unmount();
  assert.ok(frame.includes('no models'));
});
