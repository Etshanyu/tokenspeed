import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sparkline, heatStrip, gaugeBar, histogram } from './chart.ts';

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');

test('sparkline resamples to exact width both directions', () => {
  const long = sparkline([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5);
  assert.equal(stripAnsi(long).length, 5);
  const short = sparkline([1, 5], 8);
  assert.equal(stripAnsi(short).length, 8);
});

test('sparkline all-zero is the floor glyph everywhere', () => {
  assert.equal(stripAnsi(sparkline([0, 0, 0, 0], 6)), '▁'.repeat(6));
});

test('sparkline rising values rise left to right', () => {
  const s = stripAnsi(sparkline([0, 5, 10], 3));
  assert.equal(s[0], '▁');
  assert.equal(s[2], '█');
});

test('heatStrip emits exactly width cells', () => {
  const strip = heatStrip([1, 2, 3, 4, 5, 6, 7, 8], 10, ['#111111', '#444444', '#888888', '#ffffff']);
  assert.equal(stripAnsi(strip).length, 10);
  const empty = heatStrip([], 6, ['#111111', '#222222']);
  assert.equal(stripAnsi(empty).length, 6);
});

test('heatStrip higher values get brighter glyphs and colors', () => {
  const strip = heatStrip([0, 10], 2, ['#000000', '#333333', '#777777', '#ffffff']);
  const plain = stripAnsi(strip);
  assert.equal(plain[0], '░');
  assert.equal(plain[1], '█');
  assert.ok(strip.includes('\x1b[38;2;255;255;255m')); // top color on the hot cell
});

test('gaugeBar fills proportionally', () => {
  assert.equal(gaugeBar(5, 10, 10, '#', '·'), '#####·····');
  assert.equal(gaugeBar(0, 10, 4, '#', '·'), '····');
  assert.equal(gaugeBar(99, 10, 4, '#', '·'), '####'); // clamps
});

test('gaugeBar with zero max is all track', () => {
  assert.equal(gaugeBar(5, 0, 5, '#', '·'), '·····');
});

test('histogram returns height equal-width rows', () => {
  const rows = histogram(
    [{ values: [1, 2, 3, 4], color: '#22d3ee' }, { values: [1, 2, 3, 4], color: '#f59e0b' }],
    4, 5,
  );
  assert.equal(rows.length, 5);
  const widths = new Set(rows.map((r) => stripAnsi(r).length));
  assert.equal(widths.size, 1);
  assert.equal([...widths][0], 8); // 4 buckets x 2 series
});

test('histogram monotonic rise: top row holds right side blocks only', () => {
  const rows = histogram([{ values: [0, 0, 0, 10], color: '#22d3ee' }], 4, 4);
  const top = stripAnsi(rows[0]);
  assert.equal(top.slice(0, 3), '   ');
  assert.equal(top[3], '█');
  const bottom = stripAnsi(rows[3]);
  assert.equal(bottom[3], '█');
  assert.equal(bottom[0], ' ');
});

test('histogram empty series renders blank rows of correct width', () => {
  const rows = histogram([{ values: [], color: '#fff' }], 3, 2);
  assert.deepEqual(rows.map(stripAnsi), ['   ', '   ']);
});
