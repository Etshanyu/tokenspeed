import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { decompress as zstdDecompress } from 'fzstd';
import type { FileEntry, SourceAdapter, TurnRecord } from './types.ts';

const MAX_DUR = 600_000;
const FALLBACK_DUR = 1000;

function listFiles(dir: string, exts: string[], out: FileEntry[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(p, exts, out);
    else if (e.isFile() && exts.some((ext) => e.name.endsWith(ext))) {
      try {
        const st = statSync(p);
        out.push({ path: p, mtimeMs: st.mtimeMs, size: st.size });
      } catch { /* vanished mid-walk */ }
    }
  }
}

function readLines(p: string): string[] {
  let buf: Buffer;
  if (p.endsWith('.zst')) {
    buf = Buffer.from(zstdDecompress(new Uint8Array(readFileSync(p))));
  } else {
    buf = readFileSync(p);
  }
  return buf.toString('utf8').split(/\r?\n/);
}

function clampDur(ts: number, anchor: number | undefined): number | null {
  if (anchor === undefined || !Number.isFinite(anchor)) return null;
  const d = ts - anchor;
  if (d <= 0) return null;
  return Math.min(d, MAX_DUR);
}

export const codexAdapter: SourceAdapter = {
  id: 'codex',
  label: 'CODEX',
  color: '#f59e0b',

  available(root: string): boolean {
    return existsSync(path.join(root, '.codex'));
  },

  discover(root: string): FileEntry[] {
    const base = path.join(root, '.codex');
    if (!existsSync(base)) return [];
    const out: FileEntry[] = [];
    listFiles(path.join(base, 'sessions'), ['.jsonl', '.jsonl.zst'], out);
    listFiles(path.join(base, 'archived_sessions'), ['.jsonl', '.jsonl.zst'], out);
    return out;
  },

  async parse(root: string, file: FileEntry): Promise<TurnRecord[]> {
    const records: TurnRecord[] = [];
    let proj = '';
    let lastModel = 'unknown';
    const turnModel = new Map<string, string>();
    const turnStart = new Map<string, number>();
    const prevInThread = new Map<string, number>();
    // first token_count event after the previous record marks the next request send time
    let tcAnchor: number | null = null;

    for (const line of readLines(file.path)) {
      if (!line.trim()) continue;
      let d: Record<string, any>;
      try {
        d = JSON.parse(line);
      } catch {
        continue; // malformed or mid-write partial line
      }
      const ts = Date.parse(d.timestamp ?? '');
      if (!Number.isFinite(ts)) continue;
      const payload = d.payload;
      if (!payload || typeof payload !== 'object') continue;

      if (d.type === 'session_meta') {
        if (typeof payload.cwd === 'string') proj = payload.cwd;
      } else if (d.type === 'turn_context') {
        if (typeof payload.turn_id === 'string' && typeof payload.model === 'string') {
          turnModel.set(payload.turn_id, payload.model);
          lastModel = payload.model;
        }
      } else if (d.type === 'event_msg' && payload.type === 'task_started') {
        const turn = payload.turn_attribution?.turn_id;
        if (typeof turn === 'string') turnStart.set(turn, ts);
      } else if (d.type === 'event_msg' && payload.type === 'token_count') {
        if (tcAnchor === null) tcAnchor = ts;
      } else if (d.type === 'token_usage_record') {
        const u = payload.usage;
        if (!u || typeof u !== 'object') continue; // cumulative-only records are skipped
        const thread = payload.thread_id;
        const turn = payload.turn_id;
        if (typeof thread !== 'string') continue;
        const model =
          (typeof turn === 'string' ? turnModel.get(turn) : undefined) ?? lastModel;
        const durMs =
          clampDur(ts, tcAnchor ?? undefined) ??
          clampDur(ts, prevInThread.get(thread)) ??
          clampDur(ts, typeof turn === 'string' ? turnStart.get(turn) : undefined) ??
          FALLBACK_DUR;
        tcAnchor = null; // consumed by this record
        prevInThread.set(thread, ts);
        records.push({
          src: 'codex',
          sid: thread,
          proj,
          ts,
          model,
          inTok: Math.max(0, (u.input_tokens ?? 0) - (u.cached_input_tokens ?? 0)),
          cacheRead: u.cached_input_tokens ?? 0,
          cacheWrite: u.cache_write_input_tokens ?? 0,
          outTok: u.output_tokens ?? 0,
          reasonTok: u.reasoning_output_tokens ?? 0,
          durMs,
        });
      }
    }
    return records;
  },
};
