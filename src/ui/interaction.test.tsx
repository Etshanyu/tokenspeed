import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import { App, appReducer, initialState } from './App.tsx';
import { Overview } from './Overview.tsx';
import { Timeline } from './Timeline.tsx';
import { Models } from './Models.tsx';
import { Requests } from './Requests.tsx';
import { THEMES } from '../theme.ts';
import type { WindowKey } from '../agg/metrics.ts';
import type { SourceId, TurnRecord } from '../sources/types.ts';

const NOW = new Date('2026-11-06T12:00:00').getTime();

function rec(src: SourceId, model: string, ts: number, outTok: number): TurnRecord {
  return {
    src, model, ts, outTok,
    sid: `${src}-${model}`, proj: 'p', inTok: 10, cacheRead: 5, cacheWrite: 0,
    reasonTok: 0, durMs: 2000,
  };
}

const records = [
  rec('codex', 'codex-new', NOW - 3600_000, 1000),
  rec('claude', 'claude-new', NOW - 7200_000, 700),
  rec('codex', 'codex-old', NOW - 10 * 86400_000, 500),
];

type PageFactory = (win: WindowKey) => React.ReactElement;
const pageFactories: [string, PageFactory][] = [
  ['overview', (win) => <Overview records={records} now={NOW} theme={THEMES[0]} srcFilter="codex" win={win} />],
  ['timeline', (win) => <Timeline records={records} now={NOW} theme={THEMES[0]} srcFilter="codex" win={win} />],
  ['models', (win) => <Models records={records} now={NOW} theme={THEMES[0]} srcFilter="codex" win={win} sort={{ col: 4, dir: -1 }} onSort={() => {}} />],
  ['requests', (win) => <Requests records={records} now={NOW} theme={THEMES[0]} srcFilter="codex" win={win} scroll={0} />],
];

test('source and time filters stay consistent across all four pages', () => {
  for (const [name, factory] of pageFactories) {
    const today = render(factory('today'));
    const todayFrame = today.lastFrame()!;
    today.unmount();
    assert.ok(todayFrame.includes('1 requests'), `${name}: today count`);
    assert.ok(!todayFrame.includes('CLAUDE'), `${name}: source filter`);

    const all = render(factory('all'));
    const allFrame = all.lastFrame()!;
    all.unmount();
    assert.ok(allFrame.includes('2 requests'), `${name}: all-time count`);
    assert.ok(!allFrame.includes('CLAUDE'), `${name}: all-time source filter`);
  }
});

test('page navigation preserves filters and sorting while resetting scroll', () => {
  let state = initialState();
  state = appReducer(state, { t: 'srcSet', src: 'codex' });
  state = appReducer(state, { t: 'win', w: 'today' });
  state = appReducer(state, { t: 'down' });
  state = appReducer(state, { t: 'down' });
  state = appReducer(state, { t: 'page', p: 'models' });
  assert.equal(state.srcFilter, 'codex');
  assert.equal(state.win, 'today');
  assert.equal(state.scroll, 0);

  state = appReducer(state, { t: 'right' });
  state = appReducer(state, { t: 'enter' });
  assert.equal(state.sortCol, 5);
  assert.equal(state.sortDir, 1);

  state = appReducer(state, { t: 'page', p: 'requests' });
  state = appReducer(state, { t: 'bottom' });
  assert.equal(state.scroll, Number.MAX_SAFE_INTEGER);
  state = appReducer(state, { t: 'page', p: 'overview' });
  assert.equal(state.scroll, 0);
  assert.equal(state.sortCol, 5);
  assert.equal(state.sortDir, 1);
  assert.equal(state.srcFilter, 'codex');
  assert.equal(state.win, 'today');
});

test('Models opens with output descending as the default sort', () => {
  const inst = render(
    <App records={records} now={NOW} initial={{ page: 'models', srcFilter: 'codex', win: 'today' }} />,
  );
  const frame = inst.lastFrame()!;
  inst.unmount();
  assert.ok(frame.includes('SORT OUTPUT ▼'));
  assert.equal(initialState().sortCol, 4);
  assert.equal(initialState().sortDir, -1);
});
