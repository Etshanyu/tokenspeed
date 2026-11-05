import type { SourceId, TurnRecord } from '../sources/types.ts';

export type WindowKey = 'today' | '7d' | '30d' | 'all';

export function windowRange(w: WindowKey, now: number): { from: number; to: number } {
  switch (w) {
    case 'today': {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      return { from: d.getTime(), to: now };
    }
    case '7d':
      return { from: now - 7 * 86400_000, to: now };
    case '30d':
      return { from: now - 30 * 86400_000, to: now };
    case 'all':
      return { from: 0, to: Number.POSITIVE_INFINITY };
  }
}

export function applyFilters(
  records: TurnRecord[],
  src: SourceId | 'all',
  range: { from: number; to: number },
): TurnRecord[] {
  return records.filter(
    (r) => (src === 'all' || r.src === src) && r.ts >= range.from && r.ts <= range.to,
  );
}

export interface SourceSummary {
  src: SourceId;
  avgTps: number | null;
  inTok: number;
  outTok: number;
  cacheRead: number;
  reqs: number;
  sessions: number;
  activeMs: number;
  spark: number[];
}

export function sourceSummaries(records: TurnRecord[], sparkBuckets = 32): SourceSummary[] {
  const bySrc = new Map<SourceId, TurnRecord[]>();
  for (const r of records) {
    const list = bySrc.get(r.src);
    if (list) list.push(r);
    else bySrc.set(r.src, [r]);
  }
  const out: SourceSummary[] = [];
  for (const [src, list] of bySrc) {
    const outTok = list.reduce((s, r) => s + r.outTok, 0);
    const inTok = list.reduce((s, r) => s + r.inTok, 0);
    const cacheRead = list.reduce((s, r) => s + r.cacheRead, 0);
    const activeMs = list.reduce((s, r) => s + Math.max(0, r.durMs), 0);
    out.push({
      src,
      avgTps: activeMs > 0 ? (outTok / activeMs) * 1000 : null,
      inTok, outTok, cacheRead,
      reqs: list.length,
      sessions: new Set(list.map((r) => r.sid)).size,
      activeMs,
      spark: spark(list, sparkBuckets),
    });
  }
  return out;
}

function spark(list: TurnRecord[], n: number): number[] {
  if (list.length === 0) return [];
  const tss = list.map((r) => r.ts);
  const min = Math.min(...tss);
  const max = Math.max(...tss);
  const span = Math.max(1, max - min);
  const vals = new Array<number>(n).fill(0);
  for (const r of list) {
    const idx = Math.min(n - 1, Math.floor(((r.ts - min) / span) * n));
    vals[idx] += r.outTok;
  }
  return vals;
}

export interface Bucket {
  t0: number;
  out: Record<SourceId, number>;
  in: Record<SourceId, number>;
}

export function buckets(records: TurnRecord[], range: { from: number; to: number }, n: number): Bucket[] {
  const span = Math.max(1, range.to - range.from);
  const bs: Bucket[] = Array.from({ length: n }, (_, i) => ({
    t0: range.from + (span / n) * i,
    out: {},
    in: {},
  }));
  for (const r of records) {
    if (r.ts < range.from || r.ts > range.to) continue;
    const idx = Math.min(n - 1, Math.floor(((r.ts - range.from) / span) * n));
    bs[idx].out[r.src] = (bs[idx].out[r.src] ?? 0) + r.outTok;
    bs[idx].in[r.src] = (bs[idx].in[r.src] ?? 0) + r.inTok;
  }
  return bs;
}

export interface ModelRow {
  model: string;
  srcs: SourceId[];
  reqs: number;
  inTok: number;
  outTok: number;
  cacheRead: number;
  avgTps: number | null;
  peakTps: number | null;
  share: number;
}

/** nearest-rank p95 */
function p95(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1);
  return sorted[idx];
}

export function modelStats(records: TurnRecord[]): ModelRow[] {
  const byModel = new Map<string, TurnRecord[]>();
  for (const r of records) {
    const list = byModel.get(r.model);
    if (list) list.push(r);
    else byModel.set(r.model, [r]);
  }
  const totalOut = records.reduce((s, r) => s + r.outTok, 0);
  const rows: ModelRow[] = [];
  for (const [model, list] of byModel) {
    const outTok = list.reduce((s, r) => s + r.outTok, 0);
    const activeMs = list.reduce((s, r) => s + Math.max(0, r.durMs), 0);
    rows.push({
      model,
      srcs: [...new Set(list.map((r) => r.src))],
      reqs: list.length,
      inTok: list.reduce((s, r) => s + r.inTok, 0),
      outTok,
      cacheRead: list.reduce((s, r) => s + r.cacheRead, 0),
      avgTps: activeMs > 0 ? (outTok / activeMs) * 1000 : null,
      peakTps: p95(list.filter((r) => r.durMs > 0).map((r) => r.outTok / r.durMs * 1000)),
      share: totalOut > 0 ? outTok / totalOut : 0,
    });
  }
  rows.sort((a, b) => b.outTok - a.outTok);
  return rows;
}

export interface SessionRow {
  sid: string;
  src: SourceId;
  proj: string;
  model: string;
  lastTs: number;
  outTok: number;
  totalTok: number;
  reqs: number;
  avgTps: number | null;
}

export function latestSessions(records: TurnRecord[], n: number): SessionRow[] {
  const bySid = new Map<string, TurnRecord[]>();
  for (const r of records) {
    const key = `${r.src}:${r.sid}`;
    const list = bySid.get(key);
    if (list) list.push(r);
    else bySid.set(key, [r]);
  }
  const rows: SessionRow[] = [];
  for (const [, list] of bySid) {
    const last = list.reduce((m, r) => Math.max(m, r.ts), -Infinity);
    const first = list[0];
    const latest = list.reduce((m, r) => (r.ts >= m.ts ? r : m), list[0]);
    const outTok = list.reduce((s, r) => s + r.outTok, 0);
    const activeMs = list.reduce((s, r) => s + Math.max(0, r.durMs), 0);
    rows.push({
      sid: first.sid,
      src: first.src,
      proj: first.proj,
      model: latest.model,
      lastTs: last,
      outTok,
      totalTok: list.reduce((s, r) => s + r.inTok + r.outTok + r.cacheRead + r.cacheWrite, 0),
      reqs: list.length,
      avgTps: activeMs > 0 ? (outTok / activeMs) * 1000 : null,
    });
  }
  rows.sort((a, b) => b.lastTs - a.lastTs);
  return rows.slice(0, n);
}
