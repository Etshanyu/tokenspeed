import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fmtTok, fmtDur, fmtTps, fmtPct,
  displayWidth, truncateToWidth, projShort, sidShort,
} from './fmt.ts';

test('fmtTok keeps small numbers raw', () => {
  assert.equal(fmtTok(999), '999');
  assert.equal(fmtTok(0), '0');
});

test('fmtTok compacts with one decimal, trailing zero stripped', () => {
  assert.equal(fmtTok(1234), '1.2k');
  assert.equal(fmtTok(1000), '1k');
  assert.equal(fmtTok(999_999), '1M');
  assert.equal(fmtTok(2_500_000_000), '2.5B');
});

test('fmtDur renders human time spans', () => {
  assert.equal(fmtDur(42_000), '42s');
  assert.equal(fmtDur(87_000), '1m27s');
  assert.equal(fmtDur(12_600_000), '3.5h');
  assert.equal(fmtDur(190_800_000), '2d5h');
});

test('fmtTps null becomes em-dash, decimals by magnitude', () => {
  assert.equal(fmtTps(null), '—');
  assert.equal(fmtTps(52.66), '52.7');
  assert.equal(fmtTps(161.7), '162');
});

test('fmtPct renders fraction as percentage', () => {
  assert.equal(fmtPct(0.925), '92.5%');
  assert.equal(fmtPct(1), '100%');
});

test('displayWidth measures CJK as width 2', () => {
  assert.equal(displayWidth('中文'), 4);
  assert.equal(displayWidth('中文ab'), 6);
  assert.equal(displayWidth('abc'), 3);
});

test('truncateToWidth cuts CJK strings to display width with ellipsis', () => {
  const out = truncateToWidth('中文六字路径', 5);
  assert.ok(out.endsWith('…'));
  assert.ok(displayWidth(out) <= 5);
  assert.equal(truncateToWidth('ab', 5), 'ab');
});

test('projShort returns last dash segment', () => {
  assert.equal(projShort('C--Users-x-Desktop-developer-console'), 'console');
  assert.equal(projShort('nodashes'), 'nodashes');
});

test('sidShort returns first 8 chars of a uuid', () => {
  assert.equal(sidShort('6ed71ae7-a065-4c99-ad06-e9cdc8b53d34'), '6ed71ae7');
});
