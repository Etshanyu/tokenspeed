import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { claudeAdapter } from './claude.ts';

let root = '';
let projDir = '';

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ts-claude-'));
  projDir = path.join(root, '.claude', 'projects', 'C--proj--console');
  await fs.mkdir(projDir, { recursive: true });
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function assistant(opts: {
  msgId: string; ts: string; out?: number; inp?: number; cacheRead?: number;
  model?: string; requestRef?: string;
}): string {
  return JSON.stringify({
    type: 'assistant', timestamp: opts.ts, requestRef: opts.requestRef ?? null,
    message: {
      id: opts.msgId, model: opts.model ?? 'glm-5.3',
      usage: {
        input_tokens: opts.inp ?? 10,
        cache_read_input_tokens: opts.cacheRead ?? 0,
        cache_creation_input_tokens: 0,
        output_tokens: opts.out ?? 100,
        output_tokens_details: { thinking_tokens: opts.out ? Math.floor(opts.out / 10) : 10 },
      },
    },
  });
}
const user = (ts: string) => JSON.stringify({ type: 'user', timestamp: ts, message: {} });
const apiReq = (id: string, ts: string) => JSON.stringify({ type: 'api-request', id, timestamp: ts });

async function writeSession(name: string, lines: string[]): Promise<{ path: string; mtimeMs: number; size: number }> {
  const p = path.join(projDir, name);
  await fs.writeFile(p, lines.join('\n') + '\n');
  const st = await fs.stat(p);
  return { path: p, mtimeMs: st.mtimeMs, size: st.size };
}

test('dedups multi-fragment responses', async () => {
  const f = await writeSession('s1.jsonl', [
    user('2026-11-05T03:00:00Z'),
    assistant({ msgId: 'm1', ts: '2026-11-05T03:00:10Z', out: 100 }),
    assistant({ msgId: 'm1', ts: '2026-11-05T03:00:11Z', out: 100 }),
    assistant({ msgId: 'm1', ts: '2026-11-05T03:00:12Z', out: 100 }),
  ]);
  const recs = await claudeAdapter.parse(root, f);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].outTok, 100);
  assert.equal(recs[0].src, 'claude');
  assert.equal(recs[0].sid, 's1');
  assert.equal(recs[0].proj, 'C--proj--console');
  assert.equal(recs[0].model, 'glm-5.3');
  assert.equal(recs[0].reasonTok, 10);
});

test('joins api-request by requestRef', async () => {
  const f = await writeSession('s2.jsonl', [
    apiReq('req-A', '2026-11-05T03:37:09.370Z'),
    assistant({ msgId: 'm2', ts: '2026-11-05T03:37:21.370Z', requestRef: 'req-A' }),
  ]);
  const recs = await claudeAdapter.parse(root, f);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].durMs, 12000);
});

test('falls back to preceding user line', async () => {
  const f = await writeSession('s3.jsonl', [
    user('2026-11-05T04:00:00Z'),
    assistant({ msgId: 'm3', ts: '2026-11-05T04:00:08Z' }),
  ]);
  const recs = await claudeAdapter.parse(root, f);
  assert.equal(recs[0].durMs, 8000);
});

test('falls back to previous response gap when no user anchor', async () => {
  // no user line anywhere: m4a gets the 1000ms fallback, m4b anchors on m4a's last fragment
  const f = await writeSession('s4.jsonl', [
    assistant({ msgId: 'm4a', ts: '2026-11-05T05:00:05Z' }),
    assistant({ msgId: 'm4a', ts: '2026-11-05T05:00:06Z' }),
    assistant({ msgId: 'm4b', ts: '2026-11-05T05:00:10Z' }),
  ]);
  const recs = await claudeAdapter.parse(root, f);
  assert.equal(recs.length, 2);
  assert.equal(recs[0].durMs, 1000);
  // m4b anchor = previous group's last fragment (05:00:06)
  assert.equal(recs[1].durMs, 4000);
});

