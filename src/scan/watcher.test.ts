import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { startWatch } from './watcher.ts';

const cleaners: (() => void)[] = [];
after(() => cleaners.forEach((c) => c()));

function waitFor(cond: () => boolean, ms = 2000): Promise<boolean> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const tick = (): void => {
      if (cond()) resolve(true);
      else if (Date.now() - t0 > ms) resolve(false);
      else setTimeout(tick, 50);
    };
    tick();
  });
}

test('file creation fires onDirty (debounced)', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ts-watch-'));
  const sub = path.join(dir, 'a', 'b');
  await fs.mkdir(sub, { recursive: true });
  let fires = 0;
  const stop = startWatch([dir], () => { fires++; });
  cleaners.push(stop);
  await new Promise((r) => setTimeout(r, 400)); // let the watcher arm
  await fs.writeFile(path.join(sub, 'x.jsonl'), 'hello');
  await fs.writeFile(path.join(sub, 'y.jsonl'), 'hello'); // rapid second write
  const ok = await waitFor(() => fires >= 1);
  assert.ok(ok, 'onDirty should fire after file creation');
  const snapshot = fires;
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(fires, snapshot); // debounce: no further fires without changes
});

test('stop() ends watching', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ts-watch2-'));
  let fires = 0;
  const stop = startWatch([dir], () => { fires++; });
  await new Promise((r) => setTimeout(r, 300));
  stop();
  await fs.writeFile(path.join(dir, 'z.jsonl'), 'x');
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(fires, 0);
  await fs.rm(dir, { recursive: true, force: true });
});
