import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { dshAdapter } from './dsh.ts';
import { ADAPTERS, filterKeys } from './index.ts';

let root = '';
let sessDir = '';

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ts-dsh-'));
  sessDir = path.join(root, '.dsh', 'storages', 'session_projcache', 'sessions');
  await fs.mkdir(sessDir, { recursive: true });
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function dshDoc(o: {
  createdAt?: number; lastMessageTime?: number; cwd?: string; uncached?: number; out?: number; cacheRead?: number;
  cacheWrite?: number; decodeMs?: number; llmMs?: number; steps?: number; model?: string | null;
}): string {
  const rows: Record<string, unknown> = {
    tokenUsage: { ver: 2, seq: 1, val: { totals: {
      uncachedInputTokens: o.uncached ?? 100,
      outputTokens: o.out ?? 50,
      cacheReadTokens: o.cacheRead ?? 10,
      cacheWriteTokens: o.cacheWrite ?? 0,
    } } },
    sessionStats: { ver: 1, seq: 1, val: {
      llmMs: o.llmMs ?? 90000, steps: o.steps ?? 7,
      decodeMs: o.decodeMs ?? 60000, decodeTokens: o.out ?? 50,
    } },
    timeContext: { ver: 1, seq: 1, val: { lastMessageTime: o.lastMessageTime ?? 1793610999999 } },
    modelSelection: { ver: 1, seq: 1, val: o.model === null ? {} : { lastUsed: { model: o.model ?? 'deepseek-flash' } } },
  };
  return JSON.stringify({
    version: 7,
    record: {
      identity: { createdAt: o.createdAt ?? 1793610928929, cwd: o.cwd ?? 'C:\\work\\maotai' },
      rows,
    },
  });
}

async function write(name: string, content: string): Promise<{ path: string; mtimeMs: number; size: number }> {
  const p = path.join(sessDir, name);
  await fs.writeFile(p, content);
  const st = await fs.stat(p);
  return { path: p, mtimeMs: st.mtimeMs, size: st.size };
}

test('parses cumulative session totals without inventing requests', async () => {
  const f = await write('session-abc12345-xxxx.jsonl'.replace('.jsonl', '.json'), dshDoc({
    createdAt: 1793610928929, lastMessageTime: 1793610999999, cwd: 'C:\\work\\maotai',
    uncached: 100741, out: 13077, cacheRead: 1561216, cacheWrite: 0,
    decodeMs: 66997, steps: 355, model: 'deepseek-flash',
  }));
  const recs = await dshAdapter.parse(root, f);
  assert.equal(recs.length, 1);
  const r = recs[0];
  assert.equal(r.src, 'dsh');
  assert.equal(r.sid, 'abc12345-xxxx'); // session- prefix stripped
  assert.equal(r.proj, 'C:\\work\\maotai');
  assert.equal(r.ts, 1793610999999);
  assert.equal(r.model, 'deepseek-flash');
  assert.equal(r.inTok, 100741);
  assert.equal(r.outTok, 13077);
  assert.equal(r.cacheRead, 1561216);
  assert.equal(r.cacheWrite, 0);
  assert.equal(r.durMs, 66997); // real cumulative decode time
  assert.equal(r.reasonTok, 0);
  assert.equal(r.kind, 'session');
  assert.equal(r.requestCount, 355);
});

test('does not substitute llmMs for missing decode duration', async () => {
  const f = await write('plain-id.json', dshDoc({ decodeMs: 0, llmMs: 123456 }));
  const recs = await dshAdapter.parse(root, f);
  assert.equal(recs[0].durMs, 0);
});

test('defaults model to deepseek when modelSelection absent', async () => {
  const f = await write('nomodel.json', dshDoc({ model: null }));
  const recs = await dshAdapter.parse(root, f);
  assert.equal(recs[0].model, 'deepseek');
});

test('skips corrupt json files', async () => {
  const f = await write('broken.json', '{not json');
  const recs = await dshAdapter.parse(root, f);
  assert.equal(recs.length, 0);
});

test('discovers session json files', async () => {
  const found = dshAdapter.discover(root);
  assert.ok(found.length >= 4);
  assert.ok(found.every((e) => e.path.endsWith('.json')));
});

test('available reflects dsh dir existence', async () => {
  assert.equal(dshAdapter.available(root), true);
  const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'ts-empty-'));
  assert.equal(dshAdapter.available(empty), false);
  await fs.rm(empty, { recursive: true, force: true });
});

test('registry order matches screenshot (codex, claude, dsh)', () => {
  assert.deepEqual(ADAPTERS.map((a) => a.id), ['codex', 'claude', 'dsh']);
});

test('filterKeys allocates sequential digits from the registry', () => {
  assert.deepEqual(filterKeys(ADAPTERS), [
    { key: '1', src: 'all' },
    { key: '2', src: 'codex' },
    { key: '3', src: 'claude' },
    { key: '4', src: 'dsh' },
  ]);
});

test('adapter availability is per-source on a partial root', async () => {
  // root has .dsh but no .codex
  assert.equal(ADAPTERS.find((a) => a.id === 'codex')!.available(root), false);
  assert.equal(ADAPTERS.find((a) => a.id === 'dsh')!.available(root), true);
});

test('every adapter exposes its own watch dirs (no whole-home watching)', () => {
  for (const a of ADAPTERS) {
    const dirs = a.watchDirs?.(root) ?? [];
    assert.ok(dirs.length > 0, `${a.id} must declare watchDirs`);
    for (const d of dirs) {
      assert.ok(!d.endsWith(root.replaceAll('\\', '/').split('/').pop()!) || d !== root, `${a.id} must not watch the whole home`);
      assert.ok(d.length > root.length, `${a.id} watch dir must be below root`);
    }
  }
});