test('stale user anchor still wins over previous response gap', async () => {
  const f = await writeSession('s4b.jsonl', [
    user('2026-11-05T05:00:00Z'),
    assistant({ msgId: 'm4c', ts: '2026-11-05T05:00:05Z' }),
    assistant({ msgId: 'm4d', ts: '2026-11-05T05:00:10Z' }),
  ]);
  const recs = await claudeAdapter.parse(root, f);
  // m4d: preceding user line (05:00:00) is priority-2, beats prev-group gap
  assert.equal(recs[1].durMs, 10000);
});

test('clamps out-of-range durations', async () => {
  // anchor AFTER first fragment -> invalid -> 1000
  const f1 = await writeSession('s5.jsonl', [
    assistant({ msgId: 'm5', ts: '2026-11-05T06:00:00Z' }),
    user('2026-11-05T06:00:05Z'),
  ]);
  const r1 = await claudeAdapter.parse(root, f1);
  assert.equal(r1[0].durMs, 1000);

  // anchor 20 minutes before -> clamp to 600000
  const f2 = await writeSession('s6.jsonl', [
    user('2026-11-05T06:30:00Z'),
    assistant({ msgId: 'm6', ts: '2026-11-05T06:50:00Z' }),
  ]);
  const r2 = await claudeAdapter.parse(root, f2);
  assert.equal(r2[0].durMs, 600000);
});

test('drops synthetic assistant rows', async () => {
  const f = await writeSession('s7.jsonl', [
    user('2026-11-05T07:00:00Z'),
    assistant({ msgId: 'm7', ts: '2026-11-05T07:00:05Z', model: '<synthetic>', out: 0 }),
    assistant({ msgId: 'm8', ts: '2026-11-05T07:00:15Z', out: 55 }),
  ]);
  const recs = await claudeAdapter.parse(root, f);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].outTok, 55);
});

test('folds subagent files into parent session', async () => {
  const sub = path.join(projDir, 'parentSid', 'subagents');
  await fs.mkdir(sub, { recursive: true });
  const p = path.join(sub, 'subSid.jsonl');
  await fs.writeFile(p, [
    user('2026-11-05T08:00:00Z'),
    assistant({ msgId: 'm9', ts: '2026-11-05T08:00:04Z', out: 42 }),
  ].join('\n') + '\n');
  const st = await fs.stat(p);
  const recs = await claudeAdapter.parse(root, { path: p, mtimeMs: st.mtimeMs, size: st.size });
  assert.equal(recs.length, 1);
  assert.equal(recs[0].sid, 'parentSid');
});

test('tolerates partial trailing line', async () => {
  const f = await writeSession('s8.jsonl', [
    user('2026-11-05T09:00:00Z'),
    assistant({ msgId: 'm10', ts: '2026-11-05T09:00:06Z', out: 77 }),
  ]);
  await fs.appendFile(f.path, '{"type":"assist'); // simulate mid-write
  const recs = await claudeAdapter.parse(root, f);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].outTok, 77);
});

test('skips malformed lines without crashing', async () => {
  const f = await writeSession('s9.jsonl', [
    'not json at all',
    '',
    user('2026-11-05T10:00:00Z'),
    assistant({ msgId: 'm11', ts: '2026-11-05T10:00:03Z', out: 5 }),
  ]);
  const recs = await claudeAdapter.parse(root, f);
  assert.equal(recs.length, 1);
});

test('discovers nested jsonl files', async () => {
  const found = await claudeAdapter.discover(root);
  const rel = found.map((e) => path.relative(root, e.path).replaceAll('\\', '/'));
  assert.ok(rel.some((r) => r.endsWith('.claude/projects/C--proj--console/s1.jsonl')));
  assert.ok(rel.some((r) => r.includes('/parentSid/subagents/subSid.jsonl')));
});

test('available reflects projects dir existence', async () => {
  assert.equal(claudeAdapter.available(root), true);
  const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'ts-empty-'));
  assert.equal(claudeAdapter.available(empty), false);
  await fs.rm(empty, { recursive: true, force: true });
});
