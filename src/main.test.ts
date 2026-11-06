import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import React from 'react';
import { render } from 'ink-testing-library';
import { Boot, buildRuntime } from './main.tsx';

let root = '';
let cacheDir = '';

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ts-main-'));
  cacheDir = path.join(root, 'cachedir');
  const proj = path.join(root, '.claude', 'projects', 'C--proj--demo');
  await fs.mkdir(proj, { recursive: true });
  const ts = new Date().toISOString().replace('Z', 'Z');
  await fs.writeFile(
    path.join(proj, 'sess-1.jsonl'),
    [
      JSON.stringify({ type: 'user', timestamp: '2026-11-05T01:00:00Z', message: {} }),
      JSON.stringify({
        type: 'assistant', timestamp: '2026-11-05T01:00:05Z', requestRef: null,
        message: {
          id: 'm1', model: 'glm-5.3',
          usage: { input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 42 },
        },
      }),
    ].join('\n') + '\n',
  );
  void ts;
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

test('buildRuntime scans via adapters, persists cache, second run is incremental', async () => {
  const first = await buildRuntime({ root, cacheDir });
  assert.ok(first.records.length >= 1);
  assert.equal(first.records[0].outTok, 42);
  assert.equal(first.scanned, 1);
  assert.ok(await fs.stat(first.cachePath));

  const second = await buildRuntime({ root, cacheDir });
  assert.equal(second.fromCache, 1);
  assert.equal(second.scanned, 0);

  const rescanned = await buildRuntime({ root, cacheDir, rescan: true });
  assert.equal(rescanned.scanned, 1);
});

test('boot screen hides progress details and session file names', () => {
  const inst = render(React.createElement(Boot));
  const frame = inst.lastFrame()!;
  inst.unmount();
  assert.ok(frame.includes('loading local telemetry'));
  assert.ok(!frame.includes('100%'));
  assert.ok(!frame.includes('session-'));
  assert.ok(!frame.includes('████'));
});
