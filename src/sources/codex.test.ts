import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { codexAdapter } from './codex.ts';

let root = '';
let sessDir = '';
let archDir = '';

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ts-codex-'));
  sessDir = path.join(root, '.codex', 'sessions', '2026', '11', '05');
  archDir = path.join(root, '.codex', 'archived_sessions');
  await fs.mkdir(sessDir, { recursive: true });
  await fs.mkdir(archDir, { recursive: true });
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const meta = (ts: string, cwd: string) =>
  JSON.stringify({ timestamp: ts, ordinal: 0, type: 'session_meta', payload: { cwd } });
const ctx = (ts: string, turn: string, model: string) =>
  JSON.stringify({ timestamp: ts, ordinal: 1, type: 'turn_context', payload: { turn_id: turn, model } });
const started = (ts: string, turn: string) =>
  JSON.stringify({ timestamp: ts, ordinal: 2, type: 'event_msg', payload: { type: 'task_started', turn_attribution: { turn_id: turn } } });
const rec = (ts: string, thread: string, turn: string, o: { inp?: number; cached?: number; cw?: number; out?: number; reason?: number; cumulative?: boolean } = {}) =>
  JSON.stringify({
    timestamp: ts, ordinal: 3, type: 'token_usage_record',
    payload: {
      thread_id: thread, turn_id: turn, session_id: 'sess-1',
      ...(o.cumulative
        ? { turn_token_usage: { input_tokens: 9999, output_tokens: 9999 } }
        : {
            usage: {
              input_tokens: o.inp ?? 100,
              cached_input_tokens: o.cached ?? 0,
              cache_write_input_tokens: o.cw ?? 0,
              output_tokens: o.out ?? 50,
              reasoning_output_tokens: o.reason ?? 0,
              total_tokens: (o.inp ?? 100) + (o.out ?? 50),
            },
          }),
    },
  });

async function write(name: string, lines: string[]): Promise<{ path: string; mtimeMs: number; size: number }> {
  const p = path.join(sessDir, name);
  await fs.writeFile(p, lines.join('\n') + '\n');
  const st = await fs.stat(p);
  return { path: p, mtimeMs: st.mtimeMs, size: st.size };
}

test('parses per-response usage with inTok = input - cached', async () => {
  const f = await write('a.jsonl', [
    meta('2026-11-05T01:00:00Z', 'C:\\work\\proj'),
    ctx('2026-11-05T01:00:01Z', 't1', 'gpt-5.1-codex'),
    rec('2026-11-05T01:00:05Z', 'th1', 't1', { inp: 1000, cached: 400, cw: 20, out: 200, reason: 50 }),
  ]);
  const recs = await codexAdapter.parse(root, f);
  assert.equal(recs.length, 1);
  const r = recs[0];
  assert.equal(r.src, 'codex');
  assert.equal(r.inTok, 600);
  assert.equal(r.cacheRead, 400);
  assert.equal(r.cacheWrite, 20);
  assert.equal(r.outTok, 200);
  assert.equal(r.reasonTok, 50);
  assert.equal(r.sid, 'th1');
  assert.equal(r.proj, 'C:\\work\\proj');
  assert.equal(r.model, 'gpt-5.1-codex');
});

test('computes duration from previous record in same thread only', async () => {
  const f = await write('b.jsonl', [
    meta('2026-11-05T02:00:00Z', 'p'),
    ctx('2026-11-05T02:00:01Z', 't1', 'gpt-5.1-codex'),
    started('2026-11-05T02:00:02Z', 't1'),
    rec('2026-11-05T02:00:03Z', 'thX', 't1'),        // first in thX -> task_started anchor (1s)
    rec('2026-11-05T02:00:10Z', 'thY', 't1'),        // different thread, does not affect thX
    rec('2026-11-05T02:01:00Z', 'thX', 't1'),        // 57s after 02:00:03
  ]);
  const recs = await codexAdapter.parse(root, f);
  assert.equal(recs.length, 3);
  assert.equal(recs[0].durMs, 1000);
  assert.equal(recs[2].durMs, 57000);
});

