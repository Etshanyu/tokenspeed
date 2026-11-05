import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CACHE_VERSION, loadCache, scanAll, saveCache } from './indexer.ts';
import type { SourceAdapter, TurnRecord } from '../sources/types.ts';

let root = '';
let dataDir = '';
let cachePath = '';

/** fake adapter: each .rec file is "sid outTok" per line */
const fakeAdapter: SourceAdapter = {
  id: 'fake', label: 'FAKE', color: '#ffffff',
  available: () => true,
  discover() {
    return readdirSync(dataDir).filter((f) => f.endsWith('.rec')).map((f) => {
      const p = path.join(dataDir, f);
      const st = statSync(p);
      return { path: p, mtimeMs: st.mtimeMs, size: st.size };
    });
  },
  async parse(_r, file) {
    const records: TurnRecord[] = [];
    for (const line of readFileSync(file.path, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const [sid, out] = line.split(' ');
      records.push({
        src: 'fake', sid, proj: 'p', ts: 1, model: 'm',
        inTok: 0, cacheRead: 0, cacheWrite: 0, outTok: Number(out), reasonTok: 0, durMs: 1000,
      });
    }
    return records;
  },
};

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ts-idx-'));
  dataDir = path.join(root, 'data');
  cachePath = path.join(root, 'cache.json');
  await fs.mkdir(dataDir, { recursive: true });
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function writeRec(name: string, lines: string[]): Promise<void> {
  await fs.writeFile(path.join(dataDir, name), lines.join('\n') + '\n');
}

test('first scan parses everything', async () => {
  await writeRec('a.rec', ['s1 100', 's2 200']);
  await writeRec('b.rec', ['s3 300']);
  const { store, result } = await scanAll({ adapters: [fakeAdapter], root, cache: null });
  assert.equal(result.scanned, 2);
  assert.equal(result.fromCache, 0);
  assert.equal(result.records.length, 3);
  assert.equal(store.version, CACHE_VERSION);
  assert.equal(Object.keys(store.files).length, 2);
});

test('second scan is fully cached', async () => {
  await writeRec('a.rec', ['s1 100', 's2 200']);
  await writeRec('b.rec', ['s3 300']);
  const first = await scanAll({ adapters: [fakeAdapter], root, cache: null });
  const second = await scanAll({ adapters: [fakeAdapter], root, cache: first.store });
  assert.equal(second.result.scanned, 0);
  assert.equal(second.result.fromCache, 2);
  assert.deepEqual(
    second.result.records.map((r) => r.sid).sort(),
    ['s1', 's2', 's3'],
  );
});

test('changed file is rescanned and records updated', async () => {
  await writeRec('a.rec', ['s1 100']);
  await writeRec('b.rec', ['s3 300']);
  const first = await scanAll({ adapters: [fakeAdapter], root, cache: null });
  // rewrite b with different content and ensure mtime/size change
  await new Promise((r) => setTimeout(r, 20));
  await writeRec('b.rec', ['s3 999', 's4 400']);
  const second = await scanAll({ adapters: [fakeAdapter], root, cache: first.store });
  assert.equal(second.result.scanned, 1);
  assert.equal(second.result.fromCache, 1);
  assert.ok(second.result.records.some((r) => r.outTok === 999));
  assert.ok(second.result.records.some((r) => r.sid === 's4'));
});

test('deleted files drop out of the store', async () => {
  await writeRec('a.rec', ['s1 100']);
  await writeRec('b.rec', ['s3 300']);
  const first = await scanAll({ adapters: [fakeAdapter], root, cache: null });
  await fs.rm(path.join(dataDir, 'b.rec'));
  const second = await scanAll({ adapters: [fakeAdapter], root, cache: first.store });
  assert.equal(second.result.records.length, 1);
  assert.equal(second.store.files[path.join(dataDir, 'b.rec')], undefined);
});

test('corrupt cache loads as null', async () => {
  await fs.writeFile(cachePath, '{broken');
  assert.equal(loadCache(cachePath), null);
});

test('version mismatch loads as null', async () => {
  await fs.writeFile(cachePath, JSON.stringify({ version: 99999, files: {} }));
  assert.equal(loadCache(cachePath), null);
});

test('saveCache then loadCache round-trips', async () => {
  await writeRec('a.rec', ['s1 100']);
  const { store } = await scanAll({ adapters: [fakeAdapter], root, cache: null });
  await saveCache(cachePath, store);
  const loaded = loadCache(cachePath);
  assert.notEqual(loaded, null);
  assert.equal(loaded!.version, CACHE_VERSION);
  assert.deepEqual(loaded!.files[path.join(dataDir, 'a.rec')].records.map((r) => r.sid), ['s1']);
});

test('parse failures become empty records without breaking the scan', async () => {
  await fs.writeFile(path.join(dataDir, 'crash.rec'), 's9 900');
  const crashy: SourceAdapter = {
    ...fakeAdapter,
    async parse() {
      throw new Error('boom');
    },
  };
  const { result } = await scanAll({ adapters: [crashy], root, cache: null });
  assert.equal(result.records.length, 0);
  assert.ok(result.scanned >= 1); // crash.rec (plus leftovers from earlier tests) all absorbed
});
