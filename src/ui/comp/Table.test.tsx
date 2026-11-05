import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import { Table } from './Table.tsx';
import type { Column } from './Table.tsx';

interface Row { name: string; n: number }

const columns: Column<Row>[] = [
  { key: 'name', header: 'NAME', width: 10, render: (r) => r.name },
  { key: 'n', header: 'COUNT', width: 6, align: 'r', render: (r) => String(r.n) },
];

test('renders header row', () => {
  const { lastFrame } = render(<Table columns={columns} rows={[]} />);
  assert.ok(lastFrame()!.includes('NAME'));
  assert.ok(lastFrame()!.includes('COUNT'));
});

test('renders rows with right-aligned numeric column', () => {
  const { lastFrame } = render(
    <Table columns={columns} rows={[{ name: 'alpha', n: 42 }]} />,
  );
  const frame = lastFrame()!;
  assert.ok(frame.includes('alpha'));
  assert.ok(frame.includes('    42'));
});

test('scroll window slices rows', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ name: `row${i}`, n: i }));
  const { lastFrame } = render(
    <Table columns={columns} rows={rows} scroll={10} visible={5} />,
  );
  const frame = lastFrame()!;
  assert.ok(frame.includes('row10'));
  assert.ok(frame.includes('row11'));
  assert.ok(!frame.includes('row0'));
});

test('table truncates CJK to column width with ellipsis', () => {
  const cjk: Column<{ name: string; n: number }>[] = [
    { key: 'name', header: 'NAME', width: 6, render: (r) => r.name },
    { key: 'n', header: 'N', width: 3, align: 'r', render: (r) => String(r.n) },
  ];
  const { lastFrame } = render(
    <Table columns={cjk} rows={[{ name: '中文项目路径很长', n: 1 }]} />,
  );
  const frame = lastFrame()!;
  assert.ok(frame.includes('…'));
  assert.ok(!frame.includes('很长')); // the tail was cut within width 6
});

test('color fn wiring does not break rendering', () => {
  // ink-testing-library strips ANSI from frames, so we assert structure, not codes
  const colored: Column<Row>[] = [
    { ...columns[0], color: (r) => (r.n > 10 ? 'green' : undefined) },
    columns[1],
  ];
  const { lastFrame } = render(
    <Table columns={colored} rows={[{ name: 'hi', n: 99 }]} />,
  );
  const frame = lastFrame()!;
  assert.ok(frame.includes('hi'));
  assert.ok(frame.includes('99'));
  assert.ok(frame.includes('    99')); // alignment intact with color fn active
});