test('uses token_count anchor when present', async () => {
  const tc = (ts: string) =>
    JSON.stringify({ timestamp: ts, ordinal: 4, type: 'event_msg', payload: { type: 'token_count', info: {} } });
  const f = await write('c2.jsonl', [
    meta('2026-11-05T02:30:00Z', 'p'),
    ctx('2026-11-05T02:30:01Z', 't1', 'gpt-5.1-codex'),
    rec('2026-11-05T02:30:02Z', 'th', 't1'),
    tc('2026-11-05T02:30:02.010Z'),   // next request sent ~instantly after prev record
    rec('2026-11-05T02:30:07Z', 'th', 't1'), // 4.99s after tc anchor (not 5s after prev record)
  ]);
  const recs = await codexAdapter.parse(root, f);
  assert.equal(recs[1].durMs, 4990);
});

test('clamps inter-record gaps to 10 minutes', async () => {
  const f = await write('c.jsonl', [
    meta('2026-11-05T03:00:00Z', 'p'),
    rec('2026-11-05T03:00:00Z', 'th', 't1'),
    rec('2026-11-05T03:25:00Z', 'th', 't1'), // 25min gap -> clamp
  ]);
  const recs = await codexAdapter.parse(root, f);
  assert.equal(recs[1].durMs, 600000);
});

test('model falls back to last known when turn unknown', async () => {
  const f = await write('d.jsonl', [
    meta('2026-11-05T04:00:00Z', 'p'),
    ctx('2026-11-05T04:00:01Z', 't1', 'o4-mini'),
    rec('2026-11-05T04:00:02Z', 'th', 't1'),
    rec('2026-11-05T04:00:03Z', 'th', 't-unknown-turn'),
  ]);
  const recs = await codexAdapter.parse(root, f);
  assert.equal(recs[0].model, 'o4-mini');
  assert.equal(recs[1].model, 'o4-mini'); // last known
});

test('skips malformed lines without crashing', async () => {
  const f = await write('e.jsonl', [
    'garbage line',
    '',
    meta('2026-11-05T05:00:00Z', 'p'),
    rec('2026-11-05T05:00:01Z', 'th', 't1'),
    '{"type":"token_usage_record","payl',
  ]);
  const recs = await codexAdapter.parse(root, f);
  assert.equal(recs.length, 1);
});

test('never reads cumulative usage fields', async () => {
  const f = await write('f.jsonl', [
    meta('2026-11-05T06:00:00Z', 'p'),
    rec('2026-11-05T06:00:01Z', 'th', 't1', { cumulative: true }),
  ]);
  const recs = await codexAdapter.parse(root, f);
  assert.equal(recs.length, 0);
});

test('reads zst archives identically', async (t) => {
  if (typeof (zlib as unknown as Record<string, unknown>).zstdCompressSync !== 'function') {
    t.skip('node zlib zstd unavailable');
    return;
  }
  const lines = [
    meta('2026-11-05T07:00:00Z', 'p2'),
    ctx('2026-11-05T07:00:01Z', 't1', 'gpt-5.1-codex'),
    rec('2026-11-05T07:00:02Z', 'thZ', 't1', { out: 77 }),
  ];
  const zst = zlib.zstdCompressSync(Buffer.from(lines.join('\n') + '\n', 'utf8'));
  const p = path.join(archDir, 'rollout-x.jsonl.zst');
  await fs.writeFile(p, zst);
  const st = await fs.stat(p);
  const recs = await codexAdapter.parse(root, { path: p, mtimeMs: st.mtimeMs, size: st.size });
  assert.equal(recs.length, 1);
  assert.equal(recs[0].outTok, 77);
  assert.equal(recs[0].proj, 'p2');
});

test('discovers plain, zst, and archived sessions', async () => {
  const lines = [meta('2026-11-05T08:00:00Z', 'p'), rec('2026-11-05T08:00:01Z', 'th', 't1')];
  await fs.writeFile(path.join(sessDir, 'rollout-a.jsonl'), lines.join('\n') + '\n');
  await fs.writeFile(path.join(archDir, 'rollout-b.jsonl'), lines.join('\n') + '\n');
  const found = await codexAdapter.discover(root);
  const rel = found.map((e) => path.relative(root, e.path).split(path.sep).join('/'));
  assert.ok(rel.some((r) => r.endsWith('.codex/sessions/2026/11/05/rollout-a.jsonl')));
  assert.ok(rel.some((r) => r.endsWith('.codex/archived_sessions/rollout-b.jsonl')));
  assert.ok(rel.some((r) => r.endsWith('.zst')));
});

test('available reflects codex dir existence', async () => {
  assert.equal(codexAdapter.available(root), true);
  const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'ts-empty-'));
  assert.equal(codexAdapter.available(empty), false);
  await fs.rm(empty, { recursive: true, force: true });
});
