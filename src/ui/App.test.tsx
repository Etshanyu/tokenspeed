import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import React from 'react';
import { render } from 'ink-testing-library';
import { initialState, appReducer, App } from './App.tsx';
import type { KeyAction } from './keys.ts';

const act = (state: ReturnType<typeof initialState>, a: KeyAction) => appReducer(state, a);

test('reducer switches pages and cycles with tab', () => {
  let s = initialState();
  s = act(s, { t: 'page', p: 'models' });
  assert.equal(s.page, 'models');
  s = act(s, { t: 'tab' });
  assert.equal(s.page, 'requests');
  s = act(s, { t: 'tabBack' });
  assert.equal(s.page, 'models');
});

test('reducer sets source filter via srcSet', () => {
  let s = initialState();
  s = act(s, { t: 'srcSet', src: 'codex' });
  assert.equal(s.srcFilter, 'codex');
  s = act(s, { t: 'srcSet', src: 'all' });
  assert.equal(s.srcFilter, 'all');
});

test('reducer cycles windows in order today->7d->30d->all->today', () => {
  let s = initialState();
  assert.equal(s.win, '7d'); // default
  s = act(s, { t: 'winCycle' });
  assert.equal(s.win, '30d');
  s = act(s, { t: 'winCycle' });
  assert.equal(s.win, 'all');
  s = act(s, { t: 'winCycle' });
  assert.equal(s.win, 'today');
  s = act(s, { t: 'win', w: '7d' });
  assert.equal(s.win, '7d');
});

test('reducer cycles themes and clamps scroll', () => {
  let s = initialState();
  const nThemes = 3;
  for (let i = 0; i < nThemes; i++) s = act(s, { t: 'theme' });
  assert.equal(s.themeIdx, initialState().themeIdx);
  s = act(s, { t: 'down' });
  assert.equal(s.scroll, 1);
  s = act(s, { t: 'up' });
  assert.equal(s.scroll, 0);
  s = act(s, { t: 'up' });
  assert.equal(s.scroll, 0); // clamped at top
  s = act(s, { t: 'top' });
  assert.equal(s.scroll, 0);
  s = act(s, { t: 'bottom' });
  assert.ok(s.scroll > 1000000); // sentinel; pages clamp to content
});

test('reducer sort controls move column and flip direction', () => {
  let s = initialState();
  s = act(s, { t: 'right' });
  assert.equal(s.sortCol, initialState().sortCol + 1);
  s = act(s, { t: 'left' });
  assert.equal(s.sortCol, initialState().sortCol);
  const dir0 = s.sortDir;
  s = act(s, { t: 'enter' });
  assert.equal(s.sortDir, -dir0);
});

test('app shell renders banner, nav, filters, status bar', () => {
  const inst = render(
    <App records={[]} now={new Date('2026-11-05T12:00:00').getTime()} />,
  );
  const frame = inst.lastFrame()!;
  inst.unmount(); // release the stdin listener so the runner can exit
  // banner: compact one-line header with gradient TOKEN SPEED + subtitle
  assert.ok(frame.includes('observatory'));
  assert.ok(frame.includes('Codex + Claude + DSH')); // capitalized like the screenshot
  assert.ok(/TOKEN SPEED/.test(frame));
  assert.ok(frame.includes('F1 Overview'));
  assert.ok(frame.includes('F2 Timeline'));
  assert.ok(frame.includes('SOURCE'));
  assert.ok(frame.includes('WINDOW'));
  assert.ok(/LIVE|paused/i.test(frame));
  assert.ok(frame.includes('q quit'));
});

test('app shell shows filter key hints for registered adapters', () => {
  const inst = render(
    <App records={[]} now={new Date('2026-11-05T12:00:00').getTime()} />,
  );
  const frame = inst.lastFrame()!;
  inst.unmount();
  assert.ok(frame.includes('1 All'));
  assert.ok(frame.includes('2 Codex') || frame.includes('2 CODEX'));
  assert.ok(frame.includes('3 Claude') || frame.includes('3 CLAUDE'));
});

test('initial page opens the requested view directly', () => {
  const inst = render(
    <App records={[]} now={new Date('2026-11-05T12:00:00').getTime()} initial={{ page: 'timeline' }} />,
  );
  const frame = inst.lastFrame()!;
  inst.unmount();
  assert.ok(frame.includes('TIMELINE'));
  assert.ok(!frame.includes('ACTIVITY MAP'));
});

test('reducer toggles language in both directions', () => {
  let s = initialState();
  assert.equal(s.lang, 'en');
  s = act(s, { t: 'lang' });
  assert.equal(s.lang, 'zh');
  s = act(s, { t: 'lang' });
  assert.equal(s.lang, 'en');
});

test('Chinese shell translates navigation, panels and shortcuts', () => {
  const inst = render(
    <App records={[]} now={new Date('2026-11-05T12:00:00').getTime()} initial={{ lang: 'zh' }} />,
  );
  const frame = inst.lastFrame()!;
  inst.unmount();
  assert.ok(frame.includes('F1 概览'));
  assert.ok(frame.includes('F2 时间线'));
  assert.ok(frame.includes('F3 模型'));
  assert.ok(frame.includes('F4 请求'));
  assert.ok(frame.includes('活动图'));
  assert.ok(frame.includes('模型使用'));
  assert.ok(frame.includes('l EN'));
  assert.ok(frame.includes('q 退出'));
});

const flushInput = () => new Promise<void>((resolve) => setImmediate(resolve));

test('Ink stdin handles language switching and tab navigation', async () => {
  let current: { page: string; srcFilter: string; lang: string } | undefined;
  const inst = render(
    <App
      records={[]}
      now={new Date('2026-11-05T12:00:00').getTime()}
      onStateChange={(next) => { current = next; }}
    />,
  );
  try {
    await flushInput();
    inst.stdin.write('l');
    await flushInput();
    assert.ok(inst.lastFrame()!.includes('F1 概览'));

    inst.stdin.write('\t');
    await flushInput();
    assert.equal(current?.page, 'timeline');

    inst.stdin.write('L');
    await flushInput();
    assert.equal(current?.lang, 'en');
    assert.ok(inst.lastFrame()!.includes('F1 Overview'));
  } finally {
    inst.unmount();
  }
});

test('Ink stdin handles chained source keys, returning to 1 and chained language keys', async () => {
  const home = mkdtempSync(join(tmpdir(), 'tokenspeed-input-'));
  mkdirSync(join(home, '.codex'));
  mkdirSync(join(home, '.claude', 'projects'), { recursive: true });
  mkdirSync(join(home, '.dsh', 'storages', 'session_projcache', 'sessions'), { recursive: true });
  let current: { page: string; srcFilter: string; lang: string } | undefined;
  const inst = render(
    <App
      records={[]}
      home={home}
      now={new Date('2026-11-05T12:00:00').getTime()}
      onStateChange={(next) => { current = next; }}
    />,
  );
  try {
    await flushInput();
    inst.stdin.write('2341lL');
    await flushInput();
    assert.equal(current?.srcFilter, 'all');
    assert.equal(current?.lang, 'en');

    inst.stdin.write('4');
    await flushInput();
    assert.equal(current?.srcFilter, 'dsh');
    inst.stdin.write('1');
    await flushInput();
    assert.equal(current?.srcFilter, 'all');
  } finally {
    inst.unmount();
    rmSync(home, { recursive: true, force: true });
  }
});
