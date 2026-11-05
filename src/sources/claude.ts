import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import * as readline from 'node:readline';
import path from 'node:path';
import type { FileEntry, SourceAdapter, TurnRecord } from './types.ts';

const MAX_DUR = 600_000;
const FALLBACK_DUR = 1000;

interface Usage {
  inTok: number; cacheRead: number; cacheWrite: number;
  outTok: number; reasonTok: number;
}

interface Group {
  msgId: string;
  firstTs: number;
  lastTs: number;
  requestRef: string | null;
  anchorUser: number | null;
  anchorPrev: number | null;
  model: string;
  usage: Usage | null;
}

function extractUsage(m: Record<string, unknown> | undefined): Usage | null {
  const u = (m?.usage ?? {}) as Record<string, any>;
  if (u.input_tokens === undefined && u.output_tokens === undefined) return null;
  const details = (u.output_tokens_details ?? {}) as Record<string, any>;
  return {
    inTok: u.input_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
    outTok: u.output_tokens ?? 0,
    reasonTok: details.thinking_tokens ?? 0,
  };
}

export const claudeAdapter: SourceAdapter = {
  id: 'claude',
  label: 'CLAUDE',
  color: '#22d3ee',

  available(root: string): boolean {
    return existsSync(path.join(root, '.claude', 'projects'));
  },

  watchDirs(root: string): string[] {
    return [path.join(root, '.claude', 'projects')];
  },

  discover(root: string): FileEntry[] {
    const base = path.join(root, '.claude', 'projects');
    if (!existsSync(base)) return [];
    const out: FileEntry[] = [];
    const walk = (dir: string): void => {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.isFile() && e.name.endsWith('.jsonl')) {
          try {
            const st = statSync(p);
            out.push({ path: p, mtimeMs: st.mtimeMs, size: st.size });
          } catch { /* file vanished mid-walk */ }
        }
      }
    };
    walk(base);
    return out;
  },

  async parse(root: string, file: FileEntry): Promise<TurnRecord[]> {
    const base = path.join(root, '.claude', 'projects');
    const rel = path.relative(base, file.path);
    const segs = rel.split(/[\\/]/);
    const proj = segs[0] ?? '';
    const last = segs[segs.length - 1] ?? '';
    // <proj>/<parentSid>/subagents/<subSid>.jsonl folds into the parent session
    const sid =
      segs.length >= 3 && segs[segs.length - 2] === 'subagents'
        ? segs[segs.length - 3]
        : last.replace(/\.jsonl$/, '');

    const records: TurnRecord[] = [];
    let lastUserTs: number | null = null;
    let prevGroupLastTs: number | null = null;
    const apiReqs = new Map<string, number>();
    let cur: Group | null = null;

    const flush = (): void => {
      if (!cur) return;
      const g = cur;
      cur = null;
      prevGroupLastTs = g.lastTs;
      if (!g.usage) return;
      const candidates: (number | null)[] = [
        g.requestRef != null ? (apiReqs.get(g.requestRef) ?? null) : null,
        g.anchorUser,
        g.anchorPrev,
      ];
      let durMs = FALLBACK_DUR;
      for (const c of candidates) {
        if (c == null || !Number.isFinite(c)) continue;
        const d = g.firstTs - c;
        if (d <= 0) continue;
        durMs = Math.min(d, MAX_DUR);
        break;
      }
      records.push({
        src: 'claude', sid, proj, ts: g.firstTs, model: g.model,
        ...g.usage, durMs,
      });
    };

    const rl = readline.createInterface({
      input: createReadStream(file.path, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
    try {
      for await (const line of rl) {
        if (!line.trim()) continue;
        let d: Record<string, any>;
        try {
          d = JSON.parse(line);
        } catch {
          continue; // malformed or mid-write partial line
        }
        const ts = Date.parse(d.timestamp ?? '');
        if (!Number.isFinite(ts)) continue;
        if (d.type === 'user') {
          lastUserTs = ts;
        } else if (d.type === 'api-request') {
          if (typeof d.id === 'string') apiReqs.set(d.id, ts);
        } else if (d.type === 'assistant') {
          const m = d.message;
          const msgId = m?.id;
          if (typeof msgId !== 'string') continue;
          const model = typeof m?.model === 'string' ? m.model : 'unknown';
          if (model === '<synthetic>') continue;
          const usage = extractUsage(m);
          if (!cur || cur.msgId !== msgId) {
            flush();
            cur = {
              msgId, firstTs: ts, lastTs: ts,
              requestRef: typeof d.requestRef === 'string' ? d.requestRef : null,
              anchorUser: lastUserTs, anchorPrev: prevGroupLastTs,
              model, usage,
            };
          } else {
            cur.lastTs = ts;
            if (usage) cur.usage = usage;
            if (cur.requestRef == null && typeof d.requestRef === 'string') {
              cur.requestRef = d.requestRef;
            }
          }
        }
      }
    } finally {
      flush();
      rl.close();
    }
    return records;
  },
};
